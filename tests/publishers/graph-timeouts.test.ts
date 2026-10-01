import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { oAuthCredential: { findFirst: vi.fn(), update: vi.fn() } } }));
vi.mock("@/lib/vault", () => ({ vaultDecrypt: () => "token", vaultEncrypt: () => "sealed" }));

import { db } from "@/lib/db";
import { publishToFacebookPage } from "@/lib/publishers/facebook";
import { publishToInstagram } from "@/lib/publishers/instagram";

const m = db as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => body });

/** Every Graph call so far, by what it was for. */
let calls: { kind: string; init: RequestInit | undefined }[];
let containerStatus: string;

const kindOf = (url: string, init?: RequestInit) => {
  if (url.includes("content_publishing_limit")) return "quota";
  if (url.includes("fields=status_code")) return "status";
  if (url.includes("fields=permalink")) return "permalink";
  if (url.endsWith("/media_publish")) return "publish";
  if (url.endsWith("/media")) return "container";
  if (init?.method === "POST") return "fb-publish";
  return "other";
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  calls = [];
  containerStatus = "FINISHED";
  m.oAuthCredential.findFirst.mockResolvedValue({ id: "cred1", providerAccountId: "123", tokenEncrypted: "sealed", expiresAt: null });
  m.oAuthCredential.update.mockResolvedValue({});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const kind = kindOf(url, init);
      calls.push({ kind, init });
      if (kind === "quota") return json({ data: [{ quota_usage: 1, config: { quota_total: 100 } }] });
      if (kind === "container") return json({ id: "c1" });
      if (kind === "status") return json({ status_code: containerStatus });
      if (kind === "publish") return json({ id: "p1" });
      if (kind === "fb-publish") return json({ id: "ph1", post_id: "123_456" });
      return json({ permalink: "https://instagram.example/p1", permalink_url: "https://facebook.example/p1" });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const count = (kind: string) => calls.filter((c) => c.kind === kind).length;
const allTimed = () => calls.every((c) => c.init?.signal instanceof AbortSignal);
const photo = { caption: "caption", mediaUrl: "https://blob.example/card.jpg", mediaType: "IMAGE" as const };

/** Run the publish to its end on the fake clock; says how long it took on that clock. */
async function timed<T>(work: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const started = Date.now();
  const running = work();
  await vi.runAllTimersAsync();
  return { result: await running, ms: Date.now() - started };
}

describe("publishToInstagram", () => {
  it("gives every Graph call a timeout", async () => {
    const { result } = await timed(() => publishToInstagram("t1", photo));
    expect(result).toEqual({ ok: true, externalId: "p1", permalinkUrl: "https://instagram.example/p1" });
    expect(calls.map((c) => c.kind)).toEqual(["quota", "container", "status", "publish", "permalink"]);
    expect(allTimed()).toBe(true);
  });

  it("without a deadline waits for the container as long as it always did", async () => {
    containerStatus = "IN_PROGRESS";
    const { result, ms } = await timed(() => publishToInstagram("t1", photo));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/still processing/);
    expect(count("status")).toBe(9);
    expect(ms).toBe(40_000);
    expect(count("publish")).toBe(0);
  });

  it("with a deadline stops waiting in time, and does not publish", async () => {
    containerStatus = "IN_PROGRESS";
    const { result, ms } = await timed(() => publishToInstagram("t1", photo, 30_000));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/still processing/);
    expect(ms).toBeLessThanOrEqual(30_000);
    expect(count("status")).toBeGreaterThanOrEqual(2);
    expect(count("status")).toBeLessThan(9);
    expect(count("publish")).toBe(0);
  });

  it("with a deadline still publishes a container that is ready", async () => {
    const { result, ms } = await timed(() => publishToInstagram("t1", photo, 30_000));
    expect(result.ok).toBe(true);
    expect(ms).toBeLessThanOrEqual(30_000);
    expect(allTimed()).toBe(true);
  });

  it("says the post went out even when noting the token's use fails afterwards", async () => {
    m.oAuthCredential.update.mockRejectedValue(new Error("db down"));
    const { result } = await timed(() => publishToInstagram("t1", photo));
    expect(result).toMatchObject({ ok: true, externalId: "p1" });
  });

  it("reports a publish call that never answered instead of throwing", async () => {
    vi.mocked(fetch).mockImplementation((async (url: string, init?: RequestInit) => {
      const kind = kindOf(url, init);
      calls.push({ kind, init });
      if (kind === "publish") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      if (kind === "container") return json({ id: "c1" });
      if (kind === "status") return json({ status_code: "FINISHED" });
      return json({});
    }) as never);
    const { result } = await timed(() => publishToInstagram("t1", photo));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/did not answer/);
  });
});

describe("publishToFacebookPage", () => {
  it("gives every Graph call a timeout", async () => {
    const { result } = await timed(() => publishToFacebookPage("t1", { message: "caption", mediaUrl: photo.mediaUrl, mediaType: "IMAGE" }));
    expect(result).toEqual({ ok: true, externalId: "123_456", permalinkUrl: "https://facebook.example/p1" });
    expect(calls).toHaveLength(2);
    expect(allTimed()).toBe(true);
  });

  it("says the post went out even when noting the token's use fails afterwards", async () => {
    m.oAuthCredential.update.mockRejectedValue(new Error("db down"));
    const { result } = await timed(() => publishToFacebookPage("t1", { message: "caption", mediaUrl: photo.mediaUrl, mediaType: "IMAGE" }));
    expect(result).toMatchObject({ ok: true, externalId: "123_456" });
  });
});
