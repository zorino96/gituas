// ---------------------------------------------------------------------------
//  Publisher dispatcher — sends a ContentPost to a real platform
// ---------------------------------------------------------------------------
//
//  Looks up a valid OAuthCredential for the tenant + platform, decrypts the
//  token via Vault, and calls the platform's posting API. Returns a uniform
//  PublishResult so the caller (approval action) doesn't care about quirks.

import { db } from "@/lib/db";
import { vaultDecrypt } from "@/lib/vault";
import type { OAuthProvider, Platform } from "@/generated/prisma/client";

export interface PublishResult {
  ok: boolean;
  externalId?: string;
  permalinkUrl?: string;
  error?: string;
}

function platformToProvider(p: Platform): OAuthProvider | null {
  switch (p) {
    case "X_TWITTER": return "X_TWITTER";
    case "LINKEDIN": return "LINKEDIN";
    case "REDDIT": return "REDDIT";
    case "TIKTOK": return "TIKTOK";
    case "YOUTUBE": return "YOUTUBE";
    case "META_FACEBOOK": return "META_FACEBOOK";
    case "META_INSTAGRAM": return "META_INSTAGRAM";
    default: return null;
  }
}

async function loadToken(tenantId: string, provider: OAuthProvider): Promise<{ token: string; account: string } | null> {
  const cred = await db.oAuthCredential.findFirst({
    where: { tenantId, provider },
    orderBy: { lastUsedAt: { sort: "desc", nulls: "last" } },
  });
  if (!cred) return null;
  if (cred.expiresAt && cred.expiresAt < new Date()) return null;
  try {
    return { token: vaultDecrypt(cred.tokenEncrypted), account: cred.providerAccountName ?? cred.providerAccountId };
  } catch {
    return null;
  }
}

async function markUsed(tenantId: string, provider: OAuthProvider) {
  await db.oAuthCredential.updateMany({
    where: { tenantId, provider },
    data: { lastUsedAt: new Date() },
  });
}

// ---------- per-platform implementations ------------------------------------

async function publishToReddit(tenantId: string, content: { description: string; subreddit?: string }): Promise<PublishResult> {
  const cred = await loadToken(tenantId, "REDDIT");
  if (!cred) return { ok: false, error: "Reddit not connected" };
  if (!process.env.REDDIT_USER_AGENT) return { ok: false, error: "REDDIT_USER_AGENT not set" };
  const subreddit = content.subreddit ?? "test"; // safest default

  const params = new URLSearchParams({
    sr: subreddit,
    kind: "self",
    title: content.description.slice(0, 280),
    text: content.description,
    api_type: "json",
  });
  try {
    const res = await fetch("https://oauth.reddit.com/api/submit", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cred.token}`,
        "User-Agent": process.env.REDDIT_USER_AGENT!,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const j = await res.json();
    if (!res.ok) return { ok: false, error: `Reddit ${res.status}: ${JSON.stringify(j).slice(0, 200)}` };
    await markUsed(tenantId, "REDDIT");
    const url = j?.json?.data?.url;
    const id = j?.json?.data?.id;
    return { ok: true, externalId: id, permalinkUrl: url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Reddit call failed" };
  }
}

async function publishToX(tenantId: string, content: { description: string }): Promise<PublishResult> {
  const cred = await loadToken(tenantId, "X_TWITTER");
  if (!cred) return { ok: false, error: "X not connected" };
  try {
    const res = await fetch("https://api.twitter.com/2/tweets", {
      method: "POST",
      headers: { Authorization: `Bearer ${cred.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: content.description.slice(0, 280) }),
    });
    const j = await res.json();
    if (!res.ok) return { ok: false, error: `X ${res.status}: ${JSON.stringify(j).slice(0, 200)}` };
    await markUsed(tenantId, "X_TWITTER");
    const id = j?.data?.id;
    return { ok: true, externalId: id, permalinkUrl: id ? `https://x.com/i/web/status/${id}` : undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "X call failed" };
  }
}

async function publishToLinkedIn(tenantId: string, content: { description: string }): Promise<PublishResult> {
  const cred = await loadToken(tenantId, "LINKEDIN");
  if (!cred) return { ok: false, error: "LinkedIn not connected" };
  try {
    const me = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${cred.token}` },
    }).then((r) => r.json());
    const author = `urn:li:person:${me?.sub}`;
    if (!me?.sub) return { ok: false, error: "LinkedIn userinfo missing sub" };

    const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cred.token}`,
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        author,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text: content.description },
            shareMediaCategory: "NONE",
          },
        },
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, error: `LinkedIn ${res.status}: ${t.slice(0, 200)}` };
    }
    const id = res.headers.get("x-restli-id") ?? undefined;
    await markUsed(tenantId, "LINKEDIN");
    return { ok: true, externalId: id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "LinkedIn call failed" };
  }
}

async function publishStub(platform: string): Promise<PublishResult> {
  return { ok: false, error: `${platform} publisher pending business verification` };
}

// ---------- public dispatcher ----------------------------------------------

export async function publishPlatformPost(platformPostId: string): Promise<PublishResult> {
  const pp = await db.platformPost.findUnique({
    where: { id: platformPostId },
    include: {
      contentPost: {
        include: { project: { select: { id: true, tenantId: true } } },
      },
    },
  });
  if (!pp) return { ok: false, error: "Platform post not found" };

  await db.platformPost.update({ where: { id: pp.id }, data: { status: "PUBLISHING" } });

  const tenantId = pp.contentPost.project.tenantId;
  const provider = platformToProvider(pp.platform);
  if (!provider) {
    return await finalize(pp.id, { ok: false, error: "Unsupported platform" });
  }

  const content = { description: pp.contentPost.description };
  let result: PublishResult;

  switch (pp.platform) {
    case "REDDIT": result = await publishToReddit(tenantId, content); break;
    case "X_TWITTER": result = await publishToX(tenantId, content); break;
    case "LINKEDIN": result = await publishToLinkedIn(tenantId, content); break;
    case "TIKTOK": result = await publishStub("TikTok"); break;
    case "YOUTUBE": result = await publishStub("YouTube"); break;
    case "META_FACEBOOK":
    case "META_INSTAGRAM": result = await publishStub("Meta"); break;
    default: result = { ok: false, error: "Unknown platform" };
  }

  return await finalize(pp.id, result);
}

async function finalize(id: string, result: PublishResult): Promise<PublishResult> {
  await db.platformPost.update({
    where: { id },
    data: {
      status: result.ok ? "PUBLISHED" : "FAILED",
      platformPostId: result.externalId,
      permalinkUrl: result.permalinkUrl,
      errorMessage: result.error,
      postedAt: result.ok ? new Date() : undefined,
    },
  });
  return result;
}
