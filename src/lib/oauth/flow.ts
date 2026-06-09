import { randomBytes, createHash } from "node:crypto";

import { db } from "@/lib/db";
import { vaultEncrypt } from "@/lib/vault";
import { findProvider, type ProviderConfig } from "@/lib/oauth/registry";
import type { OAuthProvider } from "@/generated/prisma/client";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
}

function redirectUriFor(provider: OAuthProvider): string {
  return `${appUrl()}/api/oauth/${provider.toLowerCase()}/callback`;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export async function buildAuthorizeUrl(provider: OAuthProvider, tenantId: string, redirectTo?: string): Promise<string> {
  const cfg = findProvider(provider);
  if (!cfg) throw new Error("Unknown provider");
  if (!cfg.authorizationUrl) throw new Error("Provider has no authorization URL");

  const state = base64url(randomBytes(24));
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = cfg.mode === "oauth2_pkce"
    ? base64url(createHash("sha256").update(codeVerifier).digest())
    : null;

  // Persist state for 10 minutes; the callback validates it
  await db.oAuthState.create({
    data: {
      state,
      codeVerifier,
      tenantId,
      provider,
      redirectTo,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  const clientId = process.env[cfg.envClientIdKey ?? ""];
  if (!clientId) throw new Error(`${cfg.envClientIdKey} not set`);

  // TikTok deviates from the OAuth norm: the identifier param is `client_key`
  // and scopes are comma-separated rather than space-separated.
  const isTikTok = provider === "TIKTOK";
  const params = new URLSearchParams({
    [isTikTok ? "client_key" : "client_id"]: clientId,
    redirect_uri: redirectUriFor(provider),
    response_type: "code",
    state,
    ...(cfg.scopes ? { scope: cfg.scopes.join(isTikTok ? "," : " ") } : {}),
    ...(codeChallenge ? { code_challenge: codeChallenge, code_challenge_method: "S256" } : {}),
    ...(provider === "REDDIT" ? { duration: "permanent" } : {}),
  });

  return `${cfg.authorizationUrl}?${params.toString()}`;
}

export interface TokenResult {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

async function exchangeCode(cfg: ProviderConfig, code: string, codeVerifier: string): Promise<TokenResult> {
  if (!cfg.tokenUrl) throw new Error("Provider has no token URL");
  const clientId = process.env[cfg.envClientIdKey ?? ""];
  const clientSecret = process.env[cfg.envClientSecretKey ?? ""];
  if (!clientId) throw new Error(`${cfg.envClientIdKey} not set`);
  if (!clientSecret) throw new Error(`${cfg.envClientSecretKey} not set`);

  const isTikTok = cfg.provider === "TIKTOK";
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUriFor(cfg.provider),
    [isTikTok ? "client_key" : "client_id"]: clientId,
    ...(cfg.mode === "oauth2_pkce" ? { code_verifier: codeVerifier } : {}),
  });

  // Reddit uses HTTP Basic auth; most others accept body params; we send both.
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (cfg.provider === "REDDIT") {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
    headers["User-Agent"] = process.env.REDDIT_USER_AGENT ?? "gituas/0.9.4";
  } else {
    params.set("client_secret", clientSecret);
  }

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers,
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return (await res.json()) as TokenResult;
}

async function fetchProviderAccount(cfg: ProviderConfig, accessToken: string): Promise<{ id: string; name: string; avatarUrl?: string }> {
  // Minimal user lookups per provider so we can show a useful "providerAccountName"
  const ua = process.env.REDDIT_USER_AGENT ?? "gituas/0.9.4";
  const auth = `Bearer ${accessToken}`;
  try {
    if (cfg.provider === "TIKTOK") {
      // TikTok requires showing the creator's username + avatar before posting,
      // so we capture both here at connect time.
      const r = await fetch(
        "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url",
        { headers: { Authorization: auth } },
      );
      const j = await r.json();
      const u = j?.data?.user;
      return {
        id: u?.open_id ?? "unknown",
        name: u?.display_name ? `@${u.display_name}` : "tiktok",
        avatarUrl: u?.avatar_url ?? undefined,
      };
    }
    if (cfg.provider === "X_TWITTER") {
      const r = await fetch("https://api.twitter.com/2/users/me", { headers: { Authorization: auth } });
      const j = await r.json();
      return { id: j?.data?.id ?? "unknown", name: `@${j?.data?.username ?? "x"}` };
    }
    if (cfg.provider === "LINKEDIN") {
      const r = await fetch("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: auth } });
      const j = await r.json();
      return { id: j?.sub ?? "unknown", name: j?.name ?? "linkedin" };
    }
    if (cfg.provider === "REDDIT") {
      const r = await fetch("https://oauth.reddit.com/api/v1/me", { headers: { Authorization: auth, "User-Agent": ua } });
      const j = await r.json();
      return { id: j?.id ?? "unknown", name: `u/${j?.name ?? "reddit"}` };
    }
  } catch {
    /* fall through */
  }
  return { id: "unknown", name: cfg.label };
}

export async function completeOAuth(provider: OAuthProvider, code: string, state: string): Promise<{ redirectTo: string }> {
  const cfg = findProvider(provider);
  if (!cfg) throw new Error("Unknown provider");

  const stateRow = await db.oAuthState.findUnique({ where: { state } });
  if (!stateRow) throw new Error("Invalid state");
  if (stateRow.provider !== provider) throw new Error("Provider mismatch");
  if (stateRow.expiresAt < new Date()) {
    await db.oAuthState.delete({ where: { state } });
    throw new Error("State expired — retry the connect flow");
  }

  const token = await exchangeCode(cfg, code, stateRow.codeVerifier);
  const account = await fetchProviderAccount(cfg, token.access_token);

  const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null;

  await db.oAuthCredential.upsert({
    where: {
      tenantId_provider_providerAccountId: {
        tenantId: stateRow.tenantId,
        provider,
        providerAccountId: account.id,
      },
    },
    create: {
      tenantId: stateRow.tenantId,
      provider,
      providerAccountId: account.id,
      providerAccountName: account.name,
      avatarUrl: account.avatarUrl ?? null,
      scopes: (token.scope ?? cfg.scopes?.join(" ") ?? "").split(/[\s,]+/).filter(Boolean),
      tokenEncrypted: vaultEncrypt(token.access_token),
      refreshTokenEncrypted: token.refresh_token ? vaultEncrypt(token.refresh_token) : null,
      expiresAt,
    },
    update: {
      providerAccountName: account.name,
      avatarUrl: account.avatarUrl ?? null,
      scopes: (token.scope ?? cfg.scopes?.join(" ") ?? "").split(/[\s,]+/).filter(Boolean),
      tokenEncrypted: vaultEncrypt(token.access_token),
      refreshTokenEncrypted: token.refresh_token ? vaultEncrypt(token.refresh_token) : null,
      expiresAt,
      lastUsedAt: null,
    },
  });

  await db.oAuthState.delete({ where: { state } });

  await db.auditLog.create({
    data: {
      tenantId: stateRow.tenantId,
      actor: "USER",
      action: "integrations.connected",
      reasoning: `Connected ${cfg.label} as ${account.name}.`,
      metadata: { provider, accountId: account.id },
    },
  });

  return { redirectTo: stateRow.redirectTo ?? "/dashboard/integrations" };
}
