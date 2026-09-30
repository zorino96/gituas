"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import type { Lang } from "@/lib/i18n";
import { useLang } from "@/lib/i18n/client";
import { setLangAction } from "../lang-actions";

// Each language is named in itself, so the card reads the same whichever one is on.
const OPTIONS: { lang: Lang; label: string }[] = [
  { lang: "ckb", label: "کوردی" },
  { lang: "ar", label: "العربية" },
];

/** Kurdish / Arabic switch. Sets the gm_lang cookie and re-renders the page in the new language. */
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
      <b className="kufi">زمان / اللغة</b>
      <div className="gm-chips" role="group" aria-label="زمان / اللغة" style={{ marginTop: 10 }}>
        {OPTIONS.map((o) => (
          <button key={o.lang} type="button" className="gm-chip" aria-pressed={current === o.lang} disabled={pending} onClick={() => choose(o.lang)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
