// What the assistant may know about the asking account: settings and counts only, read from the database for this
// workspace. No buyer's name, message or phone number goes in, and nothing secret.

import { adVideoEnabled } from "@/lib/advideo/enabled";
import { ownerTypeOf } from "@/lib/shop/owner-type";
import { healStoreNames } from "@/lib/shop/store-names";
import { workspaceVideos } from "@/lib/advideo/limits";
import { imageEnabled } from "@/lib/ai/image";
import { imagesLeft } from "@/lib/ai/image-left";
import { allowanceOf, OPTIONAL_SHARE } from "@/lib/ai/meter";
import { db } from "@/lib/db";
import { interviewDone, loadProfiles, profileEnabled, type Profile } from "@/lib/shop/profile";
import { rulesEnabled } from "@/lib/shop/rules/enabled";

export interface AssistantConnections {
  facebook: { connected: boolean; name?: string };
  instagram: { connected: boolean; name?: string };
  tiktok: { connected: boolean };
  youtube: { connected: boolean };
}

const DAY = 86_400_000;

/** What the assistant may read of a store's profile: short values in the owner's own words, no buyer data. */
function businessOf(p: Profile | null) {
  if (!p) return undefined;
  const short = (v: string | null) => (v ? Array.from(v).slice(0, 80).join("") : undefined);
  return {
    goal: short(p.goalText ?? p.goal),
    kind: p.category ?? undefined,
    offer: short(p.offerLine),
    customers: p.customer.length ? p.customer : undefined,
    deliversTo: p.sellsTo.length ? (p.sellsTo.length >= 19 ? "everywhere" : `${p.sellsTo.length} cities`) : undefined,
    tone: p.tone ?? undefined,
  };
}

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
  // The names of the Pages and Instagram accounts each group holds, so the chat can say "Facebook: The Secret File" instead of guessing.
  const named = await Promise.resolve()
    .then(() => db.oAuthCredential.findMany({ where: { tenantId, provider: { in: ["META_FACEBOOK", "META_INSTAGRAM"] } }, select: { provider: true, providerAccountId: true, providerAccountName: true } }))
    .catch(() => [] as { provider: string; providerAccountId: string; providerAccountName: string | null }[]);
  const accountName = (provider: string, id: string | null): string | null => {
    if (!id) return null;
    const n = named.find((c) => c.provider === provider && c.providerAccountId === id)?.providerAccountName;
    return n ? n.replace(/\s+/g, " ").trim().slice(0, 60) || "(connected)" : "(connected)";
  };
  // A store named after a Page that was renamed since is brought back in line, so the chat (and every card) says the name the owner knows.
  const renamed = await healStoreNames(tenantId, stores, named);
  // What each owner told Gituas about their work (only while the interview is switched on); their own words, no buyer data.
  const profiles = profileEnabled() ? await loadProfiles(stores.map((s) => s.id)) : null;
  const [allowance, videos, images, waiting, products, rules] = await Promise.all([
    allowanceOf({ scope: tenantId }).catch(() => null),
    video ? workspaceVideos(tenantId).catch(() => null) : null,
    imageEnabled() ? imagesLeft(tenantId).catch(() => null) : null,
    db.conversationMessage.count({ where: { store: { tenantId }, outcome: "FLAGGED", createdAt: { gt: new Date(now - 7 * DAY) } } }).catch(() => null),
    // Names only: so the chat can say which product a post or a video is about.
    db.product.findMany({ where: { active: true, store: { tenantId } }, orderBy: { updatedAt: "desc" }, take: 30, select: { name: true } }).catch(() => []),
    // Counts of the owner's automatic rules, only while they are switched on (one grouped query; a failure leaves the line out).
    rulesEnabled()
      ? db.shopRule.groupBy({ by: ["status"], where: { tenantId, status: { in: ["ACTIVE", "PAUSED", "PAUSED_AUTO"] } }, _count: { _all: true } }).catch(() => null)
      : null,
  ]);
  return {
    today: new Date(now).toISOString().slice(0, 10),
    // Who the owner says they are (from their own answer to "how does your page earn for you?"): a creator is not spoken to as a seller.
    ownerType: profiles ? ownerTypeOf([...profiles.values()].map((p) => p.goal)) : "unknown",
    shops: stores.map((s) => {
      const lapsed = s.plan !== "FREE" && !!s.planPaidUntil && s.planPaidUntil.getTime() < now;
      return {
        name: renamed.get(s.id) || s.name || (s.igUsername ? `@${s.igUsername}` : "(no name)"),
        // A plan whose days ran out works as Free from that day, whatever is stored until the daily sweep.
        plan: lapsed ? "FREE" : s.plan,
        planDaysRanOut: lapsed,
        paidUntil: s.planPaidUntil ? s.planPaidUntil.toISOString().slice(0, 10) : null,
        facebookPageConnected: !!s.fbPageId,
        instagramConnected: !!s.igUserId,
        // Which Page and which Instagram account this group holds (null = none).
        facebookPage: accountName("META_FACEBOOK", s.fbPageId),
        instagram: s.igUserId ? (s.igUsername ? `@${s.igUsername}` : accountName("META_INSTAGRAM", s.igUserId)) : null,
        // The switch starts OFF for a new shop; "paused" means the page's access expired.
        automaticReplies: !s.automationEnabled ? "switched off by the owner" : s.pausedReason ? `paused (${s.pausedReason})` : "on",
        aiWrittenReplies: !!s.aiReplies,
        autoPosts: s.autoMode,
        autoPostsPerDay: s.autoPerDay,
        dailyVideo: video ? s.videoAutoMode : undefined,
        setupInterview: profiles ? (interviewDone(profiles.get(s.id) ?? null) ? "done" : "not done yet") : undefined,
        business: businessOf(profiles?.get(s.id) ?? null),
      };
    }),
    connectedAccounts: connections,
    aiAllowance: allowance ? { percentUsed: allowance.percent, optionalFeaturesStopAtPercent: Math.round(OPTIONAL_SHARE * 100) } : null,
    aiVideos: videos ? { leftThisMonthFastModel: videos.LITE.left, leftThisMonthStrongModel: videos.PRO.left, madeToday: videos.today.used, perDay: videos.today.max } : undefined,
    aiPicturesLeft: images ?? undefined,
    messagesWaitingForOwnerThisWeek: waiting,
    automaticRules: rules ? { active: rules.filter((r) => r.status === "ACTIVE").reduce((n, r) => n + r._count._all, 0), paused: rules.filter((r) => r.status !== "ACTIVE").reduce((n, r) => n + r._count._all, 0) } : undefined,
    productNames: products.map((p) => p.name.slice(0, 80)),
  };
}
