// WhatsApp Cloud API for the shop. It runs on its own Meta app, "Gituas Chat",
// so that app's review never touches the main Gituas app's Facebook/Instagram access.
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api

import { classifyMetaError, type MetaFailure } from "@/lib/shop/meta-errors";
import type { MetaMessage, SendResult } from "@/lib/shop/meta-client";

/** The Gituas Chat app (public, like any Facebook app id). */
export const WA_APP_ID = "1602806601306973";
/** Facebook Login for Business configuration that runs WhatsApp Embedded Signup (public). */
export const WA_CONFIG_ID = process.env.NEXT_PUBLIC_WA_CONFIG_ID ?? "";
export const WA_GRAPH = "v25.0";
const BASE = `https://graph.facebook.com/${WA_GRAPH}`;
/**
 * Webhook handshake string. Not a secret: it only lets Meta confirm the URL;
 * every event is still checked against the app secret's signature.
 */
export const WA_VERIFY_TOKEN = "gituas-whatsapp-webhook";

type Body = Record<string, unknown> & { error?: { code?: number; message?: string } };
type GraphResult = { ok: true; body: Body } | { ok: false; failure: MetaFailure; error: string };

async function graph(path: string, token: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<GraphResult> {
  try {
    const res = await fetch(`${BASE}/${path}`, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as Body;
    if (!res.ok || body.error) {
      return { ok: false, failure: classifyMetaError(res.status, body), error: `${res.status} ${body.error?.code ?? ""} ${body.error?.message ?? ""}`.replace(/\s+/g, " ").trim().slice(0, 300) };
    }
    return { ok: true, body };
  } catch (e) {
    return { ok: false, failure: "other", error: e instanceof Error ? e.message : "request failed" };
  }
}

/** The Messenger-shaped shop message as a WhatsApp message body, or null when WhatsApp has no equivalent. */
export function toWaBody(m: MetaMessage): Record<string, unknown> | null {
  if ("text" in m) return { type: "text", text: { body: m.text, preview_url: true } };
  if (m.attachment.type === "image") return { type: "image", image: { link: m.attachment.payload.url } };
  return null;
}

/** Send one message from the shop's number to a buyer (wa_id = their phone digits). */
export async function sendWa(phoneNumberId: string, token: string, to: string, body: Record<string, unknown>): Promise<SendResult> {
  const r = await graph(`${phoneNumberId}/messages`, token, { method: "POST", body: { messaging_product: "whatsapp", recipient_type: "individual", to, ...body } });
  if (!r.ok) return r;
  const b = r.body as { messages?: { id?: string }[]; contacts?: { wa_id?: string }[] };
  return { ok: true, id: b.messages?.[0]?.id ?? null, recipientId: b.contacts?.[0]?.wa_id ?? to };
}

export function sendWaMessage(phoneNumberId: string, token: string, to: string, m: MetaMessage): Promise<SendResult> {
  const body = toWaBody(m);
  if (!body) return Promise.resolve({ ok: false, failure: "other", error: "message type not supported on WhatsApp" });
  return sendWa(phoneNumberId, token, to, body);
}

export function sendWaTemplate(phoneNumberId: string, token: string, to: string, name: string, language: string): Promise<SendResult> {
  return sendWa(phoneNumberId, token, to, { type: "template", template: { name, language: { code: language } } });
}

// ---- Embedded Signup -------------------------------------------------------

/** Trade the Embedded Signup code for the business's token (server side; needs the app secret). */
export async function exchangeCode(code: string): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const secret = process.env.WHATSAPP_APP_SECRET?.trim();
  if (!secret) return { ok: false, error: "WHATSAPP_APP_SECRET is not set" };
  try {
    const res = await fetch(`${BASE}/oauth/access_token?${new URLSearchParams({ client_id: WA_APP_ID, client_secret: secret, code })}`, { signal: AbortSignal.timeout(15_000) });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: { message?: string } };
    if (!res.ok || !body.access_token) return { ok: false, error: body.error?.message ?? `status ${res.status}` };
    return { ok: true, token: body.access_token };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "request failed" };
  }
}

export async function phoneInfo(phoneNumberId: string, token: string): Promise<{ display: string; name: string } | null> {
  const r = await graph(`${phoneNumberId}?fields=display_phone_number,verified_name`, token);
  if (!r.ok) return null;
  const b = r.body as { display_phone_number?: string; verified_name?: string };
  return { display: b.display_phone_number ?? "", name: b.verified_name ?? "" };
}

/** Put the number on the Cloud API with a two-step PIN. Not for numbers that stay on the WhatsApp Business app. */
export function registerNumber(phoneNumberId: string, token: string, pin: string): Promise<GraphResult> {
  return graph(`${phoneNumberId}/register`, token, { method: "POST", body: { messaging_product: "whatsapp", pin } });
}

/** Deliver this WhatsApp account's webhooks to the Gituas Chat app. */
export function subscribeApp(wabaId: string, token: string): Promise<GraphResult> {
  return graph(`${wabaId}/subscribed_apps`, token, { method: "POST" });
}

// ---- Message templates -----------------------------------------------------

export interface WaTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  body: string;
}

export async function listTemplates(wabaId: string, token: string): Promise<{ ok: true; templates: WaTemplate[] } | { ok: false; error: string }> {
  const r = await graph(`${wabaId}/message_templates?fields=id,name,language,category,status,components&limit=100`, token);
  if (!r.ok) return { ok: false, error: r.error };
  const data = (r.body.data ?? []) as { id: string; name: string; language: string; category: string; status: string; components?: { type: string; text?: string }[] }[];
  return {
    ok: true,
    templates: data.map((t) => ({ id: t.id, name: t.name, language: t.language, category: t.category, status: t.status, body: t.components?.find((c) => c.type === "BODY")?.text ?? "" })),
  };
}

export const TEMPLATE_CATEGORIES = ["MARKETING", "UTILITY"] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];
/** Template languages offered in the form. WhatsApp has no Kurdish code; Sorani templates go under Arabic. */
export const TEMPLATE_LANGUAGES = ["ar", "en_US", "en", "tr", "fa"] as const;

/** Lowercase letters, digits and underscores, as WhatsApp requires. */
export function templateName(raw: string): string | null {
  const n = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return /^[a-z0-9_]{1,512}$/.test(n) ? n : null;
}

export async function createTemplate(
  wabaId: string,
  token: string,
  t: { name: string; language: string; category: TemplateCategory; body: string },
): Promise<{ ok: true; id: string; status: string } | { ok: false; error: string }> {
  const r = await graph(`${wabaId}/message_templates`, token, {
    method: "POST",
    body: { name: t.name, language: t.language, category: t.category, components: [{ type: "BODY", text: t.body }] },
  });
  if (!r.ok) return { ok: false, error: r.error };
  const b = r.body as { id?: string; status?: string };
  return { ok: true, id: b.id ?? "", status: b.status ?? "PENDING" };
}
