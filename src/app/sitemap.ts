import type { MetadataRoute } from "next";
import { headers } from "next/headers";

import { NEWSROOM_ORIGIN } from "@/lib/hosts";
import { CONTENT_UPDATED, guideSlugs } from "@/lib/site/content";
import { HREFLANG, SITE_LANGS, siteUrl, type SitePath } from "@/lib/site/langs";

/** Every public page in every language, each listing its translations (hreflang). Hawalnoos has its own one-page map. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = ((await headers()).get("host") ?? "").toLowerCase().split(":")[0];
  if (host.endsWith("hawalnoos.com")) return [{ url: `${NEWSROOM_ORIGIN}/`, lastModified: CONTENT_UPDATED, changeFrequency: "monthly", priority: 1 }];

  const paths: { path: SitePath; priority: number; freq: "weekly" | "monthly" }[] = [
    { path: "", priority: 1, freq: "weekly" },
    { path: "/pricing", priority: 0.9, freq: "monthly" },
    { path: "/guides", priority: 0.8, freq: "weekly" },
    { path: "/about", priority: 0.5, freq: "monthly" },
    ...guideSlugs().map((slug) => ({ path: `/guides/${slug}` as SitePath, priority: 0.7, freq: "monthly" as const })),
  ];
  return paths.flatMap(({ path, priority, freq }) =>
    SITE_LANGS.map((lang) => ({
      url: siteUrl(lang, path),
      lastModified: CONTENT_UPDATED,
      changeFrequency: freq,
      priority,
      alternates: { languages: { ...Object.fromEntries(SITE_LANGS.map((l) => [HREFLANG[l], siteUrl(l, path)])), "x-default": siteUrl("en", path) } },
    })),
  );
}
