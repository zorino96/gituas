"use server";

import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { cancelFacebookPageChoice, completeFacebookPageChoice } from "@/lib/oauth/flow";

/** Back to where the connect started — only ever one of our own surfaces. */
function withParam(path: string, key: string, value: string): string {
  const url = new URL(path, "https://x");
  if (url.origin !== "https://x" || !/^\/(app|newsroom|dashboard)(\/|$)/.test(url.pathname)) {
    return `/dashboard/integrations?${key}=${encodeURIComponent(value)}`;
  }
  url.searchParams.set(key, value);
  return url.pathname + url.search;
}

/** Connect the Page the person picked, then return them where the connect started. */
export async function choosePageAction(formData: FormData): Promise<void> {
  const session = await auth();
  const userId = session?.user?.id;
  const choiceId = String(formData.get("c") ?? "");
  if (!userId) redirect("/login");
  let done: { redirectTo: string } | null = null;
  try {
    done = await completeFacebookPageChoice(choiceId, String(formData.get("page") ?? ""), userId);
  } catch (err) {
    console.error("[oauth:facebook] page choice failed:", err instanceof Error ? err.message : "unknown error");
  }
  if (!done) redirect(`/connect/facebook?c=${encodeURIComponent(choiceId)}&error=1`);
  redirect(withParam(done.redirectTo, "connected", "meta_facebook"));
}

export async function cancelPageChoiceAction(formData: FormData): Promise<void> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");
  const done = await cancelFacebookPageChoice(String(formData.get("c") ?? ""), userId);
  redirect(done ? withParam(done.redirectTo, "error", "access_denied") : "/");
}
