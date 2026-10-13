import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CHROME } from "@/lib/site/chrome";
import { guideFor, guideSlugs } from "@/lib/site/content";
import { isSiteLang, siteUrl, SITE_LANGS } from "@/lib/site/langs";
import { article, breadcrumbs, faqPage, graph, howTo, organization, pageMetadata } from "@/lib/site/seo";
import { GuideView } from "../../../_components/views";

export const revalidate = 3600;
export const dynamicParams = false;
export const generateStaticParams = () => SITE_LANGS.flatMap((lang) => guideSlugs().map((slug) => ({ lang, slug })));

export async function generateMetadata({ params }: { params: Promise<{ lang: string; slug: string }> }): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!isSiteLang(lang)) return {};
  const g = guideFor(lang, slug);
  if (!g) return {};
  return pageMetadata({ lang, path: `/guides/${slug}`, title: g.metaTitle, description: g.metaDescription, type: "article" });
}

export default async function GuidePage({ params }: { params: Promise<{ lang: string; slug: string }> }) {
  const { lang, slug } = await params;
  if (!isSiteLang(lang)) notFound();
  const g = guideFor(lang, slug);
  if (!g) notFound();
  const c = CHROME[lang];
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: graph(
            organization(),
            article(lang, g),
            howTo(lang, g),
            faqPage(g.faq),
            breadcrumbs([
              { name: c.home, url: siteUrl(lang) },
              { name: c.guides.title, url: siteUrl(lang, "/guides") },
              { name: g.title, url: siteUrl(lang, `/guides/${slug}`) },
            ]),
          ),
        }}
      />
      <GuideView lang={lang} guide={g} />
    </>
  );
}
