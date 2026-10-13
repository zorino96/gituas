import type { MetadataRoute } from "next";
import { headers } from "next/headers";

import { NEWSROOM_ORIGIN, SHOP_ORIGIN } from "@/lib/hosts";

/** AI answer engines and search crawlers may read the public pages; the signed-in areas and plumbing are private. */
const PRIVATE = ["/app/", "/api/", "/m/", "/w/", "/connect/", "/dev/", "/studio-render/", "/newsroom/", "/login", "/signup", "/forgot"];

export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = ((await headers()).get("host") ?? "").toLowerCase().split(":")[0];
  const origin = host.endsWith("hawalnoos.com") ? NEWSROOM_ORIGIN : SHOP_ORIGIN;
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: PRIVATE }],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
