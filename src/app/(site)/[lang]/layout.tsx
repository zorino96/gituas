import { notFound } from "next/navigation";

import { isSiteLang, SITE_LANGS } from "@/lib/site/langs";
import { SiteFrame } from "../_components/site-frame";

export const dynamicParams = false;
export function generateStaticParams() {
  return SITE_LANGS.map((lang) => ({ lang }));
}

export default async function SiteLayout({ children, params }: { children: React.ReactNode; params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isSiteLang(lang)) notFound();
  return <SiteFrame lang={lang}>{children}</SiteFrame>;
}
