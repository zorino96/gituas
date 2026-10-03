import type { Metadata } from "next";

import "@/app/app/app.css";
import "@/app/newsroom/newsroom.css";
import { gmFontVars } from "@/app/app/fonts";
import { dict, dirOf, getLang } from "@/lib/i18n";
import { LangProvider } from "@/lib/i18n/client";
import { LangSwitch } from "@/app/app/lang-switch";
import { emailEnabled } from "@/lib/mailer";
import { safeNext } from "@/lib/safe-next";
import { ForgotForm } from "./forgot-form";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}): Promise<Metadata> {
  const next = safeNext((await searchParams).next, "/app");
  const t = dict(await getLang());
  return { title: `${t.auth.forgot.pageTitle} — ${next.startsWith("/newsroom") ? t.nr.shell.name : t.brand}` };
}

export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const next = safeNext((await searchParams).next, "/app");
  const lang = await getLang();
  return (
    <div className={`gm ${next.startsWith("/newsroom") ? "nr " : ""}${gmFontVars}`} dir={dirOf(lang)} lang={lang}>
      <LangProvider lang={lang}>
        <LangSwitch />
        <ForgotForm next={next} enabled={emailEnabled} product={next.startsWith("/newsroom") ? "newsroom" : "shop"} />
      </LangProvider>
    </div>
  );
}
