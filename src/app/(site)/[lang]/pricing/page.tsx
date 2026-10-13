import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CHROME } from "@/lib/site/chrome";
import { landingFor } from "@/lib/site/content";
import { isSiteLang, siteUrl, SITE_LANGS, sitePath } from "@/lib/site/langs";
import { planRows } from "@/lib/site/pricing";
import { breadcrumbs, faqPage, graph, organization, pageMetadata, softwareApplication } from "@/lib/site/seo";
import { PricingView } from "../../_components/views";

export const revalidate = 3600;
export const dynamicParams = false;
export const generateStaticParams = () => SITE_LANGS.map((lang) => ({ lang }));

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isSiteLang(lang)) return {};
  const c = CHROME[lang].pricing;
  return pageMetadata({ lang, path: "/pricing", title: c.metaTitle, description: c.metaDescription });
}

export default async function PricingPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isSiteLang(lang)) notFound();
  const c = CHROME[lang];
  const plans = planRows();
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: graph(
            organization(),
            softwareApplication(lang, landingFor(lang), plans),
            faqPage(c.pricing.faq),
            breadcrumbs([
              { name: c.home, url: siteUrl(lang) },
              { name: c.nav.pricing, url: siteUrl(lang, "/pricing") },
            ]),
          ),
        }}
      />
      <PricingView lang={lang} plans={plans} />
    </>
  );
}
