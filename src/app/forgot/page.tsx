import type { Metadata } from "next";

import "@/app/app/app.css";
import { gmFontVars } from "@/app/app/fonts";
import { emailEnabled } from "@/lib/mailer";
import { safeNext } from "@/lib/safe-next";
import { ForgotForm } from "./forgot-form";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}): Promise<Metadata> {
  const next = safeNext((await searchParams).next, "/app");
  return { title: next.startsWith("/newsroom") ? "وشەی نهێنیی نوێ — گیتواس نیوزڕووم" : "وشەی نهێنیی نوێ — گیتواس" };
}

export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const next = safeNext((await searchParams).next, "/app");
  return (
    <div className={`gm ${gmFontVars}`} dir="rtl" lang="ckb">
      <ForgotForm next={next} enabled={emailEnabled} product={next.startsWith("/newsroom") ? "newsroom" : "shop"} />
    </div>
  );
}
