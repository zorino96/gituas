import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CHROME } from "@/lib/site/chrome";
import { isSiteLang, siteUrl, SITE_LANGS } from "@/lib/site/langs";
import { breadcrumbs, graph, organization, pageMetadata } from "@/lib/site/seo";

export const revalidate = 3600;
export const dynamicParams = false;
export const generateStaticParams = () => SITE_LANGS.map((lang) => ({ lang }));

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isSiteLang(lang)) return {};
  const c = CHROME[lang].about;
  return pageMetadata({ lang, path: "/about", title: c.metaTitle, description: c.metaDescription });
}

export default async function AboutPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isSiteLang(lang)) notFound();
  const c = CHROME[lang];
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: graph(
            organization(),
            { "@type": "AboutPage", name: c.about.title, url: siteUrl(lang, "/about"), about: { "@id": "https://gituas.com/#organization" } },
            breadcrumbs([
              { name: c.home, url: siteUrl(lang) },
              { name: c.about.title, url: siteUrl(lang, "/about") },
            ]),
          ),
        }}
      />
      <section className="site-section site-wrap site-article">
        <h1>{c.about.title}</h1>
        {c.about.paragraphs.map((p) => (
          <p key={p}>{p}</p>
        ))}
        <h2>{c.about.contactTitle}</h2>
        <p>{c.about.contact}</p>
      </section>
    </>
  );
}
