// Two outlets must never get the same wording for the same story. Every desk
// gets its own house style (picked from its id, so it never changes), and a
// draft that still reads like another desk's is written once more.
// Pure: no database, no clock.
import { copyPart } from "./rules";

const LEADS = [
  "start the body with who acted",
  "start the body with what happened",
  "start the body with where and when it happened",
  "start the body with the consequence",
] as const;

const HEADLINES = [
  "write a verb-led headline",
  "write a noun-led headline that carries the key fact",
  "write a two-part headline with a colon",
] as const;

const RHYTHMS = [
  "write one longer sentence, then a short one",
  "write two even sentences",
  "write three short sentences",
] as const;

/** FNV-1a, 32 bit: small, stable and the same in the browser and on the server. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The desk's house style: one lead, one headline shape and one rhythm, always the same for the same desk. */
export function voiceFor(tenantId: string): string {
  const h = hash(tenantId);
  const lead = LEADS[h % LEADS.length];
  const headline = HEADLINES[Math.floor(h / LEADS.length) % HEADLINES.length];
  const rhythm = RHYTHMS[Math.floor(h / (LEADS.length * HEADLINES.length)) % RHYTHMS.length];
  return `House style for this outlet: ${lead}; ${headline}; ${rhythm}.`;
}

export const VOICE_NOTE_MAX = 300;

/** The outlet's own style note as one line of at most 300 characters, or null when it is empty. */
export function cleanVoiceNote(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const line = raw.replace(/\s+/g, " ").trim();
  return line ? [...line].slice(0, VOICE_NOTE_MAX).join("").trim() : null;
}

type Text = { headline: string; body: string };

/**
 * True when two drafts of the same story read alike: one of them, measured against the
 * other, would fail the source-copy check (same word 4-gram and word-order thresholds).
 */
export function sameStoryTooClose(a: Text, b: Text): boolean {
  return copyPart(a, { title: b.headline, snippet: b.body }) !== null || copyPart(b, { title: a.headline, snippet: a.body }) !== null;
}
