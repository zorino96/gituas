// The Sorani proofreader: the Kurdish Keyboard project's "Gochan" door (a Cloudflare Worker of the owner's own) in front of the
// proofreading model at pawan.krd. Only PUBLIC text goes through it (news drafts, video scripts, shop captions), never a buyer's
// message. It only ever improves a text: every failure, every slow answer and every answer that changed a number, a name, a link or
// a hashtag is thrown away and the text stays as it was.
//   PROOFREAD_ENABLED=0   switches it off
//   PROOFREAD_URL         another address of the same door (default below)
const DEFAULT_URL = "https://gochan.moneger.workers.dev/v1/fix";
/** The door refuses more than this, and a longer text is not worth the wait. */
const MAX_CHARS = 3500;
/** The door allows 30 fixes a minute from one address; this instance keeps well under it. */
const PER_MINUTE = 18;
const MAX_IN_FLIGHT = 3;
/** The door asks the model up to three times: 13 to 15 s from Vercel, so a caller that cannot wait that long should not use it. */
const DEFAULT_TIMEOUT_MS = 18_000;

export function proofreadEnabled(): boolean {
  return process.env.PROOFREAD_ENABLED?.trim() !== "0";
}

const stamps: number[] = [];
let inFlight = 0;

/** For tests. */
export function resetProofreadLimits(): void {
  stamps.length = 0;
  inFlight = 0;
}

function allowedNow(now: number): boolean {
  while (stamps.length && now - stamps[0] > 60_000) stamps.shift();
  return stamps.length < PER_MINUTE && inFlight < MAX_IN_FLIGHT;
}

/** Whether most of the letters are Arabic-script ones (only Sorani goes through the door). */
export function looksKurdish(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  const arabic = text.match(/[؀-ۿ]/g) ?? [];
  return letters.length >= 8 && arabic.length / letters.length >= 0.6;
}

const toWestern = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/** What a correction must leave exactly as it was: numbers, links, handles, hashtags and Latin words (names, brands). */
function protectedTokens(text: string): string[] {
  const t = toWestern(text.normalize("NFKC"));
  const found = [...(t.match(/\d+/g) ?? []), ...(t.match(/https?:\/\/\S+|www\.\S+/gi) ?? []), ...(t.match(/[@#][\p{L}\p{N}_]+/gu) ?? []), ...(t.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [])];
  return found.map((x) => x.toLowerCase()).sort();
}

/**
 * The Sorani number words: a documented story writes every year and count as words ("هەزار و نۆسەد و بیست و دوو" for 1922), so a
 * correction that changes one of them changes a fact. Digits and Latin words are already protected above; these are not digits.
 */
const NUMBER_WORDS = new Set(
  [
    "یەک", "دوو", "سێ", "چوار", "پێنج", "پینج", "شەش", "حەوت", "حەفت", "هەشت", "نۆ", "دە", "یازدە", "دوازدە", "سێزدە", "چواردە", "پازدە", "شازدە", "حەڤدە",
    "هەژدە", "نۆزدە", "بیست", "سی", "چل", "پەنجا", "شەست", "حەفتا", "هەفتا", "هەشتا", "نەوەد", "سەد", "هەزار", "ملیۆن", "ملیار", "نیو",
    "دووسەد", "سێسەد", "چوارسەد", "پێنجسەد", "شەشسەد", "حەوتسەد", "هەشتسەد", "نۆسەد", "یەکەم", "دووەم", "سێیەم", "چوارەم", "پێنجەم", "شەشەم", "حەوتەم",
    "هەشتەم", "نۆیەم", "دەیەم",
  ].map((w) => normalizeLetters(w)),
);

/** Arabic yeh and kaf typed as the Persian ones, so one spelling of a word is one word. */
function normalizeLetters(w: string): string {
  return w.normalize("NFKC").replace(/ي/g, "ی").replace(/ك/g, "ک");
}

/** The number words of a text, in order of the alphabet, as one string: two texts that say the same numbers have the same one. */
export function numberWordSignature(text: string): string {
  const tokens = normalizeLetters(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return tokens.filter((t) => NUMBER_WORDS.has(t)).sort().join("|");
}

/** Why a corrected text is not accepted (null = accepted). */
export function correctionProblem(original: string, fixed: string): string | null {
  if (!fixed.trim()) return "empty";
  const len = (s: string) => Array.from(s).length;
  const ratio = len(fixed) / Math.max(1, len(original));
  if (ratio < 0.7 || ratio > 1.4) return "length";
  if ((fixed.match(/\n/g) ?? []).length !== (original.match(/\n/g) ?? []).length) return "lines";
  const a = protectedTokens(original);
  const b = protectedTokens(fixed);
  if (a.length !== b.length || a.some((x, i) => x !== b[i])) return "protected";
  return null;
}

export interface Proofread {
  text: string;
  changed: boolean;
}

export interface ProofreadOptions {
  timeoutMs?: number;
  /**
   * A documented story's lines: a correction that changes the Sorani number words (a year or a count written as words) is thrown away
   * and the original line kept (see numberWordSignature). Off by default: an ad, a caption or a news text is proofread as before.
   */
  numberWords?: boolean;
}

/** The corrected text, or the original one (never throws). */
export async function proofreadSorani(text: string, opts: ProofreadOptions = {}): Promise<Proofread> {
  const same: Proofread = { text, changed: false };
  if (!proofreadEnabled() || !looksKurdish(text) || Array.from(text).length > MAX_CHARS) return same;
  const now = Date.now();
  if (!allowedNow(now)) return same;
  stamps.push(now);
  inFlight++;
  try {
    const res = await fetch(process.env.PROOFREAD_URL?.trim() || DEFAULT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn("[proofread] not used: HTTP", res.status);
      return same;
    }
    const body = (await res.json().catch(() => null)) as { text?: unknown } | null;
    const fixed = typeof body?.text === "string" ? body.text.trim() : "";
    const problem = correctionProblem(text, fixed) ?? (opts.numberWords && numberWordSignature(text) !== numberWordSignature(fixed) ? "numbers" : null);
    if (problem) {
      console.warn("[proofread] correction refused:", problem);
      return same;
    }
    return { text: fixed, changed: fixed !== text.trim() };
  } catch (e) {
    console.warn("[proofread] not used:", e instanceof Error ? e.name : "failed");
    return same;
  } finally {
    inFlight--;
  }
}

/** Several lines in one call (one line per item): the same number of lines comes back or nothing changes. */
export async function proofreadLines(lines: string[], opts: ProofreadOptions = {}): Promise<string[]> {
  if (!lines.length || lines.some((l) => l.includes("\n"))) return lines;
  // (The number words are compared line by line below, so one line's changed year does not cost the other lines their corrections.)
  const r = await proofreadSorani(lines.join("\n"), { ...opts, numberWords: false });
  if (!r.changed) return lines;
  const back = r.text.split("\n");
  if (back.length !== lines.length || !back.every((l) => l.trim())) return lines;
  const fixed = back.map((l) => l.trim());
  return opts.numberWords ? fixed.map((l, i) => (numberWordSignature(l) === numberWordSignature(lines[i]) ? l : lines[i])) : fixed;
}

/** A model's raw ad-video JSON with its spoken lines and its caption corrected (a copy; the original when nothing changed). */
export async function polishAdRaw(raw: unknown, opts: ProofreadOptions = {}): Promise<unknown> {
  if (!proofreadEnabled() || !raw || typeof raw !== "object") return raw;
  const r = raw as { scenes?: unknown; caption?: unknown };
  const scenes = Array.isArray(r.scenes) ? (r.scenes as Record<string, unknown>[]) : [];
  const idx = scenes.map((s, i) => (typeof s?.voice === "string" && s.voice.trim() ? i : -1)).filter((i) => i >= 0);
  const [voices, caption] = await Promise.all([
    proofreadLines(idx.map((i) => (scenes[i].voice as string).trim()), opts),
    typeof r.caption === "string" && r.caption.trim() ? proofreadSorani(r.caption.trim(), opts) : Promise.resolve(null),
  ]);
  const voiceChanged = voices.some((v, k) => v !== (scenes[idx[k]].voice as string).trim());
  if (!voiceChanged && !caption?.changed) return raw;
  const copy = scenes.map((s) => ({ ...s }));
  idx.forEach((i, k) => (copy[i].voice = voices[k]));
  return { ...r, scenes: copy, ...(caption?.changed ? { caption: caption.text } : {}) };
}

/** A news reel script with its spoken sentences corrected. */
export async function polishReelSegments<S extends { say: string }>(segments: S[], opts: ProofreadOptions = {}): Promise<S[]> {
  if (!proofreadEnabled()) return segments;
  const fixed = await proofreadLines(segments.map((s) => s.say), opts);
  return segments.map((s, i) => (fixed[i] === s.say ? s : { ...s, say: fixed[i] }));
}
