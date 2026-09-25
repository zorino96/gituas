import NextAuth from "next-auth";
import type { JWT } from "next-auth/jwt";
import type { Provider } from "next-auth/providers";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";

import { db } from "@/lib/db";
import { normalizeEmail, verifyPassword } from "@/lib/password";

/** Guessing throttle: this many failed passwords per address per window. */
export const MAX_FAILURES = 10;
export const WINDOW_MS = 15 * 60 * 1000;

/**
 * Session versions, cached briefly so every auth() call isn't a database
 * read. A stale entry is always older than the truth, and only a token older
 * than the cached version is refused — so the cache can delay signing out
 * other devices by up to VERSION_TTL_MS, but never signs out a fresh token.
 */
const versionCache = new Map<string, { v: number; at: number }>();
const VERSION_TTL_MS = 30_000;

async function sessionVersion(userId: string, fresh = false): Promise<number | null> {
  const hit = versionCache.get(userId);
  if (!fresh && hit && Date.now() - hit.at < VERSION_TTL_MS) return hit.v;
  const row = await db.user.findUnique({ where: { id: userId }, select: { sessionVersion: true } });
  if (!row) {
    versionCache.delete(userId);
    return null;
  }
  versionCache.set(userId, { v: row.sessionVersion, at: Date.now() });
  return row.sessionVersion;
}

/**
 * The jwt callback. At sign-in the token records the account's session
 * version; afterwards a token from before the latest password change, or for
 * an account that no longer exists, is refused (null signs the device out).
 * Tokens issued before versions existed carry none and count as version 0.
 */
export async function checkSessionToken({ token, user }: { token: JWT; user?: { id?: string } | null }): Promise<JWT | null> {
  if (user?.id) {
    token.sub = user.id;
    token.sv = (await sessionVersion(user.id, true)) ?? 0;
    return token;
  }
  if (token.sub) {
    const current = await sessionVersion(token.sub);
    if (current === null || Number(token.sv ?? 0) < current) return null;
  }
  return token;
}

/** Google sign-in switches on when its credentials exist in the environment. */
export const googleEnabled = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

const providers: Provider[] = [
  GitHub({
    clientId: process.env.AUTH_GITHUB_ID!,
    clientSecret: process.env.AUTH_GITHUB_SECRET!,
    // GitHub OAuth Apps don't support PKCE — only standard "state" check.
    checks: ["state"],
    authorization: {
      params: {
        // Need repo scope so we can read README/source files of the user's repos.
        scope: "read:user user:email repo",
      },
    },
  }),
  Credentials({
    id: "credentials",
    name: "Email",
    credentials: { email: {}, password: {} },
    async authorize(raw) {
      const email = normalizeEmail(String(raw?.email ?? ""));
      const password = String(raw?.password ?? "");
      if (!email || !password) return null;

      const since = new Date(Date.now() - WINDOW_MS);
      const failures = await db.loginAttempt.count({ where: { email, createdAt: { gte: since } } });
      if (failures >= MAX_FAILURES) return null;

      const user = await db.user.findUnique({ where: { email } });
      const ok = !!user?.passwordHash && (await verifyPassword(password, user.passwordHash));
      if (!ok || !user) {
        await db.loginAttempt.create({ data: { email } });
        return null;
      }
      await db.loginAttempt.deleteMany({ where: { email } });
      return { id: user.id, name: user.name, email: user.email, image: user.image };
    },
  }),
];

if (googleEnabled) {
  providers.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  providers,
  // JWT sessions: Auth.js only supports email-and-password sign-in with JWT
  // sessions. Accounts and users still live in the database through the adapter.
  session: { strategy: "jwt" },
  // Failed sign-ins (an expired check cookie, a provider error) come back to
  // the sign-in page with ?error= instead of Auth.js's bare English error page.
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    jwt: checkSessionToken,
    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
  events: {
    // A workspace for every new user, created once the adapter has written the
    // user row — at signIn time a first-time OAuth user does not have their
    // database id yet. currentWorkspace() also creates one lazily as a backstop.
    async createUser({ user }) {
      if (user.id) await ensureWorkspace(user.id, user.name);
    },
  },
});

/** The user's workspace, created on first need. Safe to call concurrently. */
export async function ensureWorkspace(userId: string, name?: string | null) {
  const existing = await db.tenant.findFirst({ where: { ownerId: userId }, select: { id: true } });
  if (existing) return existing;
  try {
    return await db.tenant.create({
      data: {
        name: name?.trim() || "دووکانەکەم",
        slug: `t-${userId.slice(0, 8)}${userId.slice(-4)}`,
        ownerId: userId,
        memberships: { create: { userId, role: "OWNER" } },
      },
      select: { id: true },
    });
  } catch {
    // A concurrent request created it first (unique slug) — use that one.
    const again = await db.tenant.findFirst({ where: { ownerId: userId }, select: { id: true } });
    if (again) return again;
    throw new Error("Could not create a workspace");
  }
}
