"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { vaultEncrypt } from "@/lib/vault";

export async function saveAiKeys(input: {
  anthropic?: string;
  google?: string;
  openai?: string;
}) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const tenant = await db.tenant.findFirst({
    where: { ownerId: session.user.id },
    select: { id: true },
  });
  if (!tenant) throw new Error("No tenant");

  const patch: {
    anthropicKeyEncrypted?: string | null;
    googleAiKeyEncrypted?: string | null;
    openaiKeyEncrypted?: string | null;
  } = {};

  if (input.anthropic !== undefined) {
    patch.anthropicKeyEncrypted = input.anthropic ? vaultEncrypt(input.anthropic) : null;
  }
  if (input.google !== undefined) {
    patch.googleAiKeyEncrypted = input.google ? vaultEncrypt(input.google) : null;
  }
  if (input.openai !== undefined) {
    patch.openaiKeyEncrypted = input.openai ? vaultEncrypt(input.openai) : null;
  }

  await db.tenant.update({ where: { id: tenant.id }, data: patch });
  revalidatePath("/dashboard/settings");
}
