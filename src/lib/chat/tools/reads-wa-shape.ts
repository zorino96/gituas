// Turns the WhatsApp chats (reads-wa-live.ts) into what a read tool returns: conversation items that sit next to Messenger and Instagram
// in list_conversations, the last messages for the model, and the person's own view. Pure, so the privacy rules are tested without a
// database: the model's copy has no phone number anywhere (the chat's `ref` is opaque), the person's copy may show the number.

import { ago } from "@/app/app/format";
import type { Dict } from "@/lib/i18n/ckb";
import type { Lang } from "@/lib/i18n/lang";
import { isStopWord, mediaToken } from "@/lib/whatsapp/webhook";
import { baseOf } from "../kinds";
import type { ViewBlock } from "../types";
import { baghdadIso, clip, compact, isolateLtr, modelText, VIEW_TEXT_MAX } from "./reads-shared";
import type { ConversationItem } from "./reads-shape";
import type { WaChat, WaLine } from "./reads-wa-live";
import { words } from "./reads-words";

/** WhatsApp lets a business write freely only for 24 hours after the buyer's last message. */
export const WA_WINDOW_MS = 86_400_000;

const TEMPLATE = "[template] ";

/** A stored line as the person reads it: the WhatsApp screen's own labels (a photo is "📷 Photo", a template "📋 name"). */
export function waLabel(line: Pick<WaLine, "text" | "photos">, t: Dict): string {
  if (line.photos !== undefined) return `${t.wa.media.image} × ${t.fmt.num(line.photos)}`;
  const m = mediaToken(line.text);
  if (m) return [t.wa.media[m.type], m.caption].filter(Boolean).join(" · ");
  return line.text.startsWith(TEMPLATE) ? `📋 ${line.text.slice(TEMPLATE.length)}` : line.text;
}

/** The same line for the model (English, no pictures): the media kind in brackets, then the caption. */
export function waPlain(line: Pick<WaLine, "text" | "photos">): string {
  if (line.photos !== undefined) return `[image x${line.photos}]`;
  const m = mediaToken(line.text);
  if (m) return [`[${m.type}]`, m.caption].filter(Boolean).join(" ");
  return line.text.startsWith(TEMPLATE) ? `[template sent: ${line.text.slice(TEMPLATE.length)}]` : line.text;
}

/** The buyer's newest message asks not to be messaged again (STOP): nothing may be sent to them. */
export const askedToStop = (chat: Pick<WaChat, "lastInboundText">): boolean => !!chat.lastInboundText && isStopWord(chat.lastInboundText);

/** The buyer wrote within the last 24 hours. */
export const windowOpen = (chat: Pick<WaChat, "lastInboundAt">, now: number): boolean => chat.lastInboundAt !== null && now - Date.parse(chat.lastInboundAt) <= WA_WINDOW_MS;

/**
 * The owner answered this chat on the phone (WhatsApp coexistence). Such an answer is stored nowhere as a message: the webhook only
 * pauses the bot in that chat. So the chat still ends on the buyer's line, and the sign that it was answered is a pause that came
 * after that line, the way the Messages screen counts a thread the owner took over by hand.
 *
 * This is all the data can say. The pause is made once and never moves, so a buyer who writes again after it is shown as waiting
 * again (a later phone answer to that new message leaves no trace).
 */
export function answeredOnPhone(chat: Pick<WaChat, "lines" | "pausedAt">): boolean {
  const last = chat.lines[chat.lines.length - 1];
  if (!last || last.from !== "them" || !chat.pausedAt) return false;
  return Date.parse(chat.pausedAt) > Date.parse(last.at);
}

/** WhatsApp chats as conversation items. `t` is the person's dictionary (it words the lines they will read). */
export function waItems(chats: readonly WaChat[], orderBuyers: ReadonlySet<string>, now: number, t: Dict): ConversationItem[] {
  return chats.map((c) => {
    const last = c.lines[c.lines.length - 1];
    const stop = askedToStop(c);
    const open = windowOpen(c, now);
    const byPhone = answeredOnPhone(c);
    return {
      id: c.ref,
      platform: "WA",
      name: c.name ?? "",
      lastText: waPlain(last),
      lastView: waLabel(last, t),
      lastFromUs: last.from !== "them",
      at: last.at,
      canReply: open && !stop,
      stop: stop || undefined,
      windowEndsAt: open && c.lastInboundAt ? (baghdadIso(Date.parse(c.lastInboundAt) + WA_WINDOW_MS) ?? undefined) : undefined,
      // The assistant's "needs you" mark is about a message the owner has since answered.
      flag: byPhone ? undefined : c.flag,
      orderOpen: orderBuyers.has(c.buyerId),
      unanswered: last.from === "them" && !byPhone,
      answeredOnPhone: byPhone || undefined,
      phone: c.buyerId,
    };
  });
}

/** The last messages of one WhatsApp chat for the model: who said it, what, when. The owner's own and Gituas' automatic ones are both "shop". */
export function waMessagesForModel(chat: Pick<WaChat, "lines">, max = 12): Record<string, unknown>[] {
  return chat.lines.slice(-max).map((l) =>
    compact({ from: l.from === "them" ? "buyer" : "shop", automatic: l.from === "bot" || undefined, text: modelText(waPlain(l)), at: baghdadIso(l.at) }),
  );
}

/** One WhatsApp chat for the person: its last messages, and why it cannot be answered when it cannot. */
export function waConversationView(chat: WaChat, now: number, t: Dict, lang: Lang): ViewBlock[] {
  const lines = chat.lines.slice(-12);
  if (!lines.length) return [{ kind: "note", text: t.messages.noMessages }];
  const who = (l: WaLine) => (l.from === "them" ? t.messages.customer : l.from === "bot" ? t.wa.bot : t.wa.you);
  const blocks: ViewBlock[] = [
    {
      kind: "list",
      title: [t.wa.nav, [chat.name, isolateLtr(`+${chat.buyerId}`)].filter(Boolean).join(" · ")].join(" · "),
      items: lines.map((l) => ({ title: clip(waLabel(l, t), VIEW_TEXT_MAX) || t.common.mediaOrFile, sub: [who(l), ago(l.at, t)].filter(Boolean).join(" · ") })),
      href: `${baseOf("shop")}/whatsapp`,
    },
  ];
  if (askedToStop(chat)) blocks.push({ kind: "note", tone: "warn", text: t.wa.errors.optedOut });
  else if (!windowOpen(chat, now)) blocks.push({ kind: "note", tone: "warn", text: t.wa.outsideWindow });
  if (answeredOnPhone(chat)) blocks.push({ kind: "note", text: words(lang).answeredOnPhone });
  return blocks;
}
