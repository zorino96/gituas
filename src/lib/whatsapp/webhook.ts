// WhatsApp Cloud API webhook payloads → the events the shop acts on.
// Payload: { object: "whatsapp_business_account", entry: [{ changes: [{ field, value }] }] }
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components

export type WaEvent =
  | {
      kind: "message";
      phoneNumberId: string;
      messageId: string;
      /** The buyer's WhatsApp id (their phone digits). */
      from: string;
      name: string | null;
      /** The text, or a media token like "[image]" plus its caption. */
      text: string;
    }
  /** The merchant answered from the WhatsApp Business app on their phone (coexistence). */
  | { kind: "echo"; phoneNumberId: string; to: string };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

const MEDIA = ["image", "video", "audio", "document", "sticker", "location", "contacts"] as const;
/** "[image]", "[audio] caption" … a message that is media, with its caption if any. */
const MEDIA_RE = new RegExp(`^\\[(${MEDIA.join("|")})\\](?: (.*))?$`, "s");

export function mediaToken(text: string): { type: (typeof MEDIA)[number]; caption: string } | null {
  const m = MEDIA_RE.exec(text);
  return m ? { type: m[1] as (typeof MEDIA)[number], caption: m[2] ?? "" } : null;
}

/** The words a buyer actually typed: the text, a button's title, or a media caption. */
export function typedText(text: string): string {
  const m = mediaToken(text);
  return m ? m.caption : text;
}

function messageText(m: Obj): string | null {
  const type = str(m.type);
  if (type === "text") return str(obj(m.text).body) ?? "";
  if (type === "button") return str(obj(m.button).text) ?? "";
  if (type === "interactive") {
    const i = obj(m.interactive);
    return str(obj(i.button_reply).title) ?? str(obj(i.list_reply).title) ?? "";
  }
  if (type && (MEDIA as readonly string[]).includes(type)) {
    const caption = str(obj(m[type]).caption);
    return caption ? `[${type}] ${caption}` : `[${type}]`;
  }
  // reactions, system notices, unsupported types: nothing to answer
  return null;
}

export function parseWaPayload(body: unknown): WaEvent[] {
  const b = obj(body);
  if (b.object !== "whatsapp_business_account") return [];
  const out: WaEvent[] = [];
  for (const entry of arr(b.entry)) {
    for (const change of arr(obj(entry).changes)) {
      const c = obj(change);
      const v = obj(c.value);
      const phoneNumberId = str(obj(v.metadata).phone_number_id);
      if (!phoneNumberId) continue;
      if (c.field === "messages") {
        const names = new Map<string, string>();
        for (const ct of arr(v.contacts)) {
          const id = str(obj(ct).wa_id);
          const name = str(obj(obj(ct).profile).name);
          if (id && name) names.set(id, name);
        }
        for (const raw of arr(v.messages)) {
          const m = obj(raw);
          const messageId = str(m.id);
          const from = str(m.from);
          const text = messageText(m);
          if (!messageId || !from || text === null) continue;
          out.push({ kind: "message", phoneNumberId, messageId, from, name: names.get(from) ?? null, text });
        }
      } else if (c.field === "smb_message_echoes") {
        for (const raw of arr(v.message_echoes)) {
          const to = str(obj(raw).to);
          if (to) out.push({ kind: "echo", phoneNumberId, to });
        }
      }
    }
  }
  return out;
}

const normalize = (s: string): string =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "") // harakat, tatweel
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[أإآ]/g, "ا")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The product a WhatsApp message names. The shop's wa.me link pre-fills
 * "<product> — <price>", so the longest product name found in the text wins.
 */
export function productNamedIn(text: string, products: { id: string; name: string }[]): string | null {
  const t = normalize(text);
  let best: { id: string; len: number } | null = null;
  for (const p of products) {
    const n = normalize(p.name);
    if ([...n].length < 3 || !t.includes(n)) continue;
    if (!best || n.length > best.len) best = { id: p.id, len: n.length };
  }
  return best?.id ?? null;
}
