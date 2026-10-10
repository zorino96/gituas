// Higgsfield API (https://docs.higgsfield.ai): one key pair, held only on this server.
//
// A generation is submitted to POST /<application id> with the model's arguments as JSON and
// answers at once with a request id. The result comes back by webhook (?hf_webhook=<our URL>,
// sent only for completed / failed / nsfw) or by polling GET /requests/<id>/status. Only a
// successful generation is billed. Output files are kept by Higgsfield for about a week, so
// whatever we keep is copied to our own Blob straight away (src/lib/studio/jobs.ts).

import { createHmac, timingSafeEqual } from "node:crypto";

const BASE = "https://api.higgsfield.ai";
const TIMEOUT_MS = 20_000;

export type HfState = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";

export interface HfStatus {
  state: HfState;
  imageUrl: string | null;
  videoUrl: string | null;
  error: string | null;
}

/** Why a call did not go through, in words our screens can map to a message. */
export class HiggsfieldError extends Error {
  constructor(
    readonly reason: "not_configured" | "credentials" | "balance" | "busy" | "rejected" | "unavailable",
    message: string,
  ) {
    super(message);
  }
}

export function higgsfieldConfigured(): boolean {
  return !!process.env.HIGGSFIELD_KEY_ID?.trim() && !!process.env.HIGGSFIELD_KEY_SECRET?.trim();
}

function authHeader(): string {
  const id = process.env.HIGGSFIELD_KEY_ID?.trim();
  const secret = process.env.HIGGSFIELD_KEY_SECRET?.trim();
  if (!id || !secret) throw new HiggsfieldError("not_configured", "Higgsfield is not set up on this server.");
  return `Key ${id}:${secret}`;
}

/** The failure a non-2xx answer means. The body is cut short and never echoes our key. */
function failure(status: number, body: string): HiggsfieldError {
  const text = body.replace(/\s+/g, " ").slice(0, 200);
  if (status === 401 || status === 403) return new HiggsfieldError("credentials", `Higgsfield refused our key (${status}).`);
  if (status === 402 || /balance|credit|insufficient/i.test(text)) return new HiggsfieldError("balance", `Higgsfield balance is empty (${status}).`);
  if (status === 429) return new HiggsfieldError("busy", "Higgsfield is busy (429).");
  if (status === 400 || status === 422) return new HiggsfieldError("rejected", `Higgsfield rejected the request (${status}): ${text}`);
  return new HiggsfieldError("unavailable", `Higgsfield answered ${status}.`);
}

/**
 * Submit one generation. `app` is the model's application id (e.g. "bytedance/seedance-2.5/reference-to-video");
 * `idempotencyKey` makes a retried submit return the first request instead of starting a second one.
 */
export async function submitGeneration(
  app: string,
  args: Record<string, unknown>,
  opts: { webhookUrl?: string; idempotencyKey?: string } = {},
): Promise<{ requestId: string }> {
  if (!/^[a-z0-9][a-z0-9._-]*(\/[a-z0-9._-]+)+$/i.test(app)) throw new HiggsfieldError("rejected", "Not a Higgsfield application id.");
  const url = `${BASE}/${app}${opts.webhookUrl ? `?hf_webhook=${encodeURIComponent(opts.webhookUrl)}` : ""}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof HiggsfieldError) throw e;
    throw new HiggsfieldError("unavailable", "Higgsfield could not be reached.");
  }
  const body = await res.text();
  if (!res.ok) throw failure(res.status, body);
  const requestId = (JSON.parse(body || "{}") as { request_id?: unknown }).request_id;
  if (typeof requestId !== "string" || !requestId) throw new HiggsfieldError("unavailable", "Higgsfield did not return a request id.");
  return { requestId };
}

/** The request's state as Higgsfield reports it, read from its JSON (status, images[].url, video.url, error). */
export function parseStatus(data: unknown): HfStatus {
  const d = (data ?? {}) as { status?: unknown; images?: { url?: unknown }[]; video?: { url?: unknown }; error?: unknown };
  const states: HfState[] = ["queued", "in_progress", "completed", "failed", "nsfw", "canceled"];
  const state = states.includes(d.status as HfState) ? (d.status as HfState) : "in_progress";
  const image = Array.isArray(d.images) ? d.images.find((i) => typeof i?.url === "string")?.url : undefined;
  const video = typeof d.video?.url === "string" ? d.video.url : undefined;
  const httpsOnly = (u: unknown) => (typeof u === "string" && /^https:\/\//i.test(u) ? u : null);
  return {
    state,
    imageUrl: httpsOnly(image),
    videoUrl: httpsOnly(video),
    error: typeof d.error === "string" ? d.error.slice(0, 300) : null,
  };
}

/** Read one request's state from Higgsfield: the truth, whatever a webhook said. */
export async function generationStatus(requestId: string): Promise<HfStatus> {
  if (!/^[A-Za-z0-9-]{8,80}$/.test(requestId)) throw new HiggsfieldError("rejected", "Not a Higgsfield request id.");
  let res: Response;
  try {
    res = await fetch(`${BASE}/requests/${requestId}/status`, {
      headers: { Authorization: authHeader(), Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof HiggsfieldError) throw e;
    throw new HiggsfieldError("unavailable", "Higgsfield could not be reached.");
  }
  const body = await res.text();
  if (!res.ok) throw failure(res.status, body);
  return parseStatus(JSON.parse(body || "{}"));
}

/**
 * The secret in our webhook URL. Higgsfield does not sign its webhooks, so the URL carries a
 * token only we can make, and the handler still asks Higgsfield for the real state.
 */
export function webhookToken(secret = process.env.AUTH_SECRET): string {
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return createHmac("sha256", secret).update("higgsfield-webhook").digest("hex").slice(0, 32);
}

export function isWebhookToken(token: unknown, secret = process.env.AUTH_SECRET): boolean {
  if (typeof token !== "string" || !secret) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(webhookToken(secret));
  return a.length === b.length && timingSafeEqual(a, b);
}
