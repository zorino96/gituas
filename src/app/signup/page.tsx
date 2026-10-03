import type { Metadata } from "next";
import { redirect } from "next/navigation";

import "@/app/app/app.css";
import "@/app/newsroom/newsroom.css";
import { auth, googleEnabled } from "@/auth";
import { gmFontVars } from "@/app/app/fonts";
import { dict, dirOf, getLang } from "@/lib/i18n";
import { LangProvider } from "@/lib/i18n/client";
import { LangSwitch } from "@/app/app/lang-switch";
import { safeNext } from "@/lib/safe-next";
import { SignupForm } from "./signup-form";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}): Promise<Metadata> {
  const next = safeNext((await searchParams).next, "/app");
  const t = dict(await getLang());
  return { title: `${t.auth.signup.pageTitle} — ${next.startsWith("/newsroom") ? t.nr.shell.name : t.brand}` };
}

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const next = safeNext((await searchParams).next, "/app");
  if (await auth()) redirect(next);
  const lang = await getLang();
  return (
    <div className={`gm ${next.startsWith("/newsroom") ? "nr " : ""}${gmFontVars}`} dir={dirOf(lang)} lang={lang}>
      <LangProvider lang={lang}>
        <LangSwitch />
        <SignupForm next={next} googleEnabled={googleEnabled} product={next.startsWith("/newsroom") ? "newsroom" : "shop"} />
      </LangProvider>
    </div>
  );
}
