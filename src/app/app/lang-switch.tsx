"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { useLang } from "@/lib/i18n/client";
import { LANGS } from "@/lib/i18n/lang";
import { setLangAction } from "./lang-actions";

/** Kurdish / Arabic / English, for the pages people see before they sign in. */
export function LangSwitch() {
  const current = useLang();
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <nav className="gm-langs" aria-label="Language">
      {LANGS.map((o) => (
        <button
          key={o.lang}
          type="button"
          className="gm-chip"
          aria-pressed={current === o.lang}
          disabled={pending}
          onClick={() => {
            if (o.lang === current) return;
            start(async () => {
              await setLangAction(o.lang);
              router.refresh();
            });
          }}
        >
          {o.label}
        </button>
      ))}
    </nav>
  );
}
