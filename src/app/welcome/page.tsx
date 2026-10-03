import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3, MessageCircle, PackageCheck, Send, ShieldCheck, Sparkles } from "lucide-react";

import "@/app/app/app.css";
import "@/app/newsroom/newsroom.css";
import { auth } from "@/auth";
import { gmFontVars } from "@/app/app/fonts";
import { LangSwitch } from "@/app/app/lang-switch";
import { NEWSROOM_ORIGIN } from "@/lib/hosts";
import { dict, dirOf, getLang } from "@/lib/i18n";
import { LangProvider } from "@/lib/i18n/client";

export async function generateMetadata(): Promise<Metadata> {
  const t = dict(await getLang()).welcome;
  return { title: t.metaTitle, description: t.metaDescription };
}
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

const FEATURES = [
  { key: "publish", Icon: Send },
  { key: "ai", Icon: Sparkles },
  { key: "replies", Icon: MessageCircle },
  { key: "orders", Icon: PackageCheck },
  { key: "insights", Icon: BarChart3 },
] as const;

/**
 * gituas.com for visitors who are not signed in: what Gituas does and the way in, with the
 * privacy, terms and data-deletion links (it is the home page Google's app review checks).
 * src/lib/hosts.ts rewrites the shop domain's "/" here; signed-in people go straight to the shop.
 */
export default async function WelcomePage() {
  if (await auth()) redirect("/app");
  const lang = await getLang();
  const t = dict(lang);
  const w = t.welcome;

  return (
    <div className={`gm ${gmFontVars}`} dir={dirOf(lang)} lang={lang}>
      <LangProvider lang={lang}>
        <div className="nr-land">
          <LangSwitch />
          <header className="nr-land-bar">
            <div className="nr-wrap">
              <p className="gm-brand kufi">{t.brand}</p>
              <Link href="/login?next=/app" className="gm-btn quiet small">
                {w.signIn}
              </Link>
            </div>
          </header>

          <main className="nr-land-main nr-wrap">
            <section className="nr-hero">
              <div className="nr-hero-copy">
                <h1 className="kufi">{w.title}</h1>
                <p>{w.lead}</p>

                <div className="nr-cta">
                  <Link href="/signup?next=/app" className="gm-btn">
                    {w.start}
                  </Link>
                  <Link href="/login?next=/app" className="gm-btn quiet">
                    {w.signIn}
                  </Link>
                </div>
                <p className="nr-promise">
                  <ShieldCheck aria-hidden="true" />
                  {w.promise}
                </p>
              </div>

              {/* decoration only: one post on its way to the platforms */}
              <div className="nr-art" aria-hidden="true">
                <div className="nr-art-card back" />
                <div className="nr-art-card">
                  <div className="nr-art-top">
                    <i />
                    <i />
                  </div>
                  <div className="nr-art-photo" />
                  <div className="nr-art-lines">
                    <i />
                    <i />
                    <i />
                  </div>
                  <div className="nr-art-plats">
                    <b />
                    <b />
                    <b />
                    <i />
                  </div>
                </div>
              </div>
            </section>

            <div className="nr-features">
              {FEATURES.map(({ key, Icon }) => (
                <div key={key} className="nr-feature">
                  <span className="nr-feature-icon" aria-hidden="true">
                    <Icon />
                  </span>
                  <h3 className="kufi">{w.features[key].title}</h3>
                  <p>{w.features[key].body}</p>
                </div>
              ))}
            </div>
          </main>

          <footer className="gm-land-foot">
            <div className="nr-wrap">
              <Link href="/privacy">{w.footer.privacy}</Link>
              <Link href="/terms">{w.footer.terms}</Link>
              <Link href="/data-deletion">{w.footer.dataDeletion}</Link>
              <a href={NEWSROOM_ORIGIN}>{w.footer.newsroom}</a>
              <span>© 2026 Gituas</span>
            </div>
          </footer>
        </div>
      </LangProvider>
    </div>
  );
}
