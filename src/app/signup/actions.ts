"use server";

import { db } from "@/lib/db";
import { ensureWorkspace } from "@/auth";
import { hashPassword, normalizeEmail, passwordProblem } from "@/lib/password";

export type SignupResult = { ok: true; email: string } | { ok: false; error: string; field?: "name" | "email" | "password" };

/**
 * Create an email-and-password account and its workspace. Signing in happens
 * in the browser afterwards, through the same credentials provider a returning
 * user goes through, so there is one sign-in path, not two.
 */
export async function signupAction(input: { name: string; email: string; password: string }): Promise<SignupResult> {
  const name = input.name.trim().slice(0, 60);
  if (!name) return { ok: false, field: "name", error: "ناوی دووکان یان ناوی خۆت بنووسە." };

  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, field: "email", error: "ئیمەیڵەکە دروست نییە." };

  const problem = passwordProblem(input.password);
  if (problem === "too-short") return { ok: false, field: "password", error: "وشەی نهێنی دەبێت لانیکەم ٨ پیت بێت." };
  if (problem === "too-long") return { ok: false, field: "password", error: "وشەی نهێنی زۆر درێژە." };

  const taken = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (taken) return { ok: false, field: "email", error: "ئەم ئیمەیڵە پێشتر تۆمار کراوە — بچۆ ژوورەوە." };

  try {
    const user = await db.user.create({
      data: { name, email, passwordHash: await hashPassword(input.password) },
      select: { id: true },
    });
    await ensureWorkspace(user.id, name);
  } catch {
    // Two sign-ups with the same address at once: the unique email wins once.
    return { ok: false, field: "email", error: "ئەم ئیمەیڵە پێشتر تۆمار کراوە — بچۆ ژوورەوە." };
  }
  return { ok: true, email };
}
