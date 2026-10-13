import Link from "next/link";

import "@/app/(site)/site.css";
import { gmFontVars } from "@/app/app/fonts";
import { dirOf } from "@/lib/i18n/lang";
import { NEWSROOM_ORIGIN } from "@/lib/hosts";
import { CHROME } from "@/lib/site/chrome";
import { DOC_LANG, SITE_TO_LANG, sitePath, type SiteLang } from "@/lib/site/langs";
import { LangLinks } from "./lang-links";

/** The frame of every public page: header with the language links, the page, a footer with the legal links. */
export function SiteFrame({ lang, children }: { lang: SiteLang; children: React.ReactNode }) {
  const c = CHROME[lang];
  const home = sitePath(lang);

  return (
    <div className={`site ${gmFontVars}`} dir={dirOf(SITE_TO_LANG[lang])} lang={DOC_LANG[lang]} data-lang={lang}>
      <a className="site-skip" href="#main">
        {c.nav.skip}
      </a>
      <header className="site-head">
        <div className="site-wrap site-head-row">
          <Link href={home} className="site-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/gituas-mark-68.png" alt="" width={34} height={34} />
            <span>{c.brand}</span>
          </Link>
          <nav className="site-nav" aria-label="Main">
            <Link href={`${home}#features`}>{c.nav.features}</Link>
            <Link href={sitePath(lang, "/guides")}>{c.nav.guides}</Link>
            <Link href={sitePath(lang, "/pricing")}>{c.nav.pricing}</Link>
          </nav>
          <LangLinks current={lang} />
          <div className="site-head-cta">
            <Link href="/login?next=/app" className="site-btn quiet" prefetch={false}>
              {c.nav.signIn}
            </Link>
            <Link href="/signup?next=/app" className="site-btn" prefetch={false}>
              {c.nav.start}
            </Link>
          </div>
        </div>
      </header>

      <main id="main">{children}</main>

      <footer className="site-foot">
        <div className="site-wrap site-foot-grid">
          <div>
            <p className="site-foot-brand">{c.brand}</p>
            <p className="site-foot-note">{c.footer.tagline}</p>
          </div>
          <nav aria-label={c.footer.product}>
            <p className="site-foot-h">{c.footer.product}</p>
            <Link href={`${home}#features`}>{c.nav.features}</Link>
            <Link href={sitePath(lang, "/guides")}>{c.nav.guides}</Link>
            <Link href={sitePath(lang, "/pricing")}>{c.nav.pricing}</Link>
            <Link href={sitePath(lang, "/about")}>{c.nav.about}</Link>
            <a href={NEWSROOM_ORIGIN}>{c.footer.newsroom}</a>
          </nav>
          <nav aria-label={c.footer.legal}>
            <p className="site-foot-h">{c.footer.legal}</p>
            <Link href="/privacy">{c.footer.privacy}</Link>
            <Link href="/terms">{c.footer.terms}</Link>
            <Link href="/data-deletion">{c.footer.dataDeletion}</Link>
          </nav>
        </div>
        <p className="site-wrap site-copy">© 2026 {c.footer.rights}</p>
      </footer>
    </div>
  );
}
