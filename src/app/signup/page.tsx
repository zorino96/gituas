import type { Metadata } from "next";
import { redirect } from "next/navigation";

import "@/app/app/app.css";
import "@/app/newsroom/newsroom.css";
import { auth, googleEnabled } from "@/auth";
import { gmFontVars } from "@/app/app/fonts";
import { safeNext } from "@/lib/safe-next";
import { SignupForm } from "./signup-form";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}): Promise<Metadata> {
  const next = safeNext((await searchParams).next, "/app");
  return { title: next.startsWith("/newsroom") ? "خۆتۆمارکردن — گیتواس نیوزڕووم" : "خۆتۆمارکردن — گیتواس" };
}

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const next = safeNext((await searchParams).next, "/app");
  if (await auth()) redirect(next);
  return (
    <div className={`gm ${next.startsWith("/newsroom") ? "nr " : ""}${gmFontVars}`} dir="rtl" lang="ckb">
      <SignupForm next={next} googleEnabled={googleEnabled} product={next.startsWith("/newsroom") ? "newsroom" : "shop"} />
    </div>
  );
}
