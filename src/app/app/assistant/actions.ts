"use server";

import { adVideoEnabled } from "@/lib/advideo/enabled";
import { imageEnabled } from "@/lib/ai/image";
import { claimSlot, refundSlot, takeDaily } from "@/lib/ai/slots";
import { askAssistant, cleanTurns, type ChatTurn } from "@/lib/assistant/ask";
import { assistantCaps, ASSISTANT_SLOTS, NO_SHOP_CAPS, REFUNDS_PER_DAY } from "@/lib/assistant/caps";
import { loadAssistantState } from "@/lib/assistant/state";
import { maxPlanOpen } from "@/lib/billing/prices";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { limitsOf } from "@/lib/shop/tenant-plans";
import { currentWorkspace, loadConnections } from "../data";

export type AssistantResult =
  | { ok: true; reply: string; followups: string[] }
  /** `contact`: the person is offered the support number with the message. */
  | { ok: false; error: string; contact: boolean };

/** One question to the assistant. It explains and looks; it changes nothing. */
export async function askAssistantAction(input: { messages: ChatTurn[] }): Promise<AssistantResult> {
  const lang = await getLang();
  const t = dict(lang);
  const a = t.assistant;
  const ws = await currentWorkspace();
  if (!ws) return { ok: false, error: a.signIn, contact: false };
  if (ws.kind !== "MERCHANT") return { ok: false, error: a.notShop, contact: true };
  // The answers look at billing and automation settings: only people who can open those may ask.
  if (!can(ws.role, "configure")) return { ok: false, error: t.nr.team.roles.notAllowed, contact: false };
  const turns = cleanTurns(input?.messages);
  if (!turns.length) return { ok: false, error: a.failed, contact: true };

  const limits = await limitsOf(ws.id);
  const noShop = limits.aiUsd <= 0;
  const slot = await claimSlot(ws.id, ASSISTANT_SLOTS, noShop ? NO_SHOP_CAPS : assistantCaps(limits.aiUsd));
  if (!slot.ok) return { ok: false, error: slot.error === "daily" ? a.limit : a.limitMonth, contact: true };

  try {
    const conns = await loadConnections(ws.id);
    const state = await loadAssistantState(ws.id, {
      facebook: { connected: !!conns.META_FACEBOOK.connected, name: conns.META_FACEBOOK.name },
      instagram: { connected: !!conns.META_INSTAGRAM.connected, name: conns.META_INSTAGRAM.name },
      tiktok: { connected: !!conns.TIKTOK.connected },
      youtube: { connected: !!conns.YOUTUBE.connected },
    });
    const video = adVideoEnabled();
    const uiNames: Record<string, string> = {
      today: t.nav.today,
      comments: t.nav.comments,
      messages: t.nav.messages,
      orders: t.nav.orders,
      whatsapp: t.wa.nav,
      publish: t.nav.publish,
      ...(video ? { ai_video: t.nav.video } : {}),
      auto_replies: t.nav.automation,
      auto_posts: t.nav.autopilot,
      boost: t.nav.boost,
      insights: t.nav.insights,
      settings: t.layout.settings,
      plan_and_billing: t.billing.title,
    };
    const hasMax = state.shops.some((s) => s.plan === "MAX");
    const answer = await askAssistant({
      tenantId: ws.id,
      lang,
      turns,
      uiNames,
      state,
      features: { max: maxPlanOpen() || hasMax, video, pictures: imageEnabled() },
      uncounted: noShop,
    });
    return { ok: true, ...answer };
  } catch {
    // No answer was made: the place goes back, a few times a day (a failure after a paid call must not loop for free).
    if ((await takeDaily(ws.id, "assistant_refund_day", 1, REFUNDS_PER_DAY).catch(() => 0)) > 0) {
      await refundSlot(ws.id, ASSISTANT_SLOTS, slot).catch(() => undefined);
    }
    return { ok: false, error: a.failed, contact: true };
  }
}
