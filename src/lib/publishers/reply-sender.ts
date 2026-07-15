// ---------------------------------------------------------------------------
//  Conversation reply sender — routes a drafted reply to the right platform
// ---------------------------------------------------------------------------
//
//  The reply-agent drafts text; this actually delivers it. Comments thread
//  under the original comment; DMs go back to the sender (subject to Meta's
//  24h window). Other platforms are not wired yet and report a clear error so
//  a reply is never marked SENT without actually leaving Gituas.

import { replyToComment, sendInstagramDM } from "./instagram-engage";
import { replyToPageComment, sendMessengerMessage } from "./facebook-engage";
import type { PublishResult } from "./index";

export interface ReplyTarget {
  platform: string;
  channelType: string;
  externalMessageId: string | null;
  externalThreadId: string | null;
}

export async function sendConversationReply(
  tenantId: string,
  target: ReplyTarget,
  reply: string,
): Promise<PublishResult> {
  if (target.platform === "META_INSTAGRAM") {
    if (target.channelType === "COMMENT") {
      if (!target.externalMessageId) return { ok: false, error: "Comment id missing" };
      const r = await replyToComment(tenantId, target.externalMessageId, reply);
      return { ok: r.ok, externalId: r.data?.id, error: r.error };
    }
    if (target.channelType === "DM") {
      const recipient = target.externalThreadId;
      if (!recipient) return { ok: false, error: "DM recipient missing" };
      const r = await sendInstagramDM(tenantId, recipient, reply);
      return { ok: r.ok, externalId: r.data?.messageId, error: r.error };
    }
  }
  if (target.platform === "META_FACEBOOK") {
    if (target.channelType === "COMMENT") {
      if (!target.externalMessageId) return { ok: false, error: "Comment id missing" };
      const r = await replyToPageComment(tenantId, target.externalMessageId, reply);
      return { ok: r.ok, externalId: r.data?.id, error: r.error };
    }
    if (target.channelType === "DM") {
      const psid = target.externalThreadId;
      if (!psid) return { ok: false, error: "Messenger recipient (PSID) missing" };
      const r = await sendMessengerMessage(tenantId, psid, reply);
      return { ok: r.ok, externalId: r.data?.messageId, error: r.error };
    }
  }
  return { ok: false, error: `Sending ${target.channelType} replies on ${target.platform} is not enabled yet` };
}
