// ---------------------------------------------------------------------------
//  YouTube publishing — Google OAuth + YouTube Data API v3 (videos.insert)
// ---------------------------------------------------------------------------
//
//  Uploads a video to the connected channel. YouTube access tokens live only
//  1 hour, so we refresh with the stored refresh_token before each publish.
//
//  NOTE: while the Google Cloud project is unverified (pre-audit), the
//  youtube.upload scope forces uploaded videos to `private` regardless of the
//  requested privacyStatus. The owner + added test users can still upload; the
//  audit lifts the restriction for everyone else.

import { db } from "@/lib/db";
import { accountWhere } from "@/lib/oauth/account-scope";
import { vaultDecrypt, vaultEncrypt } from "@/lib/vault";
import { newestFirst, usableOrRefreshable } from "@/lib/oauth/pick";
import type { PublishResult } from "./index";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=multipart";

/** Return a currently-valid access token, refreshing via the refresh_token when
 *  the stored one is (near) expired. Persists the refreshed token.
 *  Shared with the integrations probe (lib/integrations/probe.ts). */
export async function validYouTubeToken(tenantId: string): Promise<string | null> {
  return (await youTubeCredential(tenantId))?.token ?? null;
}

/** The connection to act with, and a live token for it (see validYouTubeToken). */
async function youTubeCredential(tenantId: string): Promise<{ id: string; token: string } | null> {
  // Expired rows stay eligible here — the refresh below trades them for a live
  // token — but a row with neither a live token nor a refresh token is dead.
  // A row whose channel could not be read when it was connected ("unknown") is never acted with.
  const cred = await db.oAuthCredential.findFirst({
    where: { tenantId, provider: "YOUTUBE", NOT: { providerAccountId: "unknown" }, ...usableOrRefreshable(), ...accountWhere("YOUTUBE") },
    orderBy: newestFirst,
  });
  if (!cred) return null;

  // Still valid (60s safety margin)?
  if (cred.expiresAt && cred.expiresAt.getTime() - Date.now() > 60_000) {
    try {
      return { id: cred.id, token: vaultDecrypt(cred.tokenEncrypted) };
    } catch {
      return null;
    }
  }

  // Expired → refresh.
  if (!cred.refreshTokenEncrypted) return null;
  // The same Google client the connection was made with (src/lib/oauth/registry.ts).
  const clientId = process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.AUTH_GOOGLE_SECRET;
  if (!clientId || !clientSecret) return null;
  let refreshToken: string;
  try {
    refreshToken = vaultDecrypt(cred.refreshTokenEncrypted);
  } catch {
    return null;
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.access_token) return null;

  await db.oAuthCredential.update({
    where: { id: cred.id },
    data: {
      tokenEncrypted: vaultEncrypt(j.access_token),
      expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : null,
    },
  });
  return { id: cred.id, token: j.access_token as string };
}

export async function publishToYouTube(
  tenantId: string,
  content: { title: string; description: string; videoUrl?: string; privacy?: "public" | "unlisted" | "private" },
): Promise<PublishResult> {
  if (!content.videoUrl || !/^https:\/\//i.test(content.videoUrl)) {
    return { ok: false, error: "YouTube needs a public https video URL (sourceAssetType VIDEO)." };
  }
  const cred = await youTubeCredential(tenantId);
  if (!cred) return { ok: false, error: "YouTube not connected (or token refresh failed — reconnect)." };
  const token = cred.token;

  try {
    // Pull the video bytes. Fine for short clips; large files should move to a
    // resumable upload (uploadType=resumable) to avoid buffering in memory.
    const vidRes = await fetch(content.videoUrl);
    if (!vidRes.ok) return { ok: false, error: `Could not fetch video (${vidRes.status}).` };
    const videoBuf = Buffer.from(await vidRes.arrayBuffer());

    const metadata = JSON.stringify({
      snippet: {
        title: content.title.slice(0, 100) || "vidsave",
        description: content.description.slice(0, 4900),
      },
      status: { privacyStatus: content.privacy ?? "public", selfDeclaredMadeForKids: false },
    });

    const boundary = "gituasYT" + Math.random().toString(36).slice(2);
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: video/*\r\n\r\n`),
      videoBuf,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const up = await fetch(UPLOAD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    const j = await up.json().catch(() => null);
    if (!up.ok || !j?.id) {
      return { ok: false, error: `YouTube upload ${up.status}: ${JSON.stringify(j?.error ?? j).slice(0, 250)}` };
    }

    // Only the row that was used: touching every YouTube row gave them all the same updatedAt, and
    // the next pick could then land on an old, broken connection.
    await db.oAuthCredential.update({ where: { id: cred.id }, data: { lastUsedAt: new Date() } });
    return { ok: true, externalId: String(j.id), permalinkUrl: `https://youtu.be/${j.id}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "YouTube call failed" };
  }
}
