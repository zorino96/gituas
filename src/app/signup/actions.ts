"use server";

import { headers } from "next/headers";

import { db } from "@/lib/db";
import { ensureWorkspace } from "@/auth";
import { hashPassword, normalizeEmail, passwordProblem } from "@/lib/password";
import {
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  MAX_SENDS_PER_HOUR,
  MAX_SENDS_PER_IP_PER_HOUR,
  RESEND_COOLDOWN_MS,
  codeMatches,
  hashCode,
  newCode,
  normalizeCode,
} from "@/lib/email-code";
import { emailEnabled, sendEmail, signupCodeEmail } from "@/lib/mailer";

export type SignupResult =
  | { ok: true; email: string; verify: boolean }
  | { ok: false; error: string; field?: "name" | "email" | "password" | "code" };

const TAKEN = "ئەم ئیمەیڵە پێشتر تۆمار کراوە — بچۆ ژوورەوە.";
const HOUR_MS = 60 * 60 * 1000;

async function clientIp(): Promise<string | null> {
  try {
    const h = await headers();
    return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  } catch {
    // Outside a request (scripts, tests) there is no connection to limit.
    return null;
  }
}

/**
 * Store a new code for this address and email it. Refuses when the address
 * or the connection has asked for too many, so the form can't be used to
 * flood someone's inbox or burn the sending domain's reputation.
 */
async function issueCode(email: string, pending: { name: string; passwordHash: string }): Promise<SignupResult> {
  const now = Date.now();
  const ip = await clientIp();
  const [last, perEmail, perIp] = await Promise.all([
    db.emailCode.findFirst({ where: { email, purpose: "signup" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.emailCode.count({ where: { email, purpose: "signup", createdAt: { gte: new Date(now - HOUR_MS) } } }),
    ip ? db.emailCode.count({ where: { ip, createdAt: { gte: new Date(now - HOUR_MS) } } }) : 0,
  ]);
  if (last && now - last.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    return { ok: false, field: "code", error: "کۆدێک تازە نێردرا. یەک خولەک چاوەڕێ بکە پێش داواکردنی کۆدێکی تر." };
  }
  if (perEmail >= MAX_SENDS_PER_HOUR || perIp >= MAX_SENDS_PER_IP_PER_HOUR) {
    return { ok: false, field: "code", error: "کۆدی زۆر داواکراوە. دوای کاتژمێرێک هەوڵ بدەرەوە." };
  }

  const code = newCode();
  const row = await db.emailCode.create({
    data: {
      email,
      purpose: "signup",
      codeHash: hashCode(email, code),
      name: pending.name,
      passwordHash: pending.passwordHash,
      ip,
      expiresAt: new Date(now + CODE_TTL_MS),
    },
    select: { id: true },
  });
  const sent = await sendEmail({ to: email, ...signupCodeEmail(code) });
  if (!sent.ok) {
    // An unsent code must not count against their limits or sit waiting.
    await db.emailCode.delete({ where: { id: row.id } });
    return { ok: false, field: "email", error: "نەتوانرا ئیمەیڵ بنێردرێت. ئیمەیڵەکە بپشکنە و دووبارە هەوڵ بدەرەوە." };
  }
  return { ok: true, email, verify: true };
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
  const name = input.name.trim().slice(0, 60);
  if (!name) return { ok: false, field: "name", error: "ناوی دووکان یان ناوی خۆت بنووسە." };

  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, field: "email", error: "ئیمەیڵەکە دروست نییە." };

  const problem = passwordProblem(input.password);
  if (problem === "too-short") return { ok: false, field: "password", error: "وشەی نهێنی دەبێت لانیکەم ٨ پیت بێت." };
  if (problem === "too-long") return { ok: false, field: "password", error: "وشەی نهێنی زۆر درێژە." };

  const taken = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (taken) return { ok: false, field: "email", error: TAKEN };

  const passwordHash = await hashPassword(input.password);
  if (emailEnabled) return issueCode(email, { name, passwordHash });

  if (!(await createAccount(email, name, passwordHash, false))) return { ok: false, field: "email", error: TAKEN };
  return { ok: true, email, verify: false };
}

/** Send a fresh code for a sign-up that is waiting on one. */
export async function resendSignupCodeAction(input: { email: string }): Promise<SignupResult> {
  const email = normalizeEmail(input.email);
  if (!email || !emailEnabled) return { ok: false, field: "code", error: "دووبارە خۆت تۆمار بکەرەوە." };
  const pending = await db.emailCode.findFirst({
    where: { email, purpose: "signup", usedAt: null, createdAt: { gte: new Date(Date.now() - 24 * HOUR_MS) } },
    orderBy: { createdAt: "desc" },
    select: { name: true, passwordHash: true },
  });
  if (!pending?.name || !pending.passwordHash) return { ok: false, field: "code", error: "کاتی ئەم تۆمارکردنە بەسەرچووە. دووبارە خۆت تۆمار بکەرەوە." };
  return issueCode(email, { name: pending.name, passwordHash: pending.passwordHash });
}

/** Check the emailed code; on a match, create the account it was holding. */
export async function verifySignupAction(input: { email: string; code: string }): Promise<SignupResult> {
  const email = normalizeEmail(input.email);
  const code = normalizeCode(input.code);
  if (!email) return { ok: false, field: "code", error: "دووبارە خۆت تۆمار بکەرەوە." };
  if (!code) return { ok: false, field: "code", error: "کۆدەکە ٦ ژمارەیە." };

  // Only the newest code counts: sending a new one retires the old.
  const row = await db.emailCode.findFirst({
    where: { email, purpose: "signup" },
    orderBy: { createdAt: "desc" },
  });
  if (!row || row.usedAt || !row.name || !row.passwordHash) return { ok: false, field: "code", error: "کۆدێکی نوێ داوا بکە." };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, field: "code", error: "کاتی کۆدەکە بەسەرچووە. کۆدێکی نوێ داوا بکە." };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, field: "code", error: "زۆر جار هەڵە کرا. کۆدێکی نوێ داوا بکە." };

  if (!codeMatches(email, code, row.codeHash)) {
    await db.emailCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    const left = MAX_ATTEMPTS - row.attempts - 1;
    return { ok: false, field: "code", error: left > 0 ? "کۆدەکە هەڵەیە." : "زۆر جار هەڵە کرا. کۆدێکی نوێ داوا بکە." };
  }

  // Claim the code exactly once, even if the button is pressed twice.
  const claimed = await db.emailCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) return { ok: false, field: "code", error: "کۆدێکی نوێ داوا بکە." };

  if (!(await createAccount(email, row.name, row.passwordHash, true))) return { ok: false, field: "email", error: TAKEN };
  // The pending password hash has done its job; don't keep copies of it.
  await db.emailCode.deleteMany({ where: { email, purpose: "signup" } });
  return { ok: true, email, verify: false };
}
