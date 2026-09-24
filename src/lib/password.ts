import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// scrypt from Node's standard library: memory-hard, no native dependency to
// build on Vercel. The parameters are written into every stored hash, so they
// can be raised later without invalidating existing passwords.
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function derive(password: string, salt: Buffer, n: number, r: number, p: number, keylen: number): Promise<Buffer> {
  const opts: ScryptOptions = { N: n, r, p, maxmem: 128 * n * r * 2 };
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** `scrypt$N$r$p$salt$key`, base64 salt and key. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P, KEYLEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/** Constant-time check. A malformed stored value is a failed check, never an exception. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, "base64");
  if (!expected.length || !Number(n) || !Number(r) || !Number(p)) return false;
  try {
    const actual = await derive(password, Buffer.from(saltB64, "base64"), Number(n), Number(r), Number(p), expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export type PasswordProblem = "too-short" | "too-long";

export function passwordProblem(password: string): PasswordProblem | null {
  const length = [...password].length;
  if (length < 8) return "too-short";
  if (length > 200) return "too-long";
  return null;
}

/** Lowercased, trimmed address, or null when it is not plausibly an email. */
export function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254 ? e : null;
}
