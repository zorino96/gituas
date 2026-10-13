import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { landingFor } from "@/lib/site/content";
import { isSiteLang, SITE_LANGS } from "@/lib/site/langs";
import { planRows } from "@/lib/site/pricing";
import { faqPage, graph, organization, pageMetadata, softwareApplication, website } from "@/lib/site/seo";
import { LandingView } from "../_components/views";

export const revalidate = 3600;
export const dynamicParams = false;
export const generateStaticParams = () => SITE_LANGS.map((lang) => ({ lang }));

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isSiteLang(lang)) return {};
  const l = landingFor(lang);
  return pageMetadata({ lang, path: "", title: l.metaTitle, description: l.metaDescription });
}

export default async function SiteHome({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isSiteLang(lang)) notFound();
  const landing = landingFor(lang);
  const plans = planRows();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: graph(organization(), website(), softwareApplication(lang, landing, plans), faqPage(landing.faq)) }} />
      <LandingView lang={lang} landing={landing} plans={plans} />
    </>
  );
}
