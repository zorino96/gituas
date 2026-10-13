import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CHROME } from "@/lib/site/chrome";
import { guidesFor } from "@/lib/site/content";
import { isSiteLang, siteUrl, SITE_LANGS, sitePath } from "@/lib/site/langs";
import { breadcrumbs, graph, organization, pageMetadata } from "@/lib/site/seo";
import { GuidesIndexView } from "../../_components/views";

export const revalidate = 3600;
export const dynamicParams = false;
export const generateStaticParams = () => SITE_LANGS.map((lang) => ({ lang }));

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isSiteLang(lang)) return {};
  const c = CHROME[lang];
  return pageMetadata({ lang, path: "/guides", title: c.guides.metaTitle, description: c.guides.intro });
}

export default async function GuidesPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isSiteLang(lang)) notFound();
  const c = CHROME[lang];
  const list = guidesFor(lang).map((g, i) => ({ "@type": "ListItem", position: i + 1, url: siteUrl(lang, `/guides/${g.slug}`), name: g.title }));
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: graph(
            organization(),
            { "@type": "CollectionPage", name: c.guides.title, url: siteUrl(lang, "/guides"), mainEntity: { "@type": "ItemList", itemListElement: list } },
            breadcrumbs([
              { name: c.home, url: siteUrl(lang) },
              { name: c.guides.title, url: siteUrl(lang, "/guides") },
            ]),
          ),
        }}
      />
      <GuidesIndexView lang={lang} />
    </>
  );
}
