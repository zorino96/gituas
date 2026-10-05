// Server-side loaders for the merchant app. Every function is tenant-scoped and
// reads live from the platforms — nothing here is cached, so what the merchant
// sees is what their customers see.

import { cookies } from "next/headers";
import { auth, ensureWorkspace } from "@/auth";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { pickWorkspace } from "@/lib/workspace/pick";
import { trialEndsAtFrom } from "@/lib/billing/trial";
import type { Role } from "@/lib/newsroom/roles";
import { newestFirst, unexpired, usableOrRefreshable } from "@/lib/oauth/pick";
import { fetchComments, fetchConversations, fetchMedia, fetchUserInsights } from "@/lib/publishers/instagram-engage";
import {
  fetchPageCommentThreads,
  fetchPageConversations,
  fetchPageInsights,
  fetchPagePosts,
  fetchPageProfile,
} from "@/lib/publishers/facebook-engage";
import { fetchChannelStats, fetchRecentVideos } from "@/lib/publishers/youtube-engage";
import { fromFb, fromIg } from "@/lib/merchant/normalize";
import { youtubeBlock, type YouTubeBlock } from "@/lib/merchant/youtube-insights";
import type { MConversation, MPost } from "@/lib/merchant/types";

export type Kind = "MERCHANT" | "NEWS";

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  whatsappNumber: string | null;
  kind: Kind;
  kindChosen: boolean;
  /** The signed-in person's role in this workspace. */
  role: Role;
}

const WORKSPACE_SELECT = { id: true, slug: true, name: true, whatsappNumber: true, kind: true, kindChosen: true } as const;

/** Names the workspace a person with several is working in; checked against their memberships on every read. */
export const WS_COOKIE = "gm_ws";

async function membershipsOf(userId: string) {
  return db.membership.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { role: true, createdAt: true, tenant: { select: WORKSPACE_SELECT } },
  });
}

/** Every workspace the signed-in person belongs to, oldest membership first. */
export async function listWorkspaces(): Promise<Workspace[]> {
  const session = await auth();
  if (!session?.user?.id) return [];
  return (await membershipsOf(session.user.id)).map((m) => ({ ...m.tenant, role: m.role }));
}

export async function currentWorkspace(): Promise<Workspace | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  let rows = await membershipsOf(userId);
  if (rows.length === 0) {
    // Every signed-in person gets a workspace, however they signed up.
    await ensureWorkspace(userId, session.user?.name);
    rows = await membershipsOf(userId);
  }
  const chosen = (await cookies()).get(WS_COOKIE)?.value;
  const picked = pickWorkspace(
    rows.map((m) => ({ id: m.tenant.id, kindChosen: m.tenant.kindChosen, joinedAt: m.createdAt })),
    chosen,
  );
  const row = rows.find((m) => m.tenant.id === picked?.id);
  return row ? { ...row.tenant, role: row.role } : null;
}

/** Remember which workspace to open. Call only from a server action or route handler. */
export async function rememberWorkspace(tenantId: string): Promise<void> {
  (await cookies()).set(WS_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

/**
 * A new desk's starting settings: no keywords yet, the GDELT source, and the 14-day free trial.
 * Every way a workspace becomes a newsroom (claimKind, a new desk, a reused placeholder) ends
 * here, so this is the one place the trial starts — only if the workspace has none yet.
 */
export async function setupNewsDesk(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
  await tx.tenant.updateMany({ where: { id: tenantId, trialEndsAt: null }, data: { trialEndsAt: trialEndsAtFrom(new Date()) } });
  await tx.newsSettings.upsert({ where: { tenantId }, create: { tenantId, keywords: [] }, update: {} });
  await tx.newsSource.upsert({
    where: { tenantId_catalogId: { tenantId, catalogId: "gdelt" } },
    create: { tenantId, catalogId: "gdelt", name: "GDELT" },
    update: {},
  });
}

/** `/app` for a shop, `/newsroom` for a channel — the base every shared link hangs off. */
export function baseFor(kind: Kind): "/app" | "/newsroom" {
  return kind === "NEWS" ? "/newsroom" : "/app";
}

const DEFAULT_SHOP_NAME = "دووکانەکەم";
const DEFAULT_NEWS_NAME = "کەناڵەکەم";

/**
 * Claim a still-unclaimed workspace as a shop or a channel — the first
 * surface a new account opens decides it. The claim, the rename and (for
 * NEWS) the desk settings and GDELT source all happen in one transaction, so
 * a workspace never ends up claimed with its setup half-finished. If another
 * tab claimed first, this re-reads the tenant and returns it as it now is; on
 * any error the workspace is returned unchanged, still unclaimed. Already
 * claimed workspaces are returned as-is.
 */
export async function claimKind(ws: Workspace, kind: Kind): Promise<Workspace> {
  if (ws.kindChosen) return ws;
  try {
    const rename = kind === "NEWS" && ws.name === DEFAULT_SHOP_NAME;
    const claimed = await db.$transaction(async (tx) => {
      const { count } = await tx.tenant.updateMany({
        where: { id: ws.id, kindChosen: false },
        data: { kind, kindChosen: true, ...(rename ? { name: DEFAULT_NEWS_NAME } : {}) },
      });
      if (count === 0) return false;
      if (kind === "NEWS") await setupNewsDesk(tx, ws.id);
      await tx.auditLog.create({
        data: { tenantId: ws.id, actor: "USER", action: "app.kind_set", reasoning: `Claimed the workspace as ${kind}.`, metadata: { kind } },
      });
      return true;
    });
    if (!claimed) {
      const found = await db.tenant.findUnique({ where: { id: ws.id }, select: WORKSPACE_SELECT });
      return found ? { ...found, role: ws.role } : ws;
    }
    return { ...ws, kind, kindChosen: true, ...(rename ? { name: DEFAULT_NEWS_NAME } : {}) };
  } catch (e) {
    console.error("claimKind failed:", e instanceof Error ? e.message : "unknown error");
    return ws;
  }
}

export type Provider = "META_FACEBOOK" | "META_INSTAGRAM" | "TIKTOK" | "YOUTUBE";

export interface Connection {
  connected: boolean;
  name?: string;
  accountId?: string;
  avatarUrl?: string | null;
}

export type Connections = Record<Provider, Connection>;

export async function loadConnections(tenantId: string): Promise<Connections> {
  const pick = { providerAccountId: true, providerAccountName: true, avatarUrl: true } as const;
  const [fb, ig, tt, yt] = await Promise.all([
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
    // YouTube access tokens last an hour; the refresh token keeps the connection alive. A row whose
    // channel could not be read at connect time ("unknown", e.g. a suspended YouTube) never works.
    db.oAuthCredential.findFirst({
      where: { tenantId, provider: "YOUTUBE", NOT: { providerAccountId: "unknown" }, ...usableOrRefreshable() },
      orderBy: newestFirst,
      select: pick,
    }),
  ]);
  const shape = (c: typeof fb): Connection =>
    c
      ? { connected: true, name: c.providerAccountName ?? undefined, accountId: c.providerAccountId, avatarUrl: c.avatarUrl }
      : { connected: false };
  return { META_FACEBOOK: shape(fb), META_INSTAGRAM: shape(ig), TIKTOK: shape(tt), YOUTUBE: shape(yt) };
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
    return fromIg(items, Object.fromEntries(threads), { id: conns.META_INSTAGRAM.accountId, username: conns.META_INSTAGRAM.name });
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
  /** Threads the platform listed but would not return messages for — usually old ones. */
  unreadable: number;
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
  const readable = out.filter((c) => c.messages.length > 0 || c.participantId);
  return { conversations: readable, unreadable: out.length - readable.length, errors };
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

/**
 * The YouTube block for the insights page: channel counters and the most-viewed recent uploads.
 * Null when YouTube is not connected; a Google failure becomes an error the page shows, never a throw.
 */
export async function loadYouTube(tenantId: string, conns: Connections): Promise<YouTubeBlock | null> {
  if (!conns.YOUTUBE.connected) return null;
  const failed = (e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "YouTube failed" });
  const [stats, recent] = await Promise.all([
    fetchChannelStats(tenantId).catch(failed),
    fetchRecentVideos(tenantId, 10).catch(failed),
  ]);
  // The screen only says "didn't load"; the reason (Google's own message, never a token) goes to the log.
  if (!stats.ok || !recent.ok) console.error("[youtube insights]", stats.ok ? "" : stats.error, "|", recent.ok ? "" : recent.error);
  return youtubeBlock(stats, recent);
}
