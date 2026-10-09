"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { dict, getLang } from "@/lib/i18n";
import { normalizePhone } from "@/lib/merchant/phone";
import { can } from "@/lib/newsroom/roles";
import { accountFor, type StoreAccount } from "@/lib/shop/meta-client";
import { pauseThread } from "@/lib/shop/pause";
import { vaultEncrypt } from "@/lib/vault";
import {
  createTemplate,
  exchangeCode,
  phoneInfo,
  registerNumber,
  sendWa,
  sendWaTemplate,
  subscribeApp,
  templateName,
  TEMPLATE_CATEGORIES,
  TEMPLATE_LANGUAGES,
  type TemplateCategory,
} from "@/lib/whatsapp/cloud";
import { currentWorkspace } from "../data";

export type Result = { ok: true } | { ok: false; error: string };

const PATH = "/app/whatsapp";
const TEXT_MAX = 4096;
const DAY = 86_400_000;

async function audit(tenantId: string, action: string, reasoning: string, metadata: Prisma.InputJsonObject = {}) {
  await db.auditLog.create({ data: { tenantId, actor: "USER", action, reasoning, metadata } });
}

async function session(need: "configure" | "engage") {
  const [ws, t] = await Promise.all([currentWorkspace(), getLang().then(dict)]);
  const e = t.wa.errors;
  if (!ws) return { ok: false as const, error: e.signIn };
  if (ws.kind !== "MERCHANT") return { ok: false as const, error: t.wa.shopOnly };
  if (!can(ws.role, need)) return { ok: false as const, error: e.notAllowed };
  return { ok: true as const, ws, t };
}

/** The shop store that holds (or will hold) the WhatsApp number. */
async function waStore(tenantId: string) {
  return (
    (await db.store.findFirst({ where: { tenantId, waPhoneNumberId: { not: null } }, select: { id: true, tenantId: true, fbPageId: true, igUserId: true, waPhoneNumberId: true, waBusinessId: true } })) ??
    (await db.store.findFirst({ where: { tenantId }, orderBy: { createdAt: "asc" }, select: { id: true, tenantId: true, fbPageId: true, igUserId: true, waPhoneNumberId: true, waBusinessId: true } }))
  );
}

async function connectedAccount(tenantId: string): Promise<{ acc: StoreAccount; storeId: string; wabaId: string } | null> {
  const store = await waStore(tenantId);
  if (!store?.waPhoneNumberId || !store.waBusinessId) return null;
  const acc = await accountFor(store, "WHATSAPP");
  return acc ? { acc, storeId: store.id, wabaId: store.waBusinessId } : null;
}

/** Attach a WhatsApp number to the workspace's shop store and keep its token. The newest connection wins. */
async function attachNumber(
  ws: { id: string; name: string },
  n: { phoneNumberId: string; wabaId: string; token: string; info: { display: string; name: string }; pin: string | null },
): Promise<void> {
  // Whoever can manage this number in Meta now owns it for automation.
  await db.store.updateMany({
    where: { waPhoneNumberId: n.phoneNumberId, tenantId: { not: ws.id } },
    data: { waPhoneNumberId: null, waBusinessId: null, waDisplayPhone: null, waPinEncrypted: null },
  });
  const store = (await waStore(ws.id)) ?? (await db.store.create({ data: { tenantId: ws.id, name: n.info.name || ws.name }, select: { id: true } }));
  await db.store.update({
    where: { id: store.id },
    data: { waPhoneNumberId: n.phoneNumberId, waBusinessId: n.wabaId, waDisplayPhone: n.info.display, waPinEncrypted: n.pin ? vaultEncrypt(n.pin) : null },
  });
  await db.oAuthCredential.upsert({
    where: { tenantId_provider_providerAccountId: { tenantId: ws.id, provider: "META_WHATSAPP", providerAccountId: n.phoneNumberId } },
    create: {
      tenantId: ws.id,
      provider: "META_WHATSAPP",
      providerAccountId: n.phoneNumberId,
      providerAccountName: n.info.name || n.info.display,
      scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
      tokenEncrypted: vaultEncrypt(n.token),
    },
    update: { providerAccountName: n.info.name || n.info.display, tokenEncrypted: vaultEncrypt(n.token), expiresAt: null },
  });
}

/**
 * Connect a number the business already manages in Meta, with its own access token: Meta's
 * test number (App Review) or a number set up by hand in WhatsApp Manager. The number is
 * already registered there, so only the webhooks are routed to us.
 */
export async function connectWhatsAppTokenAction(input: { phoneNumberId: string; wabaId: string; token: string }): Promise<Result> {
  const s = await session("configure");
  if (!s.ok) return s;
  const { ws, t } = s;
  const e = t.wa.errors;
  const phoneNumberId = String(input?.phoneNumberId ?? "").trim();
  const wabaId = String(input?.wabaId ?? "").trim();
  const token = String(input?.token ?? "").trim();
  if (!/^\d{5,25}$/.test(phoneNumberId) || !/^\d{5,25}$/.test(wabaId) || token.length < 20 || /\s/.test(token)) return { ok: false, error: e.manualBad };
  const info = await phoneInfo(phoneNumberId, token);
  if (!info) return { ok: false, error: e.manualBad };
  if (!(await subscribeApp(wabaId, token)).ok) return { ok: false, error: e.subscribe };
  await attachNumber(ws, { phoneNumberId, wabaId, token, info, pin: null });
  await audit(ws.id, "app.whatsapp_connect", `Connected WhatsApp ${info.display} with an access token.`, { phoneNumberId, wabaId, manual: true });
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Finish Embedded Signup: trade the code for the business token, put the number
 * on the Cloud API (unless it stays on the WhatsApp Business app), route its
 * webhooks to us, and attach it to the shop.
 */
export async function connectWhatsAppAction(input: { code: string; wabaId: string; phoneNumberId: string; coexist: boolean }): Promise<Result> {
  const s = await session("configure");
  if (!s.ok) return s;
  const { ws, t } = s;
  const e = t.wa.errors;
  if (!/^\d+$/.test(input.wabaId) || !/^\d+$/.test(input.phoneNumberId) || !input.code) return { ok: false, error: e.exchange };
  if (!process.env.WHATSAPP_APP_SECRET) return { ok: false, error: e.secretMissing };

  const x = await exchangeCode(input.code);
  if (!x.ok) return { ok: false, error: e.exchange };
  const token = x.token;

  const info = await phoneInfo(input.phoneNumberId, token);
  if (!info) return { ok: false, error: e.exchange };

  const pin = String(randomInt(100_000, 1_000_000));
  if (!input.coexist) {
    const r = await registerNumber(input.phoneNumberId, token, pin);
    if (!r.ok) return { ok: false, error: e.register(r.error) };
  }
  if (!(await subscribeApp(input.wabaId, token)).ok) return { ok: false, error: e.subscribe };

  await attachNumber(ws, { phoneNumberId: input.phoneNumberId, wabaId: input.wabaId, token, info, pin: input.coexist ? null : pin });
  await audit(ws.id, "app.whatsapp_connect", `Connected WhatsApp ${info.display}.`, { phoneNumberId: input.phoneNumberId, wabaId: input.wabaId, coexist: input.coexist });
  revalidatePath(PATH);
  return { ok: true };
}

/** Stop answering on WhatsApp. The number itself stays registered and working. */
export async function disconnectWhatsAppAction(): Promise<Result> {
  const s = await session("configure");
  if (!s.ok) return s;
  const { ws } = s;
  const store = await waStore(ws.id);
  if (store?.waPhoneNumberId) {
    await db.oAuthCredential.deleteMany({ where: { tenantId: ws.id, provider: "META_WHATSAPP", providerAccountId: store.waPhoneNumberId } });
    await db.store.update({ where: { id: store.id }, data: { waPhoneNumberId: null, waBusinessId: null, waDisplayPhone: null, waPinEncrypted: null } });
    await audit(ws.id, "app.whatsapp_disconnect", "Disconnected WhatsApp.", {});
  }
  revalidatePath(PATH);
  return { ok: true };
}

/** A reply typed by the merchant, inside the buyer's 24-hour window. The bot then stays out of the chat. */
export async function sendWhatsAppAction(to: string, text: string): Promise<Result> {
  const s = await session("engage");
  if (!s.ok) return s;
  const { ws, t } = s;
  const e = t.wa.errors;
  const body = text.trim();
  if (!body) return { ok: false, error: e.emptyText };
  if ([...body].length > TEXT_MAX) return { ok: false, error: e.tooLong(TEXT_MAX) };
  const c = await connectedAccount(ws.id);
  if (!c) return { ok: false, error: e.notConnected };
  const last = await db.conversationMessage.findFirst({
    where: { storeId: c.storeId, platform: "WHATSAPP", direction: "INBOUND", authorId: to },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (!last || Date.now() - last.createdAt.getTime() > DAY) return { ok: false, error: e.outsideWindow };

  const r = await sendWa(c.acc.accountId, c.acc.token, to, { type: "text", text: { body, preview_url: true } });
  if (!r.ok) return { ok: false, error: r.failure === "window" ? e.outsideWindow : e.failed(r.error) };
  await db.conversationMessage.create({
    data: { storeId: c.storeId, platform: "WHATSAPP", channelType: "DM", direction: "OUTBOUND", status: "SENT", content: body, externalMessageId: r.id, externalThreadId: to, authorId: to },
  });
  await pauseThread(ws.id, "WHATSAPP", to);
  await audit(ws.id, "app.whatsapp_send", "Sent a WhatsApp message.", {});
  revalidatePath(PATH);
  return { ok: true };
}

/** Send an approved template: a first message, or one after the 24-hour window. */
export async function sendWhatsAppTemplateAction(rawTo: string, name: string, language: string): Promise<Result> {
  const s = await session("engage");
  if (!s.ok) return s;
  const { ws, t } = s;
  const e = t.wa.errors;
  const n = normalizePhone(rawTo);
  if (!n.ok) return { ok: false, error: e.badPhone };
  const c = await connectedAccount(ws.id);
  if (!c) return { ok: false, error: e.notConnected };
  const r = await sendWaTemplate(c.acc.accountId, c.acc.token, n.digits, name, language);
  if (!r.ok) return { ok: false, error: e.failed(r.error) };
  await db.conversationMessage.create({
    data: { storeId: c.storeId, platform: "WHATSAPP", channelType: "DM", direction: "OUTBOUND", status: "SENT", content: `[template] ${name}`, externalMessageId: r.id, externalThreadId: n.digits, authorId: n.digits },
  });
  await audit(ws.id, "app.whatsapp_template_send", `Sent the WhatsApp template ${name}.`, { name, language });
  revalidatePath(PATH);
  return { ok: true };
}

export async function createWhatsAppTemplateAction(input: { name: string; language: string; category: string; body: string }): Promise<Result> {
  const s = await session("configure");
  if (!s.ok) return s;
  const { ws, t } = s;
  const e = t.wa.errors;
  const name = templateName(input.name);
  if (!name) return { ok: false, error: e.badTemplateName };
  const body = input.body.trim();
  if (!body) return { ok: false, error: e.emptyText };
  if ([...body].length > 1024) return { ok: false, error: e.tooLong(1024) };
  if (!(TEMPLATE_LANGUAGES as readonly string[]).includes(input.language) || !(TEMPLATE_CATEGORIES as readonly string[]).includes(input.category)) {
    return { ok: false, error: e.failed("language/category") };
  }
  const c = await connectedAccount(ws.id);
  if (!c) return { ok: false, error: e.notConnected };
  const r = await createTemplate(c.wabaId, c.acc.token, { name, language: input.language, category: input.category as TemplateCategory, body });
  if (!r.ok) return { ok: false, error: e.failed(r.error) };
  await audit(ws.id, "app.whatsapp_template_create", `Submitted the WhatsApp template ${name}.`, { name, language: input.language, category: input.category });
  revalidatePath(PATH);
  return { ok: true };
}
