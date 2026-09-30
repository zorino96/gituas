import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLink, getLink, signatureValid } from "@/lib/billing/wayl";

describe("signatureValid", () => {
  const raw = '{"referenceId":"inv1","paymentStatus":"Complete"}';
  const hex = createHmac("sha256", "secret-123456").update(raw).digest("hex");
  it("accepts hex, sha256= prefixed hex and base64", () => {
    expect(signatureValid(raw, hex, "secret-123456")).toBe(true);
    expect(signatureValid(raw, `sha256=${hex}`, "secret-123456")).toBe(true);
    expect(signatureValid(raw, createHmac("sha256", "secret-123456").update(raw).digest("base64"), "secret-123456")).toBe(true);
  });
  it("rejects a wrong or missing signature", () => {
    expect(signatureValid(raw, hex, "other-secret")).toBe(false);
    expect(signatureValid(raw + " ", hex, "secret-123456")).toBe(false);
    expect(signatureValid(raw, null, "secret-123456")).toBe(false);
  });
});

describe("Wayl requests", () => {
  const calls: { url: string; init: RequestInit }[] = [];
  beforeEach(() => { process.env.WAYL_TOKEN = "tok"; delete process.env.WAYL_ENV; });
  afterEach(() => { calls.length = 0; vi.unstubAllGlobals(); delete process.env.WAYL_TOKEN; });
  const respond = (body: unknown, status = 200) =>
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify(body), { status }); }));

  it("creates a test-mode IQD link with one line item", async () => {
    respond({ data: { id: "L1", url: "https://link.thewayl.com/pay?id=x", status: "Created" } }, 201);
    const r = await createLink({ referenceId: "inv1", total: 8000, label: "Gituas — بازرگان", webhookUrl: "https://gituas.com/api/billing/wayl", webhookSecret: "s".repeat(32), redirectionUrl: "https://gituas.com/app/billing?invoice=inv1" });
    expect(r).toEqual({ ok: true, link: { id: "L1", url: "https://link.thewayl.com/pay?id=x", status: "Created", total: null } });
    expect(calls[0].url).toBe("https://api.thewayl.com/api/v1/links");
    expect((calls[0].init.headers as Record<string, string>)["X-WAYL-AUTHENTICATION"]).toBe("tok");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      env: "test", referenceId: "inv1", total: 8000, currency: "IQD", customParameter: "",
      lineItem: [{ label: "Gituas — بازرگان", amount: 8000, type: "increase" }],
      webhookUrl: "https://gituas.com/api/billing/wayl", webhookSecret: "s".repeat(32), redirectionUrl: "https://gituas.com/app/billing?invoice=inv1",
    });
  });

  it("reads a link's status and total", async () => {
    respond({ data: { id: "L1", url: "u", status: "Complete", total: "8000" } });
    expect(await getLink("inv1")).toEqual({ id: "L1", url: "u", status: "Complete", total: 8000 });
    expect(calls[0].url).toBe("https://api.thewayl.com/api/v1/links/inv1");
  });

  it("reports failures without throwing", async () => {
    respond({ message: "Store not verified" }, 403);
    const r = await createLink({ referenceId: "inv2", total: 8000, label: "x", webhookUrl: "https://a", webhookSecret: "s".repeat(32), redirectionUrl: "https://b" });
    expect(r.ok).toBe(false);
    expect(await getLink("inv2")).toBeNull();
  });
});
