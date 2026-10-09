import { headers } from "next/headers";

import { db } from "@/lib/db";
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
import { ckb, type Dict } from "@/lib/i18n/ckb";
import { codeEmail, sendEmail } from "@/lib/mailer";

/** What a code proves: a new account's address, or the right to set a new password. */
export type CodePurpose = "signup" | "reset";

type Failure = { ok: false; error: string; field: "code" | "email" };

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
 * The refusals are worded in `t`'s language (Sorani when it is left out).
 */
export async function issueEmailCode(
  email: string,
  purpose: CodePurpose,
  pending: { name?: string; passwordHash?: string } = {},
  t: Dict = ckb,
): Promise<{ ok: true } | Failure> {
  const now = Date.now();
  const ip = await clientIp();
  const [last, perEmail, perIp] = await Promise.all([
    db.emailCode.findFirst({ where: { email, purpose }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.emailCode.count({ where: { email, purpose, createdAt: { gte: new Date(now - HOUR_MS) } } }),
    ip ? db.emailCode.count({ where: { ip, createdAt: { gte: new Date(now - HOUR_MS) } } }) : 0,
  ]);
  if (last && now - last.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    return { ok: false, field: "code", error: t.auth.code.justSent };
  }
  if (perEmail >= MAX_SENDS_PER_HOUR || perIp >= MAX_SENDS_PER_IP_PER_HOUR) {
    return { ok: false, field: "code", error: t.auth.code.tooMany };
  }

  const code = newCode();
  const row = await db.emailCode.create({
    data: {
      email,
      purpose,
      codeHash: hashCode(email, code),
      name: pending.name,
      passwordHash: pending.passwordHash,
      ip,
      expiresAt: new Date(now + CODE_TTL_MS),
    },
    select: { id: true },
  });
  const sent = await sendEmail({ to: email, ...codeEmail(code, purpose) });
  if (!sent.ok) {
    // An unsent code must not count against their limits or sit waiting.
    await db.emailCode.delete({ where: { id: row.id } });
    return { ok: false, field: "email", error: t.auth.code.sendFailed };
  }
  return { ok: true };
}

/**
 * Check a typed code against the newest one for this address — sending a new
 * code retires the old — and claim it exactly once. Wrong guesses count
 * against the code; after MAX_ATTEMPTS a new one has to be sent.
 * The refusals are worded in `t`'s language (Sorani when it is left out).
 */
export async function consumeEmailCode(
  email: string,
  purpose: CodePurpose,
  rawCode: string,
  t: Dict = ckb,
): Promise<{ ok: true; name: string | null; passwordHash: string | null } | Failure> {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, field: "code", error: t.auth.code.sixDigits };

  const row = await db.emailCode.findFirst({ where: { email, purpose }, orderBy: { createdAt: "desc" } });
  if (!row || row.usedAt) return { ok: false, field: "code", error: t.auth.common.newCode };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, field: "code", error: t.auth.code.expired };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, field: "code", error: t.auth.code.tooManyWrong };
  // Take the attempt before comparing, in one conditional write: parallel guesses cannot all
  // read the same count and slip in under the limit.
  const took = await db.emailCode.updateMany({ where: { id: row.id, usedAt: null, attempts: { lt: MAX_ATTEMPTS } }, data: { attempts: { increment: 1 } } });
  if (took.count !== 1) return { ok: false, field: "code", error: t.auth.code.tooManyWrong };

  if (!codeMatches(email, code, row.codeHash)) {
    const left = MAX_ATTEMPTS - row.attempts - 1;
    return { ok: false, field: "code", error: left > 0 ? t.auth.code.wrong : t.auth.code.tooManyWrong };
  }

  // Claim the code exactly once, even if the button is pressed twice.
  const claimed = await db.emailCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) return { ok: false, field: "code", error: t.auth.common.newCode };
  return { ok: true, name: row.name, passwordHash: row.passwordHash };
}

/** Drop every code for this address and purpose once it has done its job. */
export async function clearEmailCodes(email: string, purpose: CodePurpose): Promise<void> {
  await db.emailCode.deleteMany({ where: { email, purpose } });
}
