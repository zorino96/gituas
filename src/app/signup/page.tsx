import type { Metadata } from "next";
import { redirect } from "next/navigation";

import "@/app/app/app.css";
import { auth, googleEnabled } from "@/auth";
import { gmFontVars } from "@/app/app/fonts";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "خۆتۆمارکردن — گیتواس" };

function safeNext(next: string | string[] | undefined): string {
  const n = Array.isArray(next) ? next[0] : next;
  return n && n.startsWith("/") && !n.startsWith("//") && !n.includes("..") ? n : "/app";
}

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const next = safeNext((await searchParams).next);
  if (await auth()) redirect(next);
  return (
    <div className={`gm ${gmFontVars}`} dir="rtl" lang="ckb">
      <SignupForm next={next} googleEnabled={googleEnabled} />
    </div>
  );
}
