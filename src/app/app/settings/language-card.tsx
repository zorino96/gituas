"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { useLang } from "@/lib/i18n/client";
import { LANGS, type Lang } from "@/lib/i18n/lang";
import { setLangAction } from "../lang-actions";

// Each language is named in itself (LANGS), so the card reads the same whichever one is on.

/** Kurdish / Arabic / English switch. Sets the gm_lang cookie and re-renders the page in the new language. */
export function LanguageCard() {
  const current = useLang();
  const router = useRouter();
  const [pending, start] = useTransition();

  function choose(lang: Lang) {
    if (lang === current) return;
    start(async () => {
      await setLangAction(lang);
      router.refresh();
    });
  }

  return (
    <div className="gm-card" style={{ marginBottom: 14 }}>
      <b className="kufi">زمان / اللغة / Language</b>
      <div className="gm-chips" role="group" aria-label="زمان / اللغة / Language" style={{ marginTop: 10 }}>
        {LANGS.map((o) => (
          <button key={o.lang} type="button" className="gm-chip" aria-pressed={current === o.lang} disabled={pending} onClick={() => choose(o.lang)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
