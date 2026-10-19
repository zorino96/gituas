// The account as the model sees it at the start of a turn: the section names as the person sees them, the settings and counts
// (no buyer's name, message or phone: that is what the read tools are for), and which features this deployment has.

import { loadConnections } from "@/app/app/data";
import { adVideoEnabled } from "@/lib/advideo/enabled";
import { imageEnabled } from "@/lib/ai/image";
import { opusAvailable } from "@/lib/ai/models";
import { loadAssistantState } from "@/lib/assistant/state";
import { maxPlanOpen } from "@/lib/billing/prices";
import { dict } from "@/lib/i18n";
import type { Actor } from "./confirm";
import type { Snapshot } from "./loop";

export async function snapshotFor(actor: Actor): Promise<Snapshot> {
  const t = dict(actor.lang);
  const conns = await loadConnections(actor.tenantId);
  const state = await loadAssistantState(actor.tenantId, {
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
  return { state, uiNames, features: { max: opusAvailable() && (maxPlanOpen() || hasMax), video, pictures: imageEnabled() } };
}
