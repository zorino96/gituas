// What the assistant may know about the asking account: settings and counts only, read from the database for this
// workspace. No buyer's name, message or phone number goes in, and nothing secret.

import { adVideoEnabled } from "@/lib/advideo/enabled";
import { workspaceVideos } from "@/lib/advideo/limits";
import { imageEnabled } from "@/lib/ai/image";
import { imagesLeft } from "@/lib/ai/image-left";
import { allowanceOf, OPTIONAL_SHARE } from "@/lib/ai/meter";
import { db } from "@/lib/db";

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
  const [allowance, videos, images, waiting] = await Promise.all([
    allowanceOf({ scope: tenantId }).catch(() => null),
    video ? workspaceVideos(tenantId).catch(() => null) : null,
    imageEnabled() ? imagesLeft(tenantId).catch(() => null) : null,
    db.conversationMessage.count({ where: { store: { tenantId }, outcome: "FLAGGED", createdAt: { gt: new Date(now - 7 * DAY) } } }).catch(() => null),
  ]);
  return {
    today: new Date(now).toISOString().slice(0, 10),
    shops: stores.map((s) => {
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
      };
    }),
    connectedAccounts: connections,
    aiAllowance: allowance ? { percentUsed: allowance.percent, optionalFeaturesStopAtPercent: Math.round(OPTIONAL_SHARE * 100) } : null,
    aiVideos: videos ? { leftThisMonthFastModel: videos.LITE.left, leftThisMonthStrongModel: videos.PRO.left, madeToday: videos.today.used, perDay: videos.today.max } : undefined,
    aiPicturesLeft: images ?? undefined,
    messagesWaitingForOwnerThisWeek: waiting,
  };
}
