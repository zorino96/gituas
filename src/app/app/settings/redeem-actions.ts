"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { redeemCode } from "@/lib/shop/redeem";
import { currentWorkspace } from "../data";

/** Enters a test code for the signed-in workspace. Only its owner may; the result text is in the person's language. */
export async function redeemCodeAction(raw: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const [session, ws, t] = await Promise.all([auth(), currentWorkspace(), getLang().then(dict)]);
  const m = t.settings.redeem;
  const userId = session?.user?.id;
  if (!userId || !ws) return { ok: false, error: t.nr.shell.newDesk.signInAgain };
  if (!can(ws.role, "team")) return { ok: false, error: m.ownerOnly };
  const r = await redeemCode({ tenantId: ws.id, userId, kind: ws.kind, raw: typeof raw === "string" ? raw.slice(0, 200) : "" });
  if (!r.ok) return { ok: false, error: r.error === "rate" ? m.rate : r.error === "failed" ? m.failed : m.invalid };
  revalidatePath("/app", "layout");
  revalidatePath("/newsroom", "layout");
  return { ok: true, text: r.already ? m.already : m.done };
}
