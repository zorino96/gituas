import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { SUPABASE_ROOT_CA } from "./db-certs";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

/**
 * TLS for the database: Supabase hosts are verified against Supabase's own root (Node does not
 * trust it by default, and without this the pooler would also accept an unencrypted connection);
 * anything else keeps what its URL asks for.
 */
export function sslFor(url: string | undefined): { ca: string; rejectUnauthorized: true } | undefined {
  try {
    const host = new URL(url ?? "").hostname;
    if (host.endsWith(".supabase.com") || host.endsWith(".supabase.co")) return { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true };
  } catch {
    // not a URL: the driver reports it
  }
  return undefined;
}

/** The URL without an sslmode parameter, which would override the verified TLS setting. */
export function withoutSslMode(url: string): string {
  const u = new URL(url);
  u.searchParams.delete("sslmode");
  return u.toString();
}

function makeClient() {
  const connectionString = process.env.DATABASE_URL;
  const ssl = sslFor(connectionString);
  const adapter = new PrismaPg(
    ssl && connectionString ? { connectionString: withoutSslMode(connectionString), ssl } : { connectionString },
  );
  return new PrismaClient({ adapter });
}

export const db = globalThis.__prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = db;
}
