import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { getLang } from "@/lib/i18n";
import { landingFor } from "@/lib/site/content";
import { LANG_TO_SITE } from "@/lib/site/langs";
import { planRows } from "@/lib/site/pricing";
import { faqPage, graph, organization, pageMetadata, softwareApplication, website } from "@/lib/site/seo";
import { LandingView } from "@/app/(site)/_components/views";
import { SiteFrame } from "@/app/(site)/_components/site-frame";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

/** The language this request reads: the saved choice, else the browser's and the country's (English for the world). */
async function siteLang() {
  return LANG_TO_SITE[await getLang({ publicSite: true })];
}

export async function generateMetadata(): Promise<Metadata> {
  const lang = await siteLang();
  const l = landingFor(lang);
  // The same page as /en, /ku or /ar: those are its canonical addresses.
  return pageMetadata({ lang, path: "", title: l.metaTitle, description: l.metaDescription });
}

/**
 * gituas.com for visitors who are not signed in: what Gituas does and the way in, with the privacy, terms and
 * data-deletion links (it is the home page Google's app review checks). src/lib/hosts.ts rewrites the shop
 * domain's "/" here; signed-in people go straight to the shop. The text is the website's landing page in the
 * visitor's language.
 */
export default async function WelcomePage() {
  if (await auth()) redirect("/app");
  const lang = await siteLang();
  const landing = landingFor(lang);
  const plans = planRows();
  return (
    <SiteFrame lang={lang}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: graph(organization(), website(), softwareApplication(lang, landing, plans), faqPage(landing.faq)) }} />
      <LandingView lang={lang} landing={landing} plans={plans} />
    </SiteFrame>
  );
}
