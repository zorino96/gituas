// Server-side loaders for the merchant app. Every function is tenant-scoped and
// reads live from the platforms — nothing here is cached, so what the merchant
// sees is what their customers see.

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { newestFirst, unexpired, usableOrRefreshable } from "@/lib/oauth/pick";
import { fetchComments, fetchConversations, fetchMedia, fetchUserInsights } from "@/lib/publishers/instagram-engage";
import {
  fetchPageCommentThreads,
  fetchPageConversations,
  fetchPageInsights,
  fetchPagePosts,
  fetchPageProfile,
} from "@/lib/publishers/facebook-engage";
import { fromFb, fromIg } from "@/lib/merchant/normalize";
import type { MConversation, MPost } from "@/lib/merchant/types";

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  whatsappNumber: string | null;
}

export async function currentWorkspace(): Promise<Workspace | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return db.tenant.findFirst({
    where: { ownerId: session.user.id },
    select: { id: true, slug: true, name: true, whatsappNumber: true },
  });
}

export type Provider = "META_FACEBOOK" | "META_INSTAGRAM" | "TIKTOK";

export interface Connection {
  connected: boolean;
  name?: string;
  accountId?: string;
  avatarUrl?: string | null;
}

export type Connections = Record<Provider, Connection>;

export async function loadConnections(tenantId: string): Promise<Connections> {
  const pick = { providerAccountId: true, providerAccountName: true, avatarUrl: true } as const;
  const [fb, ig, tt] = await Promise.all([
    db.oAuthCredential.findFirst({
      where: { tenantId, provider: "META_FACEBOOK", NOT: { providerAccountId: { startsWith: "act_" } }, ...unexpired() },
      orderBy: newestFirst,
      select: pick,
    }),
    db.oAuthCredential.findFirst({
      where: { tenantId, provider: "META_INSTAGRAM", ...unexpired() },
      orderBy: newestFirst,
      select: pick,
    }),
    db.oAuthCredential.findFirst({
      where: { tenantId, provider: "TIKTOK", ...usableOrRefreshable() },
      orderBy: newestFirst,
      select: pick,
    }),
  ]);
  const shape = (c: typeof fb): Connection =>
    c
      ? { connected: true, name: c.providerAccountName ?? undefined, accountId: c.providerAccountId, avatarUrl: c.avatarUrl }
      : { connected: false };
  return { META_FACEBOOK: shape(fb), META_INSTAGRAM: shape(ig), TIKTOK: shape(tt) };
}

export interface PostsResult {
  posts: MPost[];
  /** One line per platform that failed to load; the rest still render. */
  errors: { platform: "FB" | "IG"; message: string }[];
}

/** Recent posts from both platforms with their comment threads, newest first. */
export async function loadPosts(tenantId: string, conns: Connections, perPlatform = 8): Promise<PostsResult> {
  const errors: PostsResult["errors"] = [];

  const ig = async (): Promise<MPost[]> => {
    if (!conns.META_INSTAGRAM.connected) return [];
    const media = await fetchMedia(tenantId, perPlatform);
    if (!media.ok) {
      errors.push({ platform: "IG", message: media.error ?? "Instagram failed" });
      return [];
    }
    const items = media.data ?? [];
    const threads = await Promise.all(
      items.map(async (m) => {
        if (!m.comments_count) return [m.id, []] as const;
        const c = await fetchComments(tenantId, m.id);
        return [m.id, c.ok ? (c.data ?? []) : []] as const;
      }),
    );
    return fromIg(items, Object.fromEntries(threads), conns.META_INSTAGRAM.name);
  };

  const fb = async (): Promise<MPost[]> => {
    if (!conns.META_FACEBOOK.connected) return [];
    const posts = await fetchPagePosts(tenantId, perPlatform);
    if (!posts.ok) {
      errors.push({ platform: "FB", message: posts.error ?? "Facebook failed" });
      return [];
    }
    const items = posts.data ?? [];
    const threads = await Promise.all(
      items.map(async (p) => {
        if (!p.comments_count) return [p.id, []] as const;
        const c = await fetchPageCommentThreads(tenantId, p.id);
        return [p.id, c.ok ? (c.data ?? []) : []] as const;
      }),
    );
    return fromFb(items, Object.fromEntries(threads), conns.META_FACEBOOK.accountId);
  };

  const [igPosts, fbPosts] = await Promise.all([ig(), fb()]);
  const posts = [...igPosts, ...fbPosts].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return { posts, errors };
}

export interface ConversationsResult {
  conversations: MConversation[];
  errors: { platform: "FB" | "IG"; message: string }[];
}

export async function loadConversations(tenantId: string, conns: Connections): Promise<ConversationsResult> {
  const errors: ConversationsResult["errors"] = [];
  const [ig, fb] = await Promise.all([
    conns.META_INSTAGRAM.connected ? fetchConversations(tenantId) : Promise.resolve(null),
    conns.META_FACEBOOK.connected ? fetchPageConversations(tenantId) : Promise.resolve(null),
  ]);
  const out: MConversation[] = [];
  if (ig && !ig.ok) errors.push({ platform: "IG", message: ig.error ?? "Instagram failed" });
  for (const c of ig?.data ?? []) {
    out.push({
      platform: "IG",
      id: c.id,
      participantId: c.participantId,
      participantName: c.participantName,
      withinWindow: c.withinWindow,
      updatedAt: c.updatedTime,
      messages: c.messages.map((m) => ({ id: m.id, text: m.text ?? "", fromUs: m.fromBusiness, createdAt: m.createdTime })),
    });
  }
  if (fb && !fb.ok) errors.push({ platform: "FB", message: fb.error ?? "Facebook failed" });
  for (const c of fb?.data ?? []) {
    out.push({
      platform: "FB",
      id: c.id,
      participantId: c.participantId,
      participantName: c.participantName,
      withinWindow: c.withinWindow,
      updatedAt: c.updatedTime,
      messages: c.messages.map((m) => ({ id: m.id, text: m.text ?? "", fromUs: m.fromPage, createdAt: m.createdTime })),
    });
  }
  out.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return { conversations: out, errors };
}

export interface InsightsResult {
  fbFollowers?: number;
  fbMetrics: { name: string; value: number }[];
  igMetrics: { name: string; value: number }[];
  waTaps7d: number;
  notes: string[];
}

export async function loadInsights(tenantId: string, conns: Connections): Promise<InsightsResult> {
  const notes: string[] = [];
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [profile, fbMetrics, igMetrics, waTaps7d] = await Promise.all([
    conns.META_FACEBOOK.connected ? fetchPageProfile(tenantId) : Promise.resolve(null),
    conns.META_FACEBOOK.connected ? fetchPageInsights(tenantId) : Promise.resolve(null),
    conns.META_INSTAGRAM.connected ? fetchUserInsights(tenantId) : Promise.resolve(null),
    db.auditLog.count({ where: { tenantId, action: "wa.tap", createdAt: { gte: since } } }),
  ]);
  if (profile && !profile.ok) notes.push(`FB: ${profile.error}`);
  if (fbMetrics && !fbMetrics.ok) notes.push(`FB: ${fbMetrics.error}`);
  if (igMetrics && !igMetrics.ok) notes.push(`IG: ${igMetrics.error}`);
  return {
    fbFollowers: profile?.ok ? profile.data?.followers : undefined,
    fbMetrics: fbMetrics?.ok ? (fbMetrics.data ?? []) : [],
    igMetrics: igMetrics?.ok ? (igMetrics.data ?? []) : [],
    waTaps7d,
    notes,
  };
}
