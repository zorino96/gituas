"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { isLang, LANG_COOKIE, type Lang } from "@/lib/i18n";

/** Remember the language for a year and re-render the shop (and the newsroom pages that share it). */
export async function setLangAction(lang: Lang): Promise<void> {
  if (!isLang(lang)) return;
  (await cookies()).set(LANG_COOKIE, lang, {
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/app", "layout");
  revalidatePath("/newsroom", "layout");
}
