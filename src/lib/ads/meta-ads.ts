// ---------------------------------------------------------------------------
//  Meta Marketing API — campaign launcher
// ---------------------------------------------------------------------------
//
//  Turns an approved AdCampaign row into a real (PAUSED) Meta ad:
//    campaign → ad set (budget + targeting) → ad creative → ad
//  All calls carry an appsecret_proof and run against the tenant's ad-account
//  System-User token (an OAuthCredential keyed by `act_<adAccountId>`). Budgets
//  are minor units (cents). Everything is created PAUSED so nothing spends until
//  a human resumes it in Ads Manager.
//
//  Requires: ads_management (+ business_management) with Advanced Access AND the
//  Marketing API Full-Access tier — see META-SUBMISSION.md Phase 2B.

import { createHmac } from "node:crypto";

import { db } from "@/lib/db";
import { vaultDecrypt } from "@/lib/vault";
import { FB_V, loadFbCred } from "@/lib/publishers/facebook";

export interface AdLaunchResult {
  ok: boolean;
  campaignId?: string;
  adId?: string;
  error?: string;
}

interface AdsCred {
  id: string;
  adAccountId: string; // includes the "act_" prefix
  token: string;
}

/** The System-User (or user) token authorised for the tenant's ad account. */
async function loadAdsCred(tenantId: string): Promise<AdsCred | null> {
  const cred = await db.oAuthCredential.findFirst({
    where: { tenantId, provider: "META_FACEBOOK", providerAccountId: { startsWith: "act_" } },
    orderBy: { lastUsedAt: { sort: "desc", nulls: "last" } },
  });
  if (!cred) return null;
  if (cred.expiresAt && cred.expiresAt < new Date()) return null;
  try {
    return { id: cred.id, adAccountId: cred.providerAccountId, token: vaultDecrypt(cred.tokenEncrypted) };
  } catch {
    return null;
  }
}

function proof(token: string): string | null {
  const secret = process.env.FACEBOOK_APP_SECRET ?? process.env.INSTAGRAM_APP_SECRET;
  return secret ? createHmac("sha256", secret).update(token).digest("hex") : null;
}

async function post(path: string, token: string, fields: Record<string, string>): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  const p = proof(token);
  const body = new URLSearchParams({ ...fields, access_token: token, ...(p ? { appsecret_proof: p } : {}) });
  const res = await fetch(`${FB_V}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

export interface AdCampaignInput {
  name: string;
  budgetCents: number;
  copy: string;
  creativeUrl?: string | null;
  targeting?: unknown;
  linkUrl?: string; // where the ad clicks through to
}

/**
 * Create a paused campaign → ad set → creative → ad. Returns the campaign id.
 * Needs both a Page connection (for the creative's object_story_spec) and an
 * ad-account credential.
 */
export async function launchMetaCampaign(tenantId: string, campaign: AdCampaignInput): Promise<AdLaunchResult> {
  const ads = await loadAdsCred(tenantId);
  if (!ads) return { ok: false, error: "No Meta ad-account connected (grant ad-account access / connect ads)" };
  const page = await loadFbCred(tenantId);
  if (!page) return { ok: false, error: "Connect a Facebook Page first — ad creatives are published as the Page" };

  const acct = ads.adAccountId; // e.g. act_123
  const token = ads.token;

  // 1) Campaign — objective TRAFFIC, paused, special_ad_categories required.
  const campRes = await post(`${acct}/campaigns`, token, {
    name: campaign.name.slice(0, 400),
    objective: "OUTCOME_TRAFFIC",
    status: "PAUSED",
    special_ad_categories: "[]",
  });
  const campaignId = campRes.json.id as string | undefined;
  if (!campRes.ok || !campaignId) {
    return { ok: false, error: `campaign: ${JSON.stringify(campRes.json?.error ?? campRes.json).slice(0, 220)}` };
  }

  // 2) Ad set — daily budget (cents), targeting, lowest-cost bidding, paused.
  const structured = (campaign.targeting && typeof campaign.targeting === "object" && "geo_locations" in (campaign.targeting as object))
    ? (campaign.targeting as Record<string, unknown>)
    : { geo_locations: { countries: ["US"] }, age_min: 18, age_max: 65 };
  const setRes = await post(`${acct}/adsets`, token, {
    name: `${campaign.name} — ad set`.slice(0, 400),
    campaign_id: campaignId,
    daily_budget: String(Math.max(100, Math.round(campaign.budgetCents / 30))), // monthly → daily, min $1
    billing_event: "IMPRESSIONS",
    optimization_goal: "LINK_CLICKS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    targeting: JSON.stringify(structured),
    status: "PAUSED",
    start_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  const adsetId = setRes.json.id as string | undefined;
  if (!setRes.ok || !adsetId) {
    return { ok: false, campaignId, error: `adset: ${JSON.stringify(setRes.json?.error ?? setRes.json).slice(0, 220)}` };
  }

  // 3) Ad creative — link ad published as the Page.
  const linkData: Record<string, unknown> = {
    message: campaign.copy.slice(0, 5000),
    link: campaign.linkUrl || `https://www.facebook.com/${page.pageId}`,
  };
  if (campaign.creativeUrl && /^https:\/\//i.test(campaign.creativeUrl)) linkData.image_url = campaign.creativeUrl;
  const creRes = await post(`${acct}/adcreatives`, token, {
    name: `${campaign.name} — creative`.slice(0, 400),
    object_story_spec: JSON.stringify({ page_id: page.pageId, link_data: linkData }),
  });
  const creativeId = creRes.json.id as string | undefined;
  if (!creRes.ok || !creativeId) {
    return { ok: false, campaignId, error: `creative: ${JSON.stringify(creRes.json?.error ?? creRes.json).slice(0, 220)}` };
  }

  // 4) Ad — paused.
  const adRes = await post(`${acct}/ads`, token, {
    name: `${campaign.name} — ad`.slice(0, 400),
    adset_id: adsetId,
    creative: JSON.stringify({ creative_id: creativeId }),
    status: "PAUSED",
  });
  const adId = adRes.json.id as string | undefined;
  if (!adRes.ok || !adId) {
    return { ok: false, campaignId, error: `ad: ${JSON.stringify(adRes.json?.error ?? adRes.json).slice(0, 220)}` };
  }

  await db.oAuthCredential.update({ where: { id: ads.id }, data: { lastUsedAt: new Date() } });
  return { ok: true, campaignId, adId };
}
