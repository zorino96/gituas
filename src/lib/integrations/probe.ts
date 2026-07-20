// ---------------------------------------------------------------------------
//  Connection probes — one cheap, read-only call per provider
// ---------------------------------------------------------------------------
//
//  The integrations "test" button used to only decrypt the vault blob, so a
//  credential that could never work still reported success. Each probe below
//  makes the smallest real API call that proves the token is live, and names
//  the account it resolved so the operator can see *which* account is wired.
//
//  Providers whose credential Gituas stores but never reads (see the registry's
//  api_key entries) report that honestly rather than claiming a healthy link.

import { vaultDecrypt } from "@/lib/vault";
import { validYouTubeToken } from "@/lib/publishers/youtube";
import { FB_V } from "@/lib/publishers/facebook";
import { V as IG_V } from "@/lib/publishers/instagram";
import type { OAuthProvider } from "@/generated/prisma/client";

export interface ProbeInput {
  tenantId: string;
  provider: OAuthProvider;
  providerAccountId: string;
  tokenEncrypted: string;
}

export interface ProbeResult {
  ok: boolean;
  detail: string;
}

interface CallResult {
  ok: boolean;
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
  /** Set when the request never reached the platform (DNS, TLS, timeout). */
  netError: string | null;
}

/** GET/POST + parse. Never throws — a dead network is a result, not an exception. */
async function call(url: string, init?: RequestInit): Promise<CallResult> {
  try {
    const r = await fetch(url, init);
    const json = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, json, netError: null };
  } catch (err) {
    const cause = (err as { cause?: { message?: string } })?.cause?.message;
    return {
      ok: false,
      status: 0,
      json: null,
      netError: cause ?? (err instanceof Error ? err.message : "network error"),
    };
  }
}

/** Squeeze the platform's own error text into one short line. */
function fail(label: string, r: CallResult): ProbeResult {
  if (r.netError) return { ok: false, detail: `${label} unreachable — ${r.netError.slice(0, 140)}` };
  const j = r.json as { error?: { message?: string } | string; message?: string } | null;
  const msg =
    (typeof j?.error === "object" ? j.error?.message : undefined) ??
    (typeof j?.error === "string" ? j.error : undefined) ??
    j?.message ??
    JSON.stringify(r.json ?? {});
  return { ok: false, detail: `${label} ${r.status}: ${String(msg).slice(0, 180)}` };
}

/** api_key providers store a JSON blob of the manual form fields. */
function fields(tokenEncrypted: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(vaultDecrypt(tokenEncrypted));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export async function probeCredential(cred: ProbeInput): Promise<ProbeResult> {
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  switch (cred.provider) {
    // ---- social: OAuth bearer tokens ------------------------------------
    case "YOUTUBE": {
      // Access tokens live 1h, so go through the same refresh the publisher uses.
      const token = await validYouTubeToken(cred.tenantId);
      if (!token) return { ok: false, detail: "Token refresh failed — reconnect YouTube" };
      const r = await call(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
        { headers: bearer(token) },
      );
      if (!r.ok) return fail("YouTube", r);
      const ch = r.json?.items?.[0];
      if (!ch) return { ok: false, detail: "Token works but the account has no YouTube channel" };
      return { ok: true, detail: `channel “${ch.snippet?.title}” (${ch.id})` };
    }

    case "META_INSTAGRAM": {
      const token = vaultDecrypt(cred.tokenEncrypted);
      const r = await call(
        `${IG_V}/me?fields=id,username&access_token=${encodeURIComponent(token)}`,
      );
      if (!r.ok) return fail("Instagram", r);
      return { ok: true, detail: `@${r.json?.username} (${r.json?.id})` };
    }

    case "META_FACEBOOK": {
      const token = vaultDecrypt(cred.tokenEncrypted);
      const isAds = cred.providerAccountId.startsWith("act_");
      const f = isAds ? "name,account_status" : "name";
      const r = await call(
        `${FB_V}/${cred.providerAccountId}?fields=${f}&access_token=${encodeURIComponent(token)}`,
      );
      if (!r.ok) return fail(isAds ? "Meta Ads" : "Facebook", r);
      // account_status 1 = ACTIVE; anything else cannot run ads.
      if (isAds && r.json?.account_status !== 1) {
        return { ok: false, detail: `ad account “${r.json?.name}” is not active (status ${r.json?.account_status})` };
      }
      return { ok: true, detail: `${isAds ? "ad account" : "page"} “${r.json?.name}”` };
    }

    case "TIKTOK": {
      const token = vaultDecrypt(cred.tokenEncrypted);
      const r = await call(
        "https://open.tiktokapis.com/v2/user/info/?fields=display_name,username",
        { headers: bearer(token) },
      );
      if (!r.ok || r.json?.error?.code !== "ok") return fail("TikTok", r);
      const u = r.json?.data?.user;
      return { ok: true, detail: `@${u?.username ?? u?.display_name}` };
    }

    case "X_TWITTER": {
      const token = vaultDecrypt(cred.tokenEncrypted);
      const r = await call("https://api.twitter.com/2/users/me", { headers: bearer(token) });
      if (!r.ok) return fail("X", r);
      return { ok: true, detail: `@${r.json?.data?.username}` };
    }

    case "LINKEDIN": {
      const token = vaultDecrypt(cred.tokenEncrypted);
      const r = await call("https://api.linkedin.com/v2/userinfo", { headers: bearer(token) });
      if (!r.ok) return fail("LinkedIn", r);
      return { ok: true, detail: `${r.json?.name ?? r.json?.sub}` };
    }

    case "REDDIT": {
      const ua = process.env.REDDIT_USER_AGENT;
      if (!ua) return { ok: false, detail: "REDDIT_USER_AGENT not set — Reddit calls will be rejected" };
      const token = vaultDecrypt(cred.tokenEncrypted);
      const r = await call("https://oauth.reddit.com/api/v1/me", {
        headers: { ...bearer(token), "User-Agent": ua },
      });
      if (!r.ok) return fail("Reddit", r);
      return { ok: true, detail: `u/${r.json?.name}` };
    }

    // ---- manual api_key providers ---------------------------------------
    case "STRIPE": {
      const key = fields(cred.tokenEncrypted).secretKey;
      if (!key) return { ok: false, detail: "No secret key stored" };
      const r = await call("https://api.stripe.com/v1/balance", { headers: bearer(key) });
      if (!r.ok) return fail("Stripe", r);
      return { ok: true, detail: "key valid — note: no Gituas code reads Stripe revenue yet" };
    }

    case "VERCEL": {
      const token = fields(cred.tokenEncrypted).token;
      if (!token) return { ok: false, detail: "No access token stored" };
      const r = await call("https://api.vercel.com/v2/user", { headers: bearer(token) });
      if (!r.ok) return fail("Vercel", r);
      return { ok: true, detail: `${r.json?.user?.username} — note: no Gituas code calls Vercel yet` };
    }

    case "CLOUDFLARE": {
      const token = fields(cred.tokenEncrypted).apiToken;
      if (!token) return { ok: false, detail: "No API token stored" };
      const r = await call("https://api.cloudflare.com/client/v4/user/tokens/verify", {
        headers: bearer(token),
      });
      if (!r.ok || r.json?.result?.status !== "active") return fail("Cloudflare", r);
      return { ok: true, detail: "token active — note: no Gituas code calls Cloudflare yet" };
    }

    case "GOOGLE_ADS": {
      // Deliberately not a green light: the credential is stored but nothing in
      // the codebase ever reads it, and probing would need an OAuth client this
      // provider doesn't define (registry has no envClientIdKey for GOOGLE_ADS).
      const f = fields(cred.tokenEncrypted);
      const missing = ["developerToken", "customerId", "refreshToken"].filter((k) => !f[k]);
      return {
        ok: false,
        detail: missing.length
          ? `Missing ${missing.join(", ")} — and Gituas has no Google Ads code yet`
          : "Stored, but Gituas has no Google Ads code yet — this credential is never used",
      };
    }

    default:
      return { ok: false, detail: `No probe implemented for ${cred.provider}` };
  }
}
