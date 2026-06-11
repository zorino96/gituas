// ---------------------------------------------------------------------------
//  OAuth provider registry
// ---------------------------------------------------------------------------
//
//  Each entry describes how to talk OAuth (or manual API keys) to one platform.
//  The integrations admin page reads this to render the right form / connect
//  button. The /api/oauth/[provider]/start and /callback routes read this to
//  drive the actual flow.

import type { OAuthProvider } from "@/generated/prisma/client";

export type CredMode = "oauth2" | "oauth2_pkce" | "api_key";

export interface FieldSpec {
  key: string;
  label: string;
  type: "text" | "password" | "url";
  placeholder?: string;
  helper?: string;
}

export interface ProviderConfig {
  provider: OAuthProvider;
  label: string;
  mode: CredMode;
  scopes?: string[];
  authorizationUrl?: string;
  tokenUrl?: string;
  envClientIdKey?: string;
  envClientSecretKey?: string;
  manualFields?: FieldSpec[];
  blocked?: { reason: string; nextStep: string }; // platform-side verification blocks
  category: "ads" | "social" | "payments" | "infra";
  docs?: string;
}

export const PROVIDERS: ProviderConfig[] = [
  {
    provider: "X_TWITTER",
    label: "x (twitter)",
    mode: "oauth2_pkce",
    scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    authorizationUrl: "https://twitter.com/i/oauth2/authorize",
    tokenUrl: "https://api.twitter.com/2/oauth2/token",
    envClientIdKey: "X_CLIENT_ID",
    envClientSecretKey: "X_CLIENT_SECRET",
    category: "social",
    docs: "https://developer.x.com/en/docs/authentication/oauth-2-0",
  },
  {
    provider: "LINKEDIN",
    label: "linkedin",
    mode: "oauth2",
    scopes: ["openid", "profile", "email", "w_member_social"],
    authorizationUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    envClientIdKey: "LINKEDIN_CLIENT_ID",
    envClientSecretKey: "LINKEDIN_CLIENT_SECRET",
    category: "social",
    docs: "https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow",
  },
  {
    provider: "REDDIT",
    label: "reddit",
    mode: "oauth2",
    scopes: ["identity", "submit", "edit", "read", "history"],
    authorizationUrl: "https://www.reddit.com/api/v1/authorize",
    tokenUrl: "https://www.reddit.com/api/v1/access_token",
    envClientIdKey: "REDDIT_CLIENT_ID",
    envClientSecretKey: "REDDIT_CLIENT_SECRET",
    category: "social",
    docs: "https://github.com/reddit-archive/reddit/wiki/OAuth2",
  },
  {
    provider: "META_INSTAGRAM",
    label: "instagram",
    mode: "oauth2",
    // Instagram API with Instagram Login (business login) — no Facebook Page needed.
    // Three hosts: www.instagram.com (authorize) → api.instagram.com (code exchange)
    // → graph.instagram.com (long-lived token + all publish/engage/insight calls).
    // As of the 24 Mar 2025 launch this one product covers the full organic
    // surface: publish + comments/@mentions + DMs + user/media insights. Each
    // scope still needs Advanced Access via App Review to act on customer
    // accounts (see META-SUBMISSION.md, Phase 1). See flow.ts.
    scopes: [
      "instagram_business_basic",
      "instagram_business_content_publish",
      "instagram_business_manage_comments",
      "instagram_business_manage_insights",
      "instagram_business_manage_messages",
    ],
    authorizationUrl: "https://www.instagram.com/oauth/authorize",
    tokenUrl: "https://api.instagram.com/oauth/access_token",
    envClientIdKey: "INSTAGRAM_APP_ID",
    envClientSecretKey: "INSTAGRAM_APP_SECRET",
    category: "social",
    docs: "https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/",
  },
  {
    provider: "META_FACEBOOK",
    label: "facebook pages",
    mode: "oauth2",
    scopes: ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement", "pages_manage_posts"],
    blocked: {
      reason: "phase 2 — only needed for facebook page publishing",
      nextStep: "instagram posting works via the instagram card above (no page needed). enable this later for page videos (requires a linked facebook page + page token).",
    },
    category: "social",
    docs: "https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/",
  },
  {
    provider: "TIKTOK",
    label: "tiktok",
    mode: "oauth2_pkce", // TikTok requires PKCE for web apps
    scopes: ["user.info.basic", "video.upload", "video.publish"],
    authorizationUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    envClientIdKey: "TIKTOK_CLIENT_KEY", // TikTok calls it client_key, not client_id
    envClientSecretKey: "TIKTOK_CLIENT_SECRET",
    category: "social",
    docs: "https://developers.tiktok.com/doc/content-posting-api-get-started/",
  },
  {
    provider: "YOUTUBE",
    label: "youtube",
    mode: "oauth2",
    scopes: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube"],
    blocked: {
      reason: "requires youtube data api audit",
      nextStep: "submit your app for audit at console.cloud.google.com (youtube data api v3).",
    },
    category: "social",
    docs: "https://developers.google.com/youtube/registering_an_application",
  },
  {
    provider: "GOOGLE_ADS",
    label: "google ads",
    mode: "api_key",
    manualFields: [
      { key: "developerToken", label: "developer token", type: "password" },
      { key: "customerId", label: "customer id", type: "text", placeholder: "123-456-7890" },
      { key: "refreshToken", label: "refresh token", type: "password" },
    ],
    category: "ads",
    docs: "https://developers.google.com/google-ads/api/docs/oauth/overview",
  },
  {
    provider: "STRIPE",
    label: "stripe",
    mode: "api_key",
    manualFields: [
      { key: "secretKey", label: "secret key", type: "password", placeholder: "sk_live_..." },
      { key: "publishableKey", label: "publishable key", type: "text", placeholder: "pk_live_..." },
      { key: "webhookSecret", label: "webhook secret", type: "password", placeholder: "whsec_..." },
    ],
    category: "payments",
    docs: "https://stripe.com/docs/keys",
  },
  {
    provider: "VERCEL",
    label: "vercel",
    mode: "api_key",
    manualFields: [
      { key: "token", label: "personal access token", type: "password", placeholder: "vercel_..." },
      { key: "teamId", label: "team id (optional)", type: "text" },
    ],
    category: "infra",
    docs: "https://vercel.com/docs/rest-api",
  },
  {
    provider: "CLOUDFLARE",
    label: "cloudflare",
    mode: "api_key",
    manualFields: [
      { key: "apiToken", label: "api token", type: "password" },
      { key: "accountId", label: "account id", type: "text" },
    ],
    category: "infra",
    docs: "https://developers.cloudflare.com/api/",
  },
];

export function findProvider(p: OAuthProvider): ProviderConfig | undefined {
  return PROVIDERS.find((x) => x.provider === p);
}

export function isProviderEnvConfigured(cfg: ProviderConfig): boolean {
  if (cfg.mode === "api_key") return true; // always show manual form
  if (!cfg.envClientIdKey || !cfg.envClientSecretKey) return false;
  return !!process.env[cfg.envClientIdKey] && !!process.env[cfg.envClientSecretKey];
}
