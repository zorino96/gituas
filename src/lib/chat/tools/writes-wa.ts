// send_message for WhatsApp: a free-text answer inside the buyer's 24-hour window, sent by the WhatsApp screen's own action
// (sendWhatsAppAction), which checks the role, the connection and the window again and then keeps the bot out of the chat.
//
// Templates are NOT part of this version: a closed window is a refusal that says so. A buyer whose newest message is STOP is
// refused as well (the screen's template action refuses them; the chat does not write to them either). STOP is looked at first:
// a buyer who opted out and whose window is closed too must never be pointed at a template, which would only be a way round the STOP.

import { sendWhatsAppAction } from "@/app/app/whatsapp/actions";
import type { Card, ToolCtx, WriteResult } from "@/lib/chat/types";
import { dict } from "@/lib/i18n";
import { readWaChat, type WaChat } from "./reads-wa-live";
import { askedToStop, waLabel, windowOpen } from "./reads-wa-shape";
import { clip, refuse } from "./writes-common";
import { NEW } from "./writes-words";

interface WaSend {
  conversation: string;
  text: string;
}

const NO_WA_FOR_NEWS = "WhatsApp belongs to a shop. The news desk has no WhatsApp: use platform FB or IG.";

/**
 * The chat a WhatsApp message would go to, looked up inside this workspace's own WhatsApp store by the reference list_conversations
 * gave. It refuses what cannot work; what it returns is safe to send to. The buyer's number comes from here and never from the model.
 */
export async function findWhatsAppChat(ctx: ToolCtx, ref: string): Promise<WaChat> {
  if (ctx.kind !== "shop") return refuse(NO_WA_FOR_NEWS);
  const one = await readWaChat(ctx.tenantId, ref);
  if (!one.connected) return refuse("WhatsApp is not connected for this shop. The person has to connect it on the WhatsApp screen; you cannot do that for them.");
  if (!one.found) return refuse(`WhatsApp conversation "${ref.slice(0, 80)}" was not found among this shop's chats of the last 30 days. Use an id from list_conversations with platform WA.`);
  const chat = one.chat;
  const open = windowOpen(chat, Date.now());
  if (askedToStop(chat)) {
    return refuse(
      open
        ? "This customer's latest message is STOP: they asked not to be messaged. Do not write to them from the chat. " +
            "Tell the person; if they still want to, the decision is theirs on the WhatsApp screen."
        : "This customer's latest message is STOP: they asked not to be messaged, and the 24-hour window is closed as well, so nothing can be sent to them, " +
            "from the chat or from the WhatsApp screen. Do not suggest any way of writing to them; tell the person, and wait until the customer writes again.",
    );
  }
  if (!open) {
    return refuse(
      "The 24-hour window is closed: WhatsApp allows a free message only within 24 hours of the customer's last message. " +
        "Message templates are not part of the chat yet. Tell the person to send an approved template from the WhatsApp screen, or to wait until the customer writes again.",
    );
  }
  return chat;
}

/** The card: to whom (the name, never the number), what they last said and the exact words, and that the bot will stay out of the chat. */
export async function whatsappCard(ctx: ToolCtx, args: WaSend): Promise<Card> {
  const chat = await findWhatsAppChat(ctx, args.conversation);
  const t = dict(ctx.lang);
  const last = [...chat.lines].reverse().find((l) => l.from === "them");
  const lines = [
    { label: NEW.field.platform[ctx.lang], value: t.wa.nav },
    { label: NEW.field.to[ctx.lang], value: clip(chat.name ?? "", 60) || t.messages.customer },
  ];
  const said = last ? clip(waLabel(last, t), 200) : "";
  if (said) lines.push({ label: NEW.field.lastMessage[ctx.lang], value: said });
  lines.push({ label: NEW.field.message[ctx.lang], value: args.text });
  // sendWhatsAppAction pauses the thread after a manual reply: the person should know before pressing Confirm.
  lines.push({ label: NEW.field.note[ctx.lang], value: NEW.waBotPaused[ctx.lang] });
  return { title: NEW.title.sendMessage[ctx.lang], lines };
}

/** Looked at again (a card can wait for its Confirm), then sent by the screen's action to the number the chat was found by. */
export async function whatsappSend(ctx: ToolCtx, args: WaSend): Promise<WriteResult> {
  const chat = await findWhatsAppChat(ctx, args.conversation);
  const r = await sendWhatsAppAction(chat.buyerId, args.text);
  return r.ok ? { ok: true, text: NEW.done.sent[ctx.lang] } : { ok: false, text: r.error };
}
