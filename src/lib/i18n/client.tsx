"use client";

import { createContext, useContext, useMemo } from "react";

import { ar } from "./ar";
import { ckb, type Dict } from "./ckb";
import { en } from "./en";
import { dirOf, type Lang } from "./lang";

interface Value {
  lang: Lang;
  t: Dict;
}

// Without a provider (a route that never mounted one) the UI falls back to Sorani instead of crashing.
const Ctx = createContext<Value>({ lang: "ckb", t: ckb });

/**
 * Gives client components the dictionary. It takes the language code, not the dictionary:
 * a dictionary holds functions, which cannot cross from a server component to a client one.
 */
export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  const value = useMemo<Value>(() => ({ lang, t: lang === "ar" ? ar : lang === "en" ? en : ckb }), [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The dictionary for the current language. */
export function useT(): Dict {
  return useContext(Ctx).t;
}

/** The current language code. */
export function useLang(): Lang {
  return useContext(Ctx).lang;
}

/** "ltr" for English, "rtl" for Sorani and Arabic. */
export function useDir(): "ltr" | "rtl" {
  return dirOf(useContext(Ctx).lang);
}
