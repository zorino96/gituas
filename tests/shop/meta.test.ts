import { afterEach, describe, expect, it, vi } from "vitest";
import { backoffMs, classifyMetaError, retryable } from "@/lib/shop/meta-errors";
import { hideComment, likeComment, privateReply, replyToComment, sendDm, subscribeWebhooks, type StoreAccount } from "@/lib/shop/meta-client";

const err = (code: number, message = "", error_subcode?: number) => ({ error: { code, message, error_subcode } });

describe("classifyMetaError", () => {
  it("maps Graph errors to what the outbox should do", () => {
    expect(classifyMetaError(401, err(190))).toBe("token");
    expect(classifyMetaError(400, err(613))).toBe("rate");
    expect(classifyMetaError(429, {})).toBe("rate");
    expect(classifyMetaError(400, err(10, "Message sent outside of allowed window"))).toBe("window");
    expect(classifyMetaError(400, err(100, "Object does not exist", 33))).toBe("gone");
    expect(classifyMetaError(403, err(10, "Application does not have permission for this action"))).toBe("other");
    expect(classifyMetaError(400, err(10900, "Activity already replied to"))).toBe("duplicate");
    expect(classifyMetaError(500, err(2, "Service temporarily unavailable"))).toBe("other");
  });
  it("retries only rate limits and unknown failures, with capped exponential backoff", () => {
    expect(retryable("rate")).toBe(true);
    expect(retryable("other")).toBe(true);
    expect(retryable("window")).toBe(false);
    expect(backoffMs(1)).toBe(120_000);
    expect(backoffMs(10)).toBe(3_600_000);
  });
});

describe("meta-client requests", () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const reply = (body: unknown, status = 200) =>
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }));
  afterEach(() => { calls.length = 0; vi.unstubAllGlobals(); });

  const fb: StoreAccount = { platform: "META_FACEBOOK", accountId: "PAGE", token: "T" };
  const ig: StoreAccount = { platform: "META_INSTAGRAM", accountId: "IGID", token: "T" };

  it("replies under a comment on each platform", async () => {
    reply({ id: "R1" });
    expect(await replyToComment(fb, "C1", "سوپاس")).toEqual({ ok: true, id: "R1", recipientId: null });
    expect(calls[0].url).toBe("https://graph.facebook.com/v25.0/C1/comments?access_token=T");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ message: "سوپاس" });
    await replyToComment(ig, "C2", "hi");
    expect(calls[1].url).toBe("https://graph.instagram.com/v25.0/C2/replies?access_token=T");
  });

  it("sends a private reply to the comment and returns the buyer's messaging id", async () => {
    reply({ recipient_id: "PSID", message_id: "M1" });
    expect(await privateReply(fb, "C1", { text: "hi" })).toEqual({ ok: true, id: "M1", recipientId: "PSID" });
    expect(calls[0].url).toBe("https://graph.facebook.com/v25.0/PAGE/messages?access_token=T");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ recipient: { comment_id: "C1" }, message: { text: "hi" } });
    await privateReply(ig, "C2", { text: "hi" });
    expect(calls[1].url).toBe("https://graph.instagram.com/v25.0/IGID/messages?access_token=T");
  });

  it("likes and hides on Facebook, hides on Instagram, and refuses a like on Instagram", async () => {
    reply({ success: true });
    expect((await likeComment(fb, "C1")).ok).toBe(true);
    expect(calls[0].url).toBe("https://graph.facebook.com/v25.0/C1/likes?access_token=T");
    await hideComment(fb, "C1");
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ is_hidden: true });
    await hideComment(ig, "C2");
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ hide: true });
    expect(await likeComment(ig, "C2")).toEqual({ ok: false, failure: "gone", error: "Instagram has no API to like a comment" });
  });

  it("sends a DM with the response messaging type on Facebook", async () => {
    reply({ recipient_id: "PSID", message_id: "M2" });
    await sendDm(fb, "PSID", { text: "x" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ recipient: { id: "PSID" }, messaging_type: "RESPONSE", message: { text: "x" } });
  });

  it("subscribes the account to comment and message webhooks", async () => {
    reply({ success: true });
    await subscribeWebhooks(fb);
    expect(calls[0].url).toBe("https://graph.facebook.com/v25.0/PAGE/subscribed_apps?access_token=T&subscribed_fields=feed%2Cmessages");
    await subscribeWebhooks(ig);
    expect(calls[1].url).toBe("https://graph.instagram.com/v25.0/me/subscribed_apps?access_token=T&subscribed_fields=comments%2Cmessages");
  });

  it("turns a Graph error into a failure kind", async () => {
    reply(err(190, "Error validating access token"), 401);
    expect(await replyToComment(fb, "C1", "x")).toEqual({ ok: false, failure: "token", error: "401 190 Error validating access token" });
  });
});
