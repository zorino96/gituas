"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { SITE_LANG_NAMES, SITE_LANGS, SITE_TO_LANG, HREFLANG, type SiteLang } from "@/lib/site/langs";

const COOKIE = "gm_lang";

function remember(lang: SiteLang, overwrite: boolean) {
  try {
    if (!overwrite && document.cookie.split("; ").some((c) => c.startsWith(`${COOKIE}=`))) return;
    document.cookie = `${COOKIE}=${SITE_TO_LANG[lang]}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
  } catch {
    /* cookies off: the page still works */
  }
}

/** The same page in each language, as real links (search engines follow them); a click also saves the choice for the app. */
export function LangLinks({ current }: { current: SiteLang }) {
  const path = usePathname() || `/${current}`;
  // /welcome is "/" in disguise (the visitor's own language): its links go to the home page of each language.
  const rest = path.replace(/^\/(en|ku|ar|welcome)(?=\/|$)/, "");
  // A language the visitor reads a page in is the language the app should open in (unless they chose another).
  useEffect(() => remember(current, false), [current]);
  return (
    <nav className="site-langs" aria-label="Language">
      {SITE_LANGS.map((l) => (
        <Link key={l} href={`/${l}${rest}`} hrefLang={HREFLANG[l]} lang={HREFLANG[l]} aria-current={l === current ? "true" : undefined} onClick={() => remember(l, true)}>
          {SITE_LANG_NAMES[l]}
        </Link>
      ))}
    </nav>
  );
}
