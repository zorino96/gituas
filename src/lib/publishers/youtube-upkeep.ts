// ---------------------------------------------------------------------------
//  YouTube API data upkeep — YouTube API Services Developer Policies III.E.4
// ---------------------------------------------------------------------------
//
//  Runs once a day (the daily cron), so every rule's 30-day limit holds:
//   - each connected channel: refresh the token (proves the person still
//     authorizes us) and re-read the channel's title and picture;
//   - access revoked at Google: the connection is deleted;
//   - links to videos we uploaded (audit log, news draft results) are kept
//     30 days at most, and removed at once when the channel is disconnected.
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

/** A YouTube result entry, as stored in audit metadata and news draft results. */
const isYt = (r: unknown): r is { target: "YT"; url?: string } => !!r && typeof r === "object" && (r as { target?: unknown }).target === "YT";

/** Remove YouTube video links: older than 30 days everywhere, and all of them for workspaces with no channel connected. */
export async function scrubYouTubeLinks(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - YT_LINK_DAYS * DAY);
  const connected = new Set(
    (await db.oAuthCredential.findMany({ where: { provider: "YOUTUBE" }, select: { tenantId: true } })).map((c) => c.tenantId),
  );
  const expired = (tenantId: string | null, at: Date) => at < cutoff || !tenantId || !connected.has(tenantId);
  let removed = 0;

  const logs = await db.auditLog.findMany({
    where: { action: "app.publish", metadata: { path: ["target"], equals: "YT" } },
    select: { id: true, tenantId: true, createdAt: true, metadata: true },
  });
  for (const l of logs) {
    const meta = (l.metadata ?? {}) as Record<string, unknown>;
    if (!("url" in meta) || !expired(l.tenantId, l.createdAt)) continue;
    const { url: _drop, ...rest } = meta;
    void _drop;
    await db.auditLog.update({ where: { id: l.id }, data: { metadata: rest as Prisma.InputJsonObject } });
    removed++;
  }

  const drafts = await db.newsDraft.findMany({
    where: { results: { array_contains: [{ target: "YT" }] } },
    select: { id: true, tenantId: true, publishedAt: true, updatedAt: true, results: true },
  });
  for (const d of drafts) {
    const results = Array.isArray(d.results) ? (d.results as unknown[]) : [];
    if (!expired(d.tenantId, d.publishedAt ?? d.updatedAt) || !results.some((r) => isYt(r) && r.url)) continue;
    const kept = results.map((r) => {
      if (!isYt(r)) return r;
      const { url: _drop, ...rest } = r;
      void _drop;
      return rest;
    });
    await db.newsDraft.update({ where: { id: d.id }, data: { results: kept as Prisma.InputJsonValue } });
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
