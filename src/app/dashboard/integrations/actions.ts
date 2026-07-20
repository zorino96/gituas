"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { vaultDecrypt, vaultEncrypt } from "@/lib/vault";
import { findProvider } from "@/lib/oauth/registry";
import { probeCredential } from "@/lib/integrations/probe";
import type { OAuthProvider } from "@/generated/prisma/client";

async function tenantFor(userId: string) {
  const t = await db.tenant.findFirst({
    where: { ownerId: userId },
    select: { id: true },
  });
  if (!t) throw new Error("No tenant");
  return t;
}

export async function saveManualCredential(
  provider: OAuthProvider,
  fields: Record<string, string>,
  label?: string,
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const cfg = findProvider(provider);
  if (!cfg) throw new Error("Unknown provider");
  if (cfg.mode !== "api_key") throw new Error("Provider requires OAuth, not manual credentials");

  const tenant = await tenantFor(session.user.id);

  // Encrypt the whole JSON blob — keys + their values
  const blob = vaultEncrypt(JSON.stringify(fields));
  const providerAccountId = label || fields.customerId || fields.accountId || fields.teamId || "default";

  await db.oAuthCredential.upsert({
    where: {
      tenantId_provider_providerAccountId: {
        tenantId: tenant.id,
        provider,
        providerAccountId,
      },
    },
    create: {
      tenantId: tenant.id,
      provider,
      providerAccountId,
      providerAccountName: label ?? cfg.label,
      scopes: [],
      tokenEncrypted: blob,
    },
    update: {
      tokenEncrypted: blob,
      lastUsedAt: null,
    },
  });

  await db.auditLog.create({
    data: {
      tenantId: tenant.id,
      actor: "USER",
      action: "integrations.credentials_saved",
      reasoning: `Saved ${cfg.label} credentials.`,
      metadata: { provider },
    },
  });

  revalidatePath("/dashboard/integrations");
}

/**
 * Store a Meta Marketing API **System-User token** for one ad account.
 *
 * The ads path (`lib/ads/meta-ads.ts loadAdsCred`) reads a META_FACEBOOK
 * credential keyed by `act_<adAccountId>` and uses `vaultDecrypt(tokenEncrypted)`
 * *as the raw access token* — so we must store the bare token, NOT the JSON blob
 * that `saveManualCredential` writes. META_FACEBOOK is also an oauth2 provider,
 * which `saveManualCredential` refuses; hence this dedicated entry point.
 */
export async function saveMetaAdsCredential(adAccountId: string, token: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const tk = token.trim();
  if (!tk) throw new Error("Token required");

  // Normalise to the `act_<digits>` form the Marketing API + loadAdsCred expect.
  const digits = adAccountId.trim().replace(/^act_/i, "").replace(/\D/g, "");
  if (!digits) throw new Error("Ad account id must be numeric, e.g. act_1234567890");
  const acct = `act_${digits}`;

  const tenant = await tenantFor(session.user.id);
  const adsScopes = ["ads_management", "ads_read", "business_management"];

  await db.oAuthCredential.upsert({
    where: {
      tenantId_provider_providerAccountId: {
        tenantId: tenant.id,
        provider: "META_FACEBOOK",
        providerAccountId: acct,
      },
    },
    create: {
      tenantId: tenant.id,
      provider: "META_FACEBOOK",
      providerAccountId: acct,
      providerAccountName: `meta ads · ${acct}`,
      scopes: adsScopes,
      tokenEncrypted: vaultEncrypt(tk),
    },
    update: {
      tokenEncrypted: vaultEncrypt(tk),
      scopes: adsScopes,
      lastUsedAt: null,
    },
  });

  await db.auditLog.create({
    data: {
      tenantId: tenant.id,
      actor: "USER",
      action: "integrations.meta_ads_saved",
      reasoning: `Saved Meta Marketing API System-User token for ${acct}.`,
      metadata: { adAccountId: acct },
    },
  });

  revalidatePath("/dashboard/integrations");
}

export async function disconnectIntegration(credentialId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const cred = await db.oAuthCredential.findFirst({
    where: { id: credentialId, tenant: { ownerId: session.user.id } },
    select: { id: true, tenantId: true, provider: true, providerAccountName: true },
  });
  if (!cred) throw new Error("Not found");

  await db.oAuthCredential.delete({ where: { id: cred.id } });

  await db.auditLog.create({
    data: {
      tenantId: cred.tenantId,
      actor: "USER",
      action: "integrations.disconnected",
      reasoning: `Disconnected ${cred.providerAccountName ?? cred.provider}.`,
      metadata: { provider: cred.provider },
    },
  });

  revalidatePath("/dashboard/integrations");
}

export async function testConnection(credentialId: string): Promise<{ ok: boolean; detail: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, detail: "Unauthorized" };

  const cred = await db.oAuthCredential.findFirst({
    where: { id: credentialId, tenant: { ownerId: session.user.id } },
    select: {
      id: true,
      tenantId: true,
      provider: true,
      providerAccountId: true,
      tokenEncrypted: true,
      expiresAt: true,
    },
  });
  if (!cred) return { ok: false, detail: "Not found" };

  // YouTube refreshes inside its probe, so an expired access token is fine there.
  if (cred.expiresAt && cred.expiresAt < new Date() && cred.provider !== "YOUTUBE") {
    return { ok: false, detail: "Token expired — reconnect" };
  }

  try {
    vaultDecrypt(cred.tokenEncrypted);
  } catch {
    return { ok: false, detail: "Vault decryption failed — VAULT_KEY mismatch" };
  }

  // Hit the platform for real — a credential that cannot make a call is not
  // "connected", however cleanly it decrypts.
  let result: { ok: boolean; detail: string };
  try {
    result = await probeCredential({
      tenantId: cred.tenantId,
      provider: cred.provider,
      providerAccountId: cred.providerAccountId,
      tokenEncrypted: cred.tokenEncrypted,
    });
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "Probe failed" };
  }

  if (result.ok) {
    await db.oAuthCredential.update({
      where: { id: cred.id },
      data: { lastUsedAt: new Date() },
    });
  }

  return result;
}
