import { createHmac, timingSafeEqual } from "node:crypto";

// Wayl (wayl.io) payment links. Docs: https://wayl.io/docs, OpenAPI: https://api.thewayl.com/openapi.v1.json
const BASE = "https://api.thewayl.com";

/** Wayl's status for a paid link. */
export const PAID_STATUS = "Complete";

export function waylConfigured(): boolean {
  return !!process.env.WAYL_TOKEN;
}

/** Test until the owner sets WAYL_ENV=live. */
export function waylEnv(): "test" | "live" {
  return process.env.WAYL_ENV === "live" ? "live" : "test";
}

export interface WaylLink {
  id: string | null;
  url: string | null;
  status: string | null;
  total: number | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function toLink(body: unknown): WaylLink {
  const d = ((body as { data?: unknown })?.data ?? {}) as Record<string, unknown>;
  const total = typeof d.total === "number" ? d.total : typeof d.total === "string" && d.total.trim() ? Number(d.total) : null;
  return { id: str(d.id), url: str(d.url), status: str(d.status), total: total != null && Number.isFinite(total) ? total : null };
}

async function call(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "X-WAYL-AUTHENTICATION": process.env.WAYL_TOKEN ?? "", ...(init.body ? { "Content-Type": "application/json" } : {}) },
      signal: AbortSignal.timeout(15_000),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
  } catch (e) {
    return { ok: false, status: 0, body: { message: e instanceof Error ? e.message : "request failed" } };
  }
}

export async function createLink(i: {
  referenceId: string;
  total: number;
  label: string;
  webhookUrl: string;
  webhookSecret: string;
  redirectionUrl: string;
}): Promise<{ ok: true; link: WaylLink } | { ok: false; error: string }> {
  const r = await call("/api/v1/links", {
    method: "POST",
    body: JSON.stringify({
      env: waylEnv(),
      referenceId: i.referenceId,
      total: i.total,
      currency: "IQD",
      customParameter: "",
      lineItem: [{ label: i.label.slice(0, 100), amount: i.total, type: "increase" }],
      webhookUrl: i.webhookUrl,
      webhookSecret: i.webhookSecret,
      redirectionUrl: i.redirectionUrl,
    }),
  });
  if (!r.ok) return { ok: false, error: `Wayl ${r.status}: ${JSON.stringify((r.body as { message?: unknown })?.message ?? r.body).slice(0, 200)}` };
  const link = toLink(r.body);
  return link.url ? { ok: true, link } : { ok: false, error: "Wayl returned no link" };
}

/** The link as Wayl sees it now — the authority on whether an invoice is paid. */
export async function getLink(referenceId: string): Promise<WaylLink | null> {
  const r = await call(`/api/v1/links/${encodeURIComponent(referenceId)}`);
  return r.ok ? toLink(r.body) : null;
}

/** HMAC-SHA256 of the raw body with the invoice's secret; Wayl's encoding is not documented, so hex (with or without "sha256=") and base64 are accepted. */
export function signatureValid(raw: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const got = header.trim().replace(/^sha256=/i, "");
  const mac = createHmac("sha256", secret).update(raw);
  const digest = mac.digest();
  for (const expected of [digest.toString("hex"), digest.toString("base64")]) {
    const a = Buffer.from(got.length === 64 ? got.toLowerCase() : got);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}
