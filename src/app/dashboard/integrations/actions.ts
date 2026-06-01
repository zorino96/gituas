"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { vaultEncrypt } from "@/lib/vault";
import { findProvider } from "@/lib/oauth/registry";
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
    select: { id: true, provider: true, tokenEncrypted: true, expiresAt: true },
  });
  if (!cred) return { ok: false, detail: "Not found" };

  if (cred.expiresAt && cred.expiresAt < new Date()) {
    return { ok: false, detail: "Token expired — reconnect" };
  }

  // Best-effort smoke test: decrypt and check the blob is parseable.
  try {
    const { vaultDecrypt } = await import("@/lib/vault");
    const raw = vaultDecrypt(cred.tokenEncrypted);
    void raw;
  } catch {
    return { ok: false, detail: "Vault decryption failed — VAULT_KEY mismatch" };
  }

  await db.oAuthCredential.update({
    where: { id: cred.id },
    data: { lastUsedAt: new Date() },
  });

  return { ok: true, detail: "Decrypted ok — actual platform call lands when the publisher fires." };
}
