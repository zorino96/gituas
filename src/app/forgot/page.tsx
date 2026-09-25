import type { Metadata } from "next";

import "@/app/app/app.css";
import { gmFontVars } from "@/app/app/fonts";
import { emailEnabled } from "@/lib/mailer";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "وشەی نهێنیی نوێ — گیتواس" };

function safeNext(next: string | string[] | undefined): string {
  const n = Array.isArray(next) ? next[0] : next;
  return n && n.startsWith("/") && !n.startsWith("//") && !n.includes("..") ? n : "/app";
}

export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const next = safeNext((await searchParams).next);
  return (
    <div className={`gm ${gmFontVars}`} dir="rtl" lang="ckb">
      <ForgotForm next={next} enabled={emailEnabled} />
    </div>
  );
}
