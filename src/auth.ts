import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";

import { db } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  providers: [
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
  ],
  session: { strategy: "database" },
  pages: { signIn: "/login" },
  callbacks: {
    async session({ session, user }) {
      if (session.user && user) {
        session.user.id = user.id;
      }
      return session;
    },
    async signIn({ user }) {
      // After GitHub sign-in, make sure this user has a Tenant. If not, create one.
      if (!user.id) return true;
      const existing = await db.tenant.findFirst({ where: { ownerId: user.id } });
      if (!existing) {
        const slug = `t-${user.id.slice(0, 8)}`;
        await db.tenant.create({
          data: {
            name: user.name ? `${user.name}'s workspace` : "My workspace",
            slug,
            ownerId: user.id,
            memberships: { create: { userId: user.id, role: "OWNER" } },
          },
        });
      }
      return true;
    },
  },
});
