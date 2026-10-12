// Smart replies: the assistant writes the first message to a commenter and the answers in a chat, in
// the owner's own words (their instructions), instead of fixed templates. The model never gets to
// state a fact of its own: it is handed the shop's facts, and whatever it writes is checked before
// it can be sent: no number that is not in the facts or the owner's instructions, no link but the
// order link. A reply that fails the check is thrown away and the fixed templates answer instead.

import { completeJson, type JsonCall } from "@/lib/ai/provider";
import type { Lang } from "./money";

/** The owner's instructions, at most this many characters. */
export const SMART_BRIEF_MAX = 1500;

export type SmartKind = "dm_first" | "dm_followup" | "public";

export interface SmartProduct {
  name: string;
  /** "M: 25,000 IQD", "Sold out" … exactly as the shop would show them. */
  lines: string[];
}

export interface SmartFacts {
  shop: string;
  tagline: string | null;
  /** Delivery lines as the shop shows them (fee, time, per city). */
  delivery: string[];
  /** The product this conversation is about, when known. */
  asked: SmartProduct | null;
  /** Other products on sale (names and prices). */
  catalog: SmartProduct[];
  /** The WhatsApp order link, the only link a reply may contain. */
  orderLink: string | null;
}

export interface SmartInput {
  kind: SmartKind;
  lang: Lang;
  /** The owner's instructions (may be empty). */
  brief: string;
  facts: SmartFacts;
  /** The buyer's new comment or message. */
  message: string;
  /** Earlier turns of this chat, oldest first. */
  history?: { from: "buyer" | "shop"; text: string }[];
  /** The message is a voice note read by speech recognition, so it may contain mistakes. */
  viaVoice?: boolean;
}

export interface SmartOutput {
  text: string;
  /** The reply admits the team has to confirm something: the merchant should look at the chat. */
  needsOwner: boolean;
  /** The buyer's message could not be understood (a noisy or fast voice note, say): the reply only asks them to say it again. */
  unclear: boolean;
  model: string;
}

const LANG_NAME: Record<Lang, string> = {
  ckb: "Central Kurdish (Sorani) in Arabic script",
  kmr: "Badini (Northern Kurdish) in Arabic script",
  ar: "Iraqi Arabic",
  ku_latn: "Kurdish written in Latin letters",
  en: "English",
};

const MAX_LEN: Record<SmartKind, number> = { dm_first: 700, dm_followup: 600, public: 140 };

// ---- checking a reply -----------------------------------------------------------------------------

const toWestern = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/** The numbers written in a text, as plain digit strings: "25,000", "٢٥٬٠٠٠" and "25.000" are all "25000". */
export function numbersIn(s: string): string[] {
  const found = toWestern(s).match(/\d+(?:[,.٫٬،]\d+)*/g) ?? [];
  return found.map((n) => n.replace(/[,.٫٬،]/g, ""));
}

/** Every number the shop's facts and the owner's instructions already contain. */
export function allowedNumbers(facts: SmartFacts, brief: string): Set<string> {
  const text = [
    facts.shop,
    facts.tagline ?? "",
    ...facts.delivery,
    ...(facts.asked ? [facts.asked.name, ...facts.asked.lines] : []),
    ...facts.catalog.flatMap((p) => [p.name, ...p.lines]),
    brief,
  ].join("\n");
  return new Set(numbersIn(text));
}

const URL_LIKE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|me|krd|iq|app|link)\b|wa\.me|t\.me|@[a-z0-9_.]{3,})/i;

export type Checked = { ok: true; text: string } | { ok: false; reason: "empty" | "long" | "number" | "link" };

/** The guard every smart reply passes (or is dropped). `allowed` null = no number at all, as in a public reply. */
export function checkReply(raw: unknown, o: { allowed: Set<string> | null; orderLink: string | null; kind: SmartKind }): Checked {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { ok: false, reason: "empty" };
  if (Array.from(text).length > MAX_LEN[o.kind]) return { ok: false, reason: "long" };
  const withoutLink = o.orderLink ? text.split(o.orderLink).join(" ") : text;
  if (URL_LIKE.test(withoutLink)) return { ok: false, reason: "link" };
  for (const n of numbersIn(withoutLink)) {
    if (o.allowed === null || !o.allowed.has(n)) return { ok: false, reason: "number" };
  }
  return { ok: true, text };
}

// ---- the prompt -----------------------------------------------------------------------------------

const SITUATION: Record<SmartKind, string> = {
  dm_first:
    "This is the FIRST private message to someone who commented on the shop's post. Greet them warmly, thank them, introduce the product in one or two lines, and give the next step.",
  dm_followup: "This is a reply inside an ongoing chat. Answer what they just wrote.",
  public:
    "This is a PUBLIC reply under the buyer's comment, seen by everyone. One short friendly line; invite them to check their messages. No prices, no numbers, no links.",
};

export function buildSystem(i: SmartInput): string {
  return `You are the sales assistant of the shop "${i.facts.shop}", a small business in Iraqi Kurdistan, replying to buyers on Facebook, Instagram and WhatsApp on the owner's behalf.
Write ONE reply as the shop, in ${LANG_NAME[i.lang]}. Warm, brief (two to four short sentences), natural spoken style, at most two emoji.
${SITUATION[i.kind]}
Your goals, in order: (1) answer exactly what the buyer asked, using ONLY the facts below; (2) make the next step toward buying easy: ask for ONE missing detail (city, size or colour), or invite them to confirm the order. If an order link is given you may include it exactly as written.
Hard rules:
- Never invent or alter facts: prices, stock, sizes, colours, delivery fees or times, discounts, materials, guarantees, addresses. If something is not in the facts, say the team will confirm it shortly and set needsOwner to true.
- Every number you write must already appear in the facts or in the owner's instructions. Write prices exactly as in the facts. No phone numbers, no other links, no handles.
- Follow the owner's instructions; they override your own style. If they say not to mention the price, do not.
- Never pressure, insult or promise what you cannot keep, and never say you are an AI.
- Understand before you answer. If you cannot tell what the buyer wants (words missing or garbled, or a voice note that speech recognition probably got wrong), do NOT guess: set clear to false and write one short, polite line asking them to say it again or type it.
Reply with one JSON object only: {"text": "<the reply>", "needsOwner": true | false, "clear": true | false}`;
}

const line = (p: SmartProduct) => `- ${p.name}${p.lines.length ? ` (${p.lines.join("; ")})` : ""}`;

export function buildUser(i: SmartInput, problem?: string): string {
  const f = i.facts;
  const parts: string[] = [];
  parts.push(`Owner's instructions (follow strictly):\n"""\n${i.brief.trim() || "(none given: be helpful and honest)"}\n"""`);
  parts.push(`Shop: ${f.shop}${f.tagline ? ` — ${f.tagline}` : ""}`);
  if (f.delivery.length) parts.push(`Delivery:\n${f.delivery.map((d) => `- ${d}`).join("\n")}`);
  parts.push(f.asked ? `Product this chat is about:\n${line(f.asked)}` : "Product this chat is about: not known yet");
  if (f.catalog.length) parts.push(`Other products on sale:\n${f.catalog.map(line).join("\n")}`);
  parts.push(`Order link: ${f.orderLink ?? "none"}`);
  if (i.history?.length) {
    parts.push(`Chat so far (oldest first):\n${i.history.slice(-6).map((h) => `${h.from === "buyer" ? "Buyer" : "Shop"}: ${h.text.slice(0, 300)}`).join("\n")}`);
  }
  const label =
    i.kind === "dm_first" || i.kind === "public"
      ? "Buyer's comment"
      : i.viaVoice
        ? "Buyer's new message (a voice note, as written down by speech recognition: it may contain mistakes)"
        : "Buyer's new message";
  parts.push(`${label}:\n"""\n${i.message.slice(0, 600)}\n"""`);
  if (problem) parts.push(`Your previous attempt was refused: ${problem} Write it again without that.`);
  return parts.join("\n\n");
}

const PROBLEM: Record<Exclude<Checked, { ok: true }>["reason"], string> = {
  empty: "it was empty.",
  long: "it was too long; keep it shorter.",
  number: "it contained a number that is not in the facts; use only numbers from the facts, written exactly as there.",
  link: "it contained a link or handle that is not allowed; remove it.",
};

export type Completer = (call: JsonCall) => Promise<{ data: unknown; model: string }>;
const defaultCompleter: Completer = (call) => completeJson(call);

/** One checked reply, or null when the model failed or kept breaking the rules (the templates answer then). */
export async function smartReply(i: SmartInput, complete: Completer = defaultCompleter): Promise<SmartOutput | null> {
  const allowed = i.kind === "public" ? null : allowedNumbers(i.facts, i.brief);
  let problem: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let out: { data: unknown; model: string };
    try {
      out = await complete({ system: buildSystem(i), user: buildUser(i, problem), strength: "fast", thinking: false, budgetMs: 18_000 });
    } catch {
      return null;
    }
    const d = (out.data ?? {}) as { text?: unknown; needsOwner?: unknown; clear?: unknown };
    const checked = checkReply(d.text, { allowed, orderLink: i.facts.orderLink, kind: i.kind });
    // Only a chat reply can be "not understood"; a first message to a commenter or a public line never is.
    const unclear = d.clear === false && i.kind === "dm_followup";
    if (checked.ok) return { text: checked.text, needsOwner: d.needsOwner === true || unclear, unclear, model: out.model };
    problem = PROBLEM[checked.reason];
  }
  return null;
}
