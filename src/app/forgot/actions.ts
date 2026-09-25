"use server";

import { db } from "@/lib/db";
import { hashPassword, normalizeEmail, passwordProblem } from "@/lib/password";
import { clearEmailCodes, consumeEmailCode, issueEmailCode } from "@/lib/email-code-store";
import { emailEnabled } from "@/lib/mailer";

export type ResetResult = { ok: true; email: string } | { ok: false; error: string; field?: "email" | "code" | "password" };

/**
 * Email a code that lets the owner of this address set a new password. The
 * answer is the same whether or not an account exists, so the form can't be
 * used to find out who has one; only an existing account gets an email.
 */
export async function requestResetAction(input: { email: string }): Promise<ResetResult> {
  if (!emailEnabled) return { ok: false, field: "email", error: "ئەم خزمەتگوزارییە ئێستا بەردەست نییە." };
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, field: "email", error: "ئیمەیڵەکە دروست نییە." };

  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (user) {
    const r = await issueEmailCode(email, "reset");
    if (!r.ok) return r;
  }
  return { ok: true, email };
}

/**
 * Check the code and set the new password. Proving the address also proves
 * it for an account made with Google or GitHub, so those can add a password
 * this way. Old failed-password counts are cleared so the owner isn't locked
 * out by the guesses that sent them here.
 */
export async function resetPasswordAction(input: { email: string; code: string; password: string }): Promise<ResetResult> {
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, field: "email", error: "دووبارە هەوڵ بدەرەوە." };

  // Checked before the code, so a short password doesn't use up a guess.
  const problem = passwordProblem(input.password);
  if (problem === "too-short") return { ok: false, field: "password", error: "وشەی نهێنی دەبێت لانیکەم ٨ پیت بێت." };
  if (problem === "too-long") return { ok: false, field: "password", error: "وشەی نهێنی زۆر درێژە." };

  const r = await consumeEmailCode(email, "reset", input.code);
  if (!r.ok) return r;

  const user = await db.user.findUnique({ where: { email }, select: { id: true, emailVerified: true } });
  if (!user) return { ok: false, field: "code", error: "کۆدێکی نوێ داوا بکە." };

  await db.user.update({
    where: { id: user.id },
    // A new session version signs out every device, which is the point of a
    // reset when someone else may know the old password.
    data: {
      passwordHash: await hashPassword(input.password),
      emailVerified: user.emailVerified ?? new Date(),
      sessionVersion: { increment: 1 },
    },
  });
  await Promise.all([db.loginAttempt.deleteMany({ where: { email } }), clearEmailCodes(email, "reset")]);
  return { ok: true, email };
}
