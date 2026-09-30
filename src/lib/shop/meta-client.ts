import { db } from "@/lib/db";
import { newestFirst, unexpired } from "@/lib/oauth/pick";
import { FB_V } from "@/lib/publishers/facebook";
import { lazyRefresh, V as IG_V } from "@/lib/publishers/instagram";
import { vaultDecrypt } from "@/lib/vault";
import type { FbElement } from "./compose";
import { classifyMetaError, type MetaFailure } from "./meta-errors";
import type { MetaPlatform } from "./webhook-parse";

export type { MetaPlatform };

export interface StoreAccount {
  platform: MetaPlatform;
  /** Facebook Page id or Instagram user id. */
  accountId: string;
  token: string;
}

export type MetaMessage =
  | { text: string }
  | { attachment: { type: "template"; payload: { template_type: "generic"; elements: FbElement[] } } }
  | { attachment: { type: "image"; payload: { url: string; is_reusable?: boolean } } };

export type SendResult = { ok: true; id: string | null; recipientId: string | null } | { ok: false; failure: MetaFailure; error: string };

const base = (acc: StoreAccount) => (acc.platform === "META_FACEBOOK" ? FB_V : IG_V);
const url = (acc: StoreAccount, path: string, extra: Record<string, string> = {}) =>
  `${base(acc)}/${path}?${new URLSearchParams({ access_token: acc.token, ...extra })}`;

async function call(target: string, init: RequestInit = {}): Promise<SendResult> {
  try {
    const res = await fetch(target, {
      ...init,
      headers: init.body ? { "Content-Type": "application/json" } : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: number; message?: string }; id?: string; message_id?: string; recipient_id?: string };
    if (!res.ok || body.error) {
      const failure = classifyMetaError(res.status, body);
      return { ok: false, failure, error: `${res.status} ${body.error?.code ?? ""} ${body.error?.message ?? ""}`.replace(/\s+/g, " ").trim().slice(0, 300) };
    }
    return { ok: true, id: body.message_id ?? body.id ?? null, recipientId: body.recipient_id ?? null };
  } catch (e) {
    return { ok: false, failure: "other", error: e instanceof Error ? e.message : "request failed" };
  }
}

const post = (target: string, body?: unknown) => call(target, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

/** The store's token for one platform, or null when it must be reconnected. */
export async function accountFor(store: { tenantId: string; fbPageId: string | null; igUserId: string | null }, platform: MetaPlatform): Promise<StoreAccount | null> {
  const accountId = platform === "META_FACEBOOK" ? store.fbPageId : store.igUserId;
  if (!accountId) return null;
  const cred = await db.oAuthCredential.findFirst({
    where: { tenantId: store.tenantId, provider: platform, providerAccountId: accountId, ...unexpired() },
    orderBy: newestFirst,
  });
  if (!cred) return null;
  try {
    const token = vaultDecrypt(cred.tokenEncrypted);
    if (platform === "META_FACEBOOK") return { platform, accountId, token };
    const fresh = await lazyRefresh({ id: cred.id, igUserId: accountId, token, expiresAt: cred.expiresAt });
    return { platform, accountId, token: fresh.token };
  } catch {
    return null;
  }
}

export function replyToComment(acc: StoreAccount, commentId: string, text: string): Promise<SendResult> {
  return acc.platform === "META_FACEBOOK"
    ? post(url(acc, `${commentId}/comments`), { message: text.slice(0, 8000) })
    : post(url(acc, `${commentId}/replies`), { message: text.slice(0, 2200) });
}

/** One message per comment, within 7 days of it. Instagram accepts text only. */
export function privateReply(acc: StoreAccount, commentId: string, message: MetaMessage): Promise<SendResult> {
  return post(url(acc, `${acc.accountId}/messages`), { recipient: { comment_id: commentId }, message });
}

export async function likeComment(acc: StoreAccount, commentId: string): Promise<SendResult> {
  if (acc.platform !== "META_FACEBOOK") return { ok: false, failure: "gone", error: "Instagram has no API to like a comment" };
  return post(url(acc, `${commentId}/likes`));
}

export function hideComment(acc: StoreAccount, commentId: string): Promise<SendResult> {
  return post(url(acc, commentId), acc.platform === "META_FACEBOOK" ? { is_hidden: true } : { hide: true });
}

/** Inside the 24-hour window only (the buyer wrote to us). */
export function sendDm(acc: StoreAccount, recipientId: string, message: MetaMessage): Promise<SendResult> {
  const body = acc.platform === "META_FACEBOOK" ? { recipient: { id: recipientId }, messaging_type: "RESPONSE", message } : { recipient: { id: recipientId }, message };
  return post(url(acc, `${acc.accountId}/messages`), body);
}

/** When the post was published, or null if Graph will not say. */
export async function fetchPostCreatedAt(acc: StoreAccount, postId: string): Promise<Date | null> {
  const field = acc.platform === "META_FACEBOOK" ? "created_time" : "timestamp";
  try {
    const res = await fetch(url(acc, postId, { fields: field }), { signal: AbortSignal.timeout(10_000) });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const raw = typeof body[field] === "string" ? (body[field] as string) : null;
    const d = raw ? new Date(raw) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

/** Without this, Meta sends no comment or message webhooks for the account. */
export function subscribeWebhooks(acc: StoreAccount): Promise<SendResult> {
  return acc.platform === "META_FACEBOOK"
    ? post(url(acc, `${acc.accountId}/subscribed_apps`, { subscribed_fields: "feed,messages" }))
    : post(url(acc, "me/subscribed_apps", { subscribed_fields: "comments,messages" }));
}
