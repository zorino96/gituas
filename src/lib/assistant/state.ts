// What the assistant may know about the asking account: settings and counts only, read from the database for this
// workspace. No buyer's name, message or phone number goes in, and nothing secret.

import { adVideoEnabled } from "@/lib/advideo/enabled";
import { workspaceVideos } from "@/lib/advideo/limits";
import { imageEnabled } from "@/lib/ai/image";
import { imagesLeft } from "@/lib/ai/image-left";
import { allowanceOf, OPTIONAL_SHARE } from "@/lib/ai/meter";
import { db } from "@/lib/db";
import { interviewDone, loadProfile, profileEnabled } from "@/lib/shop/profile";

export interface AssistantConnections {
  facebook: { connected: boolean; name?: string };
  instagram: { connected: boolean; name?: string };
  tiktok: { connected: boolean };
  youtube: { connected: boolean };
}

const DAY = 86_400_000;

/** A compact JSON-able picture of the account. */
export async function loadAssistantState(tenantId: string, connections: AssistantConnections, now = Date.now()) {
  const stores = await db.store.findMany({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    take: 15,
    select: {
      name: true,
      plan: true,
      planPaidUntil: true,
      id: true,
      fbPageId: true,
      igUserId: true,
      igUsername: true,
      automationEnabled: true,
      pausedReason: true,
      aiReplies: true,
      autoMode: true,
      autoPerDay: true,
      videoAutoMode: true,
    },
  });
  const video = adVideoEnabled();
  // What each owner told Gituas about their work (only while the interview is switched on); their own words, no buyer data.
  const profiles = profileEnabled() ? await Promise.all(stores.map((s) => loadProfile(s.id))) : null;
  const [allowance, videos, images, waiting, products] = await Promise.all([
    allowanceOf({ scope: tenantId }).catch(() => null),
    video ? workspaceVideos(tenantId).catch(() => null) : null,
    imageEnabled() ? imagesLeft(tenantId).catch(() => null) : null,
    db.conversationMessage.count({ where: { store: { tenantId }, outcome: "FLAGGED", createdAt: { gt: new Date(now - 7 * DAY) } } }).catch(() => null),
    // Names only: so the chat can say which product a post or a video is about.
    db.product.findMany({ where: { active: true, store: { tenantId } }, orderBy: { updatedAt: "desc" }, take: 30, select: { name: true } }).catch(() => []),
  ]);
  return {
    today: new Date(now).toISOString().slice(0, 10),
    shops: stores.map((s, i) => {
      const lapsed = s.plan !== "FREE" && !!s.planPaidUntil && s.planPaidUntil.getTime() < now;
      return {
        name: s.name || (s.igUsername ? `@${s.igUsername}` : "(no name)"),
        // A plan whose days ran out works as Free from that day, whatever is stored until the daily sweep.
        plan: lapsed ? "FREE" : s.plan,
        planDaysRanOut: lapsed,
        paidUntil: s.planPaidUntil ? s.planPaidUntil.toISOString().slice(0, 10) : null,
        facebookPageConnected: !!s.fbPageId,
        instagramConnected: !!s.igUserId,
        // The switch starts OFF for a new shop; "paused" means the page's access expired.
        automaticReplies: !s.automationEnabled ? "switched off by the owner" : s.pausedReason ? `paused (${s.pausedReason})` : "on",
        aiWrittenReplies: !!s.aiReplies,
        autoPosts: s.autoMode,
        autoPostsPerDay: s.autoPerDay,
        dailyVideo: video ? s.videoAutoMode : undefined,
        setupInterview: profiles ? (interviewDone(profiles[i]) ? "done" : "not done yet") : undefined,
        business: profiles?.[i]
          ? {
              goal: profiles[i]!.goalText ?? profiles[i]!.goal ?? undefined,
              kind: profiles[i]!.category ?? undefined,
              offer: profiles[i]!.offerLine ?? undefined,
              customers: profiles[i]!.customer.length ? profiles[i]!.customer : undefined,
              deliversTo: profiles[i]!.sellsTo.length ? profiles[i]!.sellsTo : undefined,
              tone: profiles[i]!.tone ?? undefined,
            }
          : undefined,
      };
    }),
    connectedAccounts: connections,
    aiAllowance: allowance ? { percentUsed: allowance.percent, optionalFeaturesStopAtPercent: Math.round(OPTIONAL_SHARE * 100) } : null,
    aiVideos: videos ? { leftThisMonthFastModel: videos.LITE.left, leftThisMonthStrongModel: videos.PRO.left, madeToday: videos.today.used, perDay: videos.today.max } : undefined,
    aiPicturesLeft: images ?? undefined,
    messagesWaitingForOwnerThisWeek: waiting,
    productNames: products.map((p) => p.name.slice(0, 80)),
  };
}
