import { randomBytes, createHash } from "node:crypto";

import { db } from "@/lib/db";
import { vaultDecrypt, vaultEncrypt } from "@/lib/vault";
import { can } from "@/lib/newsroom/roles";
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

  // TikTok deviates from the OAuth norm: the identifier param is `client_key`.
  // TikTok and Instagram both want comma-separated scopes.
  const isTikTok = provider === "TIKTOK";
  const commaScopes = isTikTok || provider === "META_INSTAGRAM" || provider === "META_FACEBOOK";
  // Facebook Login for Business drives permissions from the login config; the
  // scope param is kept as a fallback for classic Login.
  const configId = cfg.configIdEnvKey ? process.env[cfg.configIdEnvKey] : undefined;
  const params = new URLSearchParams({
    [isTikTok ? "client_key" : "client_id"]: clientId,
    redirect_uri: redirectUriFor(provider),
    response_type: "code",
    state,
    ...(cfg.scopes ? { scope: cfg.scopes.join(commaScopes ? "," : " ") } : {}),
    ...(configId ? { config_id: configId } : {}),
    ...(codeChallenge ? { code_challenge: codeChallenge, code_challenge_method: "S256" } : {}),
    ...(provider === "REDDIT" ? { duration: "permanent" } : {}),
    // Google only returns a refresh_token with offline access + a forced consent.
    ...(provider === "YOUTUBE" ? { access_type: "offline", prompt: "consent" } : {}),
    // Once a creator has authorised us, TikTok silently re-issues the code and
    // skips the consent screen — so a reconnect gives no chance to see, or
    // withdraw from, the scopes being granted. This forces the screen every
    // time. (TikTok for Business sets the same flag on its own authorize URL.)
    ...(isTikTok ? { disable_auto_auth: "1" } : {}),
    // Instagram Business Login skips its consent screen for an account that has
    // authorised us before — same problem, same fix as TikTok above: the person
    // reconnecting never sees which of the five scopes they are handing over.
    ...(provider === "META_INSTAGRAM" ? { force_reauth: "true" } : {}),
  });

  return `${cfg.authorizationUrl}?${params.toString()}`;
}

export interface TokenResult {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  /** Some providers (Instagram) return the account id with the token. */
  providerUserId?: string;
  /** Facebook, when the person runs several Pages: nothing is connected until they pick one. */
  pageChoice?: { userToken: string; pages: { id: string; name: string }[] };
}

type FacebookPage = { id: string; name: string; access_token: string };

/** The person's Pages that came back with a usable Page token (up to 100). */
async function fetchFacebookPages(userToken: string): Promise<{ pages: FacebookPage[]; raw: unknown }> {
  const res = await fetch(
    `https://graph.facebook.com/v25.0/me/accounts?fields=id,name,access_token&limit=100&access_token=${encodeURIComponent(userToken)}`,
  );
  const raw: unknown = await res.json().catch(() => null);
  const data = (raw as { data?: unknown } | null)?.data;
  const pages = Array.isArray(data)
    ? data.flatMap((p: { id?: unknown; name?: unknown; access_token?: unknown }) =>
        typeof p?.id === "string" && typeof p.access_token === "string"
          ? [{ id: p.id, name: typeof p.name === "string" && p.name ? p.name : p.id, access_token: p.access_token }]
          : [],
      )
    : [];
  return { pages, raw };
}

async function exchangeCode(cfg: ProviderConfig, code: string, codeVerifier: string): Promise<TokenResult> {
  if (!cfg.tokenUrl) throw new Error("Provider has no token URL");
  const clientId = process.env[cfg.envClientIdKey ?? ""];
  const clientSecret = process.env[cfg.envClientSecretKey ?? ""];
  if (!clientId) throw new Error(`${cfg.envClientIdKey} not set`);
  if (!clientSecret) throw new Error(`${cfg.envClientSecretKey} not set`);

  if (cfg.provider === "META_INSTAGRAM") {
    // Instagram business login: code → 1-hour token on api.instagram.com
    // (response wrapped in a data[] array), then immediately exchange it for
    // the 60-day long-lived token on graph.instagram.com. No refresh_token —
    // the access token itself is refreshed later (see publishers/instagram.ts).
    const shortRes = await fetch(cfg.tokenUrl!, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUriFor(cfg.provider),
        code,
      }).toString(),
    });
    const shortJson = await shortRes.json().catch(() => null);
    const short = Array.isArray(shortJson?.data) ? shortJson.data[0] : shortJson;
    if (!shortRes.ok || !short?.access_token) {
      throw new Error(`Instagram token exchange failed (${shortRes.status}): ${JSON.stringify(shortJson).slice(0, 200)}`);
    }

    const longRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(clientSecret)}&access_token=${encodeURIComponent(short.access_token)}`,
    );
    const long = await longRes.json().catch(() => null);
    if (!longRes.ok || !long?.access_token) {
      throw new Error(`Instagram long-lived exchange failed (${longRes.status}): ${JSON.stringify(long).slice(0, 200)}`);
    }

    return {
      access_token: long.access_token,
      expires_in: long.expires_in,
      scope: typeof short.permissions === "string" ? short.permissions : undefined,
      providerUserId: short.user_id != null ? String(short.user_id) : undefined,
    };
  }

  if (cfg.provider === "META_FACEBOOK") {
    // Facebook Login for Business: code → short-lived user token, then exchange
    // for a long-lived (~60d) user token, then mint the PAGE access token via
    // /me/accounts. A page token derived from a long-lived user token does NOT
    // expire, so no lazy-refresh is needed. We store the *page* token — a user
    // token 400s on /{page-id}/feed.
    const shortRes = await fetch(
      `${cfg.tokenUrl}?` +
        new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUriFor(cfg.provider),
          code,
        }).toString(),
    );
    const short = await shortRes.json().catch(() => null);
    if (!shortRes.ok || !short?.access_token) {
      throw new Error(`Facebook token exchange failed (${shortRes.status}): ${JSON.stringify(short).slice(0, 200)}`);
    }

    const longRes = await fetch(
      "https://graph.facebook.com/v25.0/oauth/access_token?" +
        new URLSearchParams({
          grant_type: "fb_exchange_token",
          client_id: clientId,
          client_secret: clientSecret,
          fb_exchange_token: short.access_token,
        }).toString(),
    );
    const long = await longRes.json().catch(() => null);
    const userToken = long?.access_token ?? short.access_token;

    const { pages, raw } = await fetchFacebookPages(userToken);
    if (pages.length === 0) {
      throw new Error(
        `Facebook: no page token returned — grant pages_show_list and ensure the user has a Page role. (${JSON.stringify(raw).slice(0, 160)})`,
      );
    }
    // Someone who runs several Pages chooses one on our side; with one Page
    // there is nothing to ask. (Never pick for them — the first Page is just
    // whichever Facebook lists first.)
    if (pages.length > 1) {
      return {
        access_token: "",
        scope: cfg.scopes?.join(","),
        pageChoice: { userToken, pages: pages.map(({ id, name }) => ({ id, name })) },
      };
    }

    return {
      access_token: pages[0].access_token,
      // Page tokens (from a long-lived user token) are non-expiring.
      scope: cfg.scopes?.join(","),
      providerUserId: pages[0].id,
    };
  }

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
    if (cfg.provider === "META_INSTAGRAM") {
      const r = await fetch(
        "https://graph.instagram.com/v25.0/me?fields=user_id,username,profile_picture_url",
        { headers: { Authorization: auth } },
      );
      const j = await r.json();
      return {
        id: j?.user_id != null ? String(j.user_id) : "unknown",
        name: j?.username ? `@${j.username}` : "instagram",
        avatarUrl: j?.profile_picture_url ?? undefined,
      };
    }
    if (cfg.provider === "META_FACEBOOK") {
      // `accessToken` here is the Page token, so /me resolves to the Page itself.
      const r = await fetch(
        `https://graph.facebook.com/v25.0/me?fields=id,name,picture.type(large){url}&access_token=${encodeURIComponent(accessToken)}`,
      );
      const j = await r.json();
      return {
        id: j?.id != null ? String(j.id) : "unknown",
        name: j?.name ?? "facebook page",
        avatarUrl: j?.picture?.data?.url ?? undefined,
      };
    }
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
    if (cfg.provider === "YOUTUBE") {
      const r = await fetch(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
        { headers: { Authorization: auth } },
      );
      const j = await r.json();
      const ch = j?.items?.[0];
      return {
        id: ch?.id ?? "unknown",
        name: ch?.snippet?.title ?? "youtube",
        avatarUrl: ch?.snippet?.thumbnails?.default?.url ?? undefined,
      };
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
  const redirectTo = stateRow.redirectTo ?? "/dashboard/integrations";

  if (token.pageChoice) {
    // Park the sign-in until the person picks a Page. Expired choices (which
    // hold user tokens) are cleared on the way in.
    const now = new Date();
    await db.oAuthPageChoice.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { tenantId: stateRow.tenantId }] } });
    const choice = await db.oAuthPageChoice.create({
      data: {
        tenantId: stateRow.tenantId,
        userTokenEncrypted: vaultEncrypt(token.pageChoice.userToken),
        pages: token.pageChoice.pages,
        scopes: scopeList(token, cfg),
        redirectTo,
        expiresAt: new Date(now.getTime() + PAGE_CHOICE_TTL_MS),
      },
      select: { id: true },
    });
    await db.oAuthState.delete({ where: { state } });
    // The chooser needs the person's session, so it opens on the domain the connect started from.
    const from = /^https?:\/\//.test(redirectTo) ? new URL(redirectTo).origin : "";
    return { redirectTo: `${from}/connect/facebook?c=${choice.id}` };
  }

  const account = await fetchProviderAccount(cfg, token.access_token);
  // Instagram's /me lookup can be flaky right after auth — the token exchange
  // already carries the account id, so fall back to it.
  if (account.id === "unknown" && token.providerUserId) account.id = token.providerUserId;

  await saveCredential(stateRow.tenantId, cfg, token, account);
  await db.oAuthState.delete({ where: { state } });
  return { redirectTo };
}

const PAGE_CHOICE_TTL_MS = 10 * 60 * 1000;

function scopeList(token: TokenResult, cfg: ProviderConfig): string[] {
  return (token.scope ?? cfg.scopes?.join(" ") ?? "").split(/[\s,]+/).filter(Boolean);
}

async function saveCredential(
  tenantId: string,
  cfg: ProviderConfig,
  token: TokenResult,
  account: { id: string; name: string; avatarUrl?: string },
): Promise<void> {
  const provider = cfg.provider;
  const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null;
  const fields = {
    providerAccountName: account.name,
    avatarUrl: account.avatarUrl ?? null,
    scopes: scopeList(token, cfg),
    tokenEncrypted: vaultEncrypt(token.access_token),
    refreshTokenEncrypted: token.refresh_token ? vaultEncrypt(token.refresh_token) : null,
    expiresAt,
  };
  await db.oAuthCredential.upsert({
    where: { tenantId_provider_providerAccountId: { tenantId, provider, providerAccountId: account.id } },
    create: { tenantId, provider, providerAccountId: account.id, ...fields },
    update: { ...fields, lastUsedAt: null },
  });
  await db.auditLog.create({
    data: {
      tenantId,
      actor: "USER",
      action: "integrations.connected",
      reasoning: `Connected ${cfg.label} as ${account.name}.`,
      metadata: { provider, accountId: account.id },
    },
  });
}

export type PendingPageChoice = { redirectTo: string; pages: { id: string; name: string }[] };

type ChoiceRow = { tenantId: string; redirectTo: string; pages: unknown; scopes: string[]; userTokenEncrypted: string };

/** A pending Page choice this person may act on: unexpired, in a workspace where they may configure. */
async function ownedChoice(choiceId: string, userId: string): Promise<ChoiceRow | null> {
  if (!choiceId) return null;
  const choice = await db.oAuthPageChoice.findUnique({ where: { id: choiceId } });
  if (!choice) return null;
  if (choice.expiresAt < new Date()) {
    // It holds a long-lived user token; don't keep it past its ten minutes.
    await db.oAuthPageChoice.delete({ where: { id: choiceId } }).catch(() => undefined);
    return null;
  }
  const [member, tenant] = await Promise.all([
    db.membership.findUnique({ where: { tenantId_userId: { tenantId: choice.tenantId, userId } }, select: { role: true } }),
    db.tenant.findUnique({ where: { id: choice.tenantId }, select: { ownerId: true } }),
  ]);
  // The owner always may (the operator dashboard starts connects by ownership).
  return tenant?.ownerId === userId || (member && can(member.role, "configure")) ? choice : null;
}

function choicePages(pages: unknown): { id: string; name: string }[] {
  return Array.isArray(pages)
    ? pages.flatMap((p: { id?: unknown; name?: unknown }) =>
        typeof p?.id === "string" ? [{ id: p.id, name: typeof p.name === "string" ? p.name : p.id }] : [],
      )
    : [];
}

/** What the chooser shows: the Page names only — never the token. */
export async function loadPageChoice(choiceId: string, userId: string): Promise<PendingPageChoice | null> {
  const choice = await ownedChoice(choiceId, userId);
  return choice ? { redirectTo: choice.redirectTo, pages: choicePages(choice.pages) } : null;
}

/**
 * Connect the Page the person picked. Its token is minted fresh from the
 * stored user token for that Page id, so a tampered form can only pick among
 * the Pages Facebook itself says the person runs.
 */
export async function completeFacebookPageChoice(choiceId: string, pageId: string, userId: string): Promise<{ redirectTo: string } | null> {
  const choice = await ownedChoice(choiceId, userId);
  const cfg = findProvider("META_FACEBOOK");
  if (!choice || !cfg) return null;
  const { pages } = await fetchFacebookPages(vaultDecrypt(choice.userTokenEncrypted));
  const page = pages.find((p) => p.id === pageId);
  if (!page) return null;
  const account = await fetchProviderAccount(cfg, page.access_token);
  if (account.id === "unknown") account.id = page.id;
  await saveCredential(choice.tenantId, cfg, { access_token: page.access_token, scope: choice.scopes.join(",") }, account);
  await db.oAuthPageChoice.delete({ where: { id: choiceId } }).catch(() => undefined);
  return { redirectTo: choice.redirectTo };
}

/** Drop a pending choice (the person cancelled). Returns where they came from. */
export async function cancelFacebookPageChoice(choiceId: string, userId: string): Promise<{ redirectTo: string } | null> {
  const choice = await ownedChoice(choiceId, userId);
  if (!choice) return null;
  await db.oAuthPageChoice.delete({ where: { id: choiceId } }).catch(() => undefined);
  return { redirectTo: choice.redirectTo };
}
