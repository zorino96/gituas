"use server";

import { db } from "@/lib/db";
import { ensureWorkspace } from "@/auth";
import { hashPassword, normalizeEmail, passwordProblem } from "@/lib/password";
import { clearEmailCodes, consumeEmailCode, issueEmailCode } from "@/lib/email-code-store";
import { emailEnabled } from "@/lib/mailer";
import { dict, getLang, type Dict } from "@/lib/i18n";

export type SignupResult =
  | { ok: true; email: string; verify: boolean }
  | { ok: false; error: string; field?: "name" | "email" | "password" | "code" };

const DAY_MS = 24 * 60 * 60 * 1000;

async function sendCode(email: string, pending: { name: string; passwordHash: string }, t: Dict): Promise<SignupResult> {
  const r = await issueEmailCode(email, "signup", pending, t);
  return r.ok ? { ok: true, email, verify: true } : r;
}

async function createAccount(email: string, name: string, passwordHash: string, verified: boolean): Promise<boolean> {
  try {
    const user = await db.user.create({
      data: { name, email, passwordHash, emailVerified: verified ? new Date() : null },
      select: { id: true },
    });
    await ensureWorkspace(user.id, name);
    return true;
  } catch {
    // Two sign-ups with the same address at once: the unique email wins once.
    return false;
  }
}

/**
 * Start an email-and-password sign-up. With email sending on, this only
 * sends a code and the account is created when the code comes back; without
 * it the account is created at once. Signing in happens in the browser
 * afterwards, through the same credentials provider a returning user goes
 * through, so there is one sign-in path, not two.
 */
export async function signupAction(input: { name: string; email: string; password: string }): Promise<SignupResult> {
  const t = dict(await getLang());
  const name = input.name.trim().slice(0, 60);
  if (!name) return { ok: false, field: "name", error: t.auth.signup.nameMissing };

  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, field: "email", error: t.auth.common.badEmail };

  const problem = passwordProblem(input.password);
  if (problem === "too-short") return { ok: false, field: "password", error: t.auth.common.passwordShort };
  if (problem === "too-long") return { ok: false, field: "password", error: t.auth.common.passwordLong };

  const taken = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (taken) return { ok: false, field: "email", error: t.auth.signup.taken };

  const passwordHash = await hashPassword(input.password);
  if (emailEnabled) return sendCode(email, { name, passwordHash }, t);

  if (!(await createAccount(email, name, passwordHash, false))) return { ok: false, field: "email", error: t.auth.signup.taken };
  return { ok: true, email, verify: false };
}

/** Send a fresh code for a sign-up that is waiting on one. */
export async function resendSignupCodeAction(input: { email: string }): Promise<SignupResult> {
  const t = dict(await getLang());
  const email = normalizeEmail(input.email);
  if (!email || !emailEnabled) return { ok: false, field: "code", error: t.auth.signup.signUpAgain };
  const pending = await db.emailCode.findFirst({
    where: { email, purpose: "signup", usedAt: null, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
    orderBy: { createdAt: "desc" },
    select: { name: true, passwordHash: true },
  });
  if (!pending?.name || !pending.passwordHash) return { ok: false, field: "code", error: t.auth.signup.expired };
  return sendCode(email, { name: pending.name, passwordHash: pending.passwordHash }, t);
}

/** Check the emailed code; on a match, create the account it was holding. */
export async function verifySignupAction(input: { email: string; code: string }): Promise<SignupResult> {
  const t = dict(await getLang());
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, field: "code", error: t.auth.signup.signUpAgain };

  const r = await consumeEmailCode(email, "signup", input.code, t);
  if (!r.ok) return r;
  if (!r.name || !r.passwordHash) return { ok: false, field: "code", error: t.auth.common.newCode };

  if (!(await createAccount(email, r.name, r.passwordHash, true))) return { ok: false, field: "email", error: t.auth.signup.taken };
  // The pending password hash has done its job; don't keep copies of it.
  await clearEmailCodes(email, "signup");
  return { ok: true, email, verify: false };
}
