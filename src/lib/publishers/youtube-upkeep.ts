// ---------------------------------------------------------------------------
//  YouTube API data upkeep — YouTube API Services Developer Policies III.E.4
// ---------------------------------------------------------------------------
//
//  Runs once a day (the daily cron), so every rule's 30-day limit holds:
//   - each connected channel: refresh the token (proves the person still
//     authorizes us) and re-read the channel's title and picture;
//   - access revoked at Google: the connection is deleted;
//   - links and ids of videos we uploaded, and the channel's id and name next
//     to them (audit log, news draft and scheduled-post results), are kept
//     30 days at most, and removed at once when that channel is disconnected.
//  Statistics are never stored: the dashboard reads them live.

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { vaultDecrypt, vaultEncrypt } from "@/lib/vault";

const DAY = 86_400_000;
/** The longest a YouTube video link is kept (III.E.4.c). */
export const YT_LINK_DAYS = 30;
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CHANNEL_URL = "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true";

type Check = { state: "ok"; token: string; expiresIn: number | null } | { state: "revoked" } | { state: "error" };

async function refresh(refreshTokenEncrypted: string | null): Promise<Check> {
  const clientId = process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.AUTH_GOOGLE_SECRET;
  if (!refreshTokenEncrypted || !clientId || !clientSecret) return { state: "error" };
  let refreshToken: string;
  try {
    refreshToken = vaultDecrypt(refreshTokenEncrypted);
  } catch {
    return { state: "error" };
  }
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number; error?: string } | null;
    // invalid_grant: the person removed Gituas in their Google Account (or the grant expired).
    if (j?.error === "invalid_grant") return { state: "revoked" };
    if (!res.ok || !j?.access_token) return { state: "error" };
    return { state: "ok", token: j.access_token, expiresIn: j.expires_in ?? null };
  } catch {
    return { state: "error" };
  }
}

/** A YouTube result entry, as stored in audit metadata, news draft results and scheduled-post results. */
type YtEntry = { target: "YT"; accountId?: string } & Record<string, unknown>;
const isYt = (r: unknown): r is YtEntry => !!r && typeof r === "object" && (r as { target?: unknown }).target === "YT";

/** What YouTube API Services gave us about an upload: its link, video id and the channel's id and name. */
const YT_FIELDS = ["url", "externalId", "accountId", "accountName"] as const;
const hasYtData = (r: Record<string, unknown>) => YT_FIELDS.some((k) => k in r);
function withoutYtData<T extends Record<string, unknown>>(r: T): T {
  const rest: Record<string, unknown> = { ...r };
  for (const k of YT_FIELDS) delete rest[k];
  return rest as T;
}

/**
 * Remove what YouTube API Services gave us about uploads: after 30 days everywhere, and at once for
 * a channel that is no longer connected. Entries that name their channel are matched by channel;
 * older ones without a channel id go when their workspace has no channel left.
 */
export async function scrubYouTubeLinks(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - YT_LINK_DAYS * DAY);
  const creds = await db.oAuthCredential.findMany({ where: { provider: "YOUTUBE" }, select: { tenantId: true, providerAccountId: true } });
  const channels = new Set(creds.map((c) => `${c.tenantId}:${c.providerAccountId}`));
  const tenants = new Set(creds.map((c) => c.tenantId));
  const expired = (tenantId: string | null, r: YtEntry, at: Date) =>
    at < cutoff || !tenantId || (r.accountId ? !channels.has(`${tenantId}:${r.accountId}`) : !tenants.has(tenantId));
  let removed = 0;

  const logs = await db.auditLog.findMany({
    where: { action: { in: ["app.publish", "app.publish_failed"] }, metadata: { path: ["target"], equals: "YT" } },
    select: { id: true, tenantId: true, createdAt: true, metadata: true },
  });
  for (const l of logs) {
    const meta = (l.metadata ?? {}) as YtEntry;
    if (!hasYtData(meta) || !expired(l.tenantId, meta, l.createdAt)) continue;
    await db.auditLog.update({ where: { id: l.id }, data: { metadata: withoutYtData(meta) as Prisma.InputJsonObject } });
    removed++;
  }

  // News drafts and scheduled posts keep a result list with one entry per target and account.
  const scrubList = (tenantId: string, list: unknown, at: Date): unknown[] | null => {
    const results = Array.isArray(list) ? (list as unknown[]) : [];
    let changed = false;
    const kept = results.map((r) => {
      if (!isYt(r) || !hasYtData(r) || !expired(tenantId, r, at)) return r;
      changed = true;
      return withoutYtData(r);
    });
    return changed ? kept : null;
  };

  const drafts = await db.newsDraft.findMany({
    where: { results: { array_contains: [{ target: "YT" }] } },
    select: { id: true, tenantId: true, publishedAt: true, updatedAt: true, results: true },
  });
  for (const d of drafts) {
    const kept = scrubList(d.tenantId, d.results, d.publishedAt ?? d.updatedAt);
    if (!kept) continue;
    await db.newsDraft.update({ where: { id: d.id }, data: { results: kept as Prisma.InputJsonValue } });
    removed++;
  }

  const scheduled = await db.scheduledPost.findMany({
    where: { result: { array_contains: [{ target: "YT" }] } },
    select: { id: true, tenantId: true, updatedAt: true, result: true },
  });
  for (const p of scheduled) {
    const kept = scrubList(p.tenantId, p.result, p.updatedAt);
    if (!kept) continue;
    await db.scheduledPost.update({ where: { id: p.id }, data: { result: kept as Prisma.InputJsonValue } });
    removed++;
  }
  return removed;
}

/** The daily pass: re-authorize and refresh each connected channel, delete revoked ones, then scrub old links. */
export async function youtubeUpkeep(now: Date = new Date()): Promise<{ channels: number; refreshed: number; revoked: number; linksRemoved: number }> {
  const creds = await db.oAuthCredential.findMany({
    where: { provider: "YOUTUBE" },
    select: { id: true, tenantId: true, providerAccountId: true, refreshTokenEncrypted: true },
  });
  let refreshed = 0;
  let revoked = 0;
  for (const c of creds) {
    const r = await refresh(c.refreshTokenEncrypted);
    if (r.state === "revoked") {
      await db.oAuthCredential.delete({ where: { id: c.id } });
      await db.auditLog.create({
        data: { tenantId: c.tenantId, actor: "SYSTEM", action: "integrations.revoked", reasoning: "YouTube access was removed in the Google Account; the connection was deleted.", metadata: { provider: "YOUTUBE" } },
      });
      revoked++;
      continue;
    }
    if (r.state !== "ok") continue;
    const data: Prisma.OAuthCredentialUpdateInput = {
      tokenEncrypted: vaultEncrypt(r.token),
      expiresAt: r.expiresIn ? new Date(now.getTime() + r.expiresIn * 1000) : null,
    };
    try {
      const res = await fetch(CHANNEL_URL, { headers: { Authorization: `Bearer ${r.token}` }, signal: AbortSignal.timeout(15_000) });
      const j = (await res.json().catch(() => null)) as { items?: { id?: string; snippet?: { title?: string; thumbnails?: Record<string, { url?: string }> } }[] } | null;
      const ch = j?.items?.find((x) => x.id === c.providerAccountId);
      if (ch?.snippet) {
        data.providerAccountName = ch.snippet.title ?? null;
        data.avatarUrl = ch.snippet.thumbnails?.default?.url ?? null;
      }
    } catch {
      // the token refresh alone still counts: the channel is re-read tomorrow
    }
    await db.oAuthCredential.update({ where: { id: c.id }, data });
    refreshed++;
  }
  const linksRemoved = await scrubYouTubeLinks(now);
  return { channels: creds.length, refreshed, revoked, linksRemoved };
}
