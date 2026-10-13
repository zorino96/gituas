/**
 * The UI language of the shop and the newsroom: Sorani Kurdish ("ckb", the default), Arabic ("ar")
 * or English ("en"). English is laid out left to right: wrappers take `dir={dirOf(lang)}`.
 *
 *   Server component / action:   const t = dict(await getLang());     t.home.title
 *   Client component:            const t = useT();                    (import from "@/lib/i18n/client")
 *   Current language code:       useLang()  (client)  or  await getLang()  (server)
 *   Switch language:             setLangAction("ar")  (src/app/app/lang-actions.ts) — sets the
 *                                gm_lang cookie for a year and refreshes the layout.
 *
 * The dictionaries are plain objects in ckb.ts and ar.ts with identical keys, grouped by screen
 * (`t.nav.today`, `t.comments.empty`). Text with a variable is a function: `t.time.minutes(5)`.
 * To add text: add the key to ckb.ts AND ar.ts (ar is typed `Dict`, so tsc rejects a missing
 * key; tests/i18n also checks every value is non-empty and the Arabic has no Kurdish-only letters).
 *
 * Helpers that format text outside React (ago, kuDate, friendlyError in app/format.ts) take the
 * dictionary as an optional last argument and default to Sorani.
 *
 * The newsroom follows the same cookie: its own screens take their text from `t.nr.*` (one file
 * per area in ./nr/), and the shop pages it re-exports (comments, messages, publish, insights,
 * settings) are wrapped in the newsroom shell's LangProvider. News content itself (drafts, cards,
 * captions) stays in the desk's language, Sorani, whatever the UI language.
 *
 * This file imports next/headers, so client components must import from "./client", not here
 * (type-only imports from here are fine).
 */
import { cookies, headers } from "next/headers";

import { ar } from "./ar";
import { ckb, type Dict } from "./ckb";
import { detectLang } from "./detect";
import { en } from "./en";
import type { Lang } from "./lang";

export { dirOf, LANGS, type Lang } from "./lang";
export type { Dict };

export const LANG_COOKIE = "gm_lang";
export const DEFAULT_LANG: Lang = "ckb";

export function isLang(v: unknown): v is Lang {
  return v === "ckb" || v === "ar" || v === "en";
}

/** The dictionary for a language. */
export function dict(lang: Lang): Dict {
  return lang === "ar" ? ar : lang === "en" ? en : ckb;
}

/**
 * The language of this request, server only: the gm_lang cookie when the visitor chose one, else the browser's
 * Accept-Language and country (English for the world, Sorani at home in Iraq; rules in ./detect.ts).
 */
export async function getLang(): Promise<Lang> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  if (isLang(v)) return v;
  try {
    const h = await headers();
    return detectLang({ acceptLanguage: h.get("accept-language"), country: h.get("x-vercel-ip-country") });
  } catch {
    return DEFAULT_LANG;
  }
}
