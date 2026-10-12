"use server";

import { db } from "@/lib/db";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { withAccounts } from "@/lib/oauth/account-scope";
import { analyzePost } from "@/lib/boost/analyze";
import { dailyAllowance, postKey, readBoostCache, REANALYSE_MS, withAnalysis, writeBoostCache, type SavedAnalysis } from "@/lib/boost/cache";
import { accountChoiceFrom, currentWorkspace } from "../data";

/**
 * Analyse one of the shop's own published posts for boosting. A post analysed in the last few
 * hours comes back from the saved copy (free); otherwise it counts against the day's allowance.
 * `fb` / `ig` are the account the page is showing (the account switcher), checked server-side.
 */
export async function analyzePostAction(input: { platform: "FB" | "IG"; postId: string; fb?: string; ig?: string; force?: boolean }): Promise<
  { ok: true; key: string; analysis: SavedAnalysis; left: number; cached: boolean } | { ok: false; error: string }
> {
  const [ws, t] = await Promise.all([currentWorkspace(), getLang().then(dict)]);
  const b = t.boost;
  if (!ws) return { ok: false, error: t.actions.common.signIn };
  if (ws.kind !== "MERCHANT") return { ok: false, error: b.shopOnly };
  if (!can(ws.role, "engage")) return { ok: false, error: t.nr.team.roles.notAllowed };
  const platform = input?.platform === "IG" ? "IG" : input?.platform === "FB" ? "FB" : null;
  const postId = String(input?.postId ?? "");
  if (!platform || !/^[\d_]{3,60}$/.test(postId)) return { ok: false, error: b.notFound };

  const key = postKey(platform, postId);
  const [cache, allowance] = await Promise.all([readBoostCache(ws.id), dailyAllowance(ws.id)]);
  const saved = cache.posts[key];
  if (saved && !input.force && Date.now() - new Date(saved.at).getTime() < REANALYSE_MS) {
    return { ok: true, key, analysis: saved, left: Math.max(0, allowance - cache.used), cached: true };
  }
  if (cache.used >= allowance) return { ok: false, error: b.limit };

  const { choice } = await accountChoiceFrom(ws.id, { fb: input.fb, ig: input.ig });
  const r = await withAccounts(choice, () => analyzePost(ws.id, platform, postId));
  if (!r.ok) return { ok: false, error: r.error === "not_found" ? b.notFound : b.failed };
  // Read again just before writing: another analysis may have finished meanwhile.
  const next = withAnalysis(await readBoostCache(ws.id), key, r.analysis);
  await writeBoostCache(ws.id, next);
  return { ok: true, key, analysis: r.analysis, left: Math.max(0, allowance - next.used), cached: false };
}

/**
 * Put the connected Instagram account in another business (store) of this workspace: the one whose
 * Page is chosen. Accounts join a store when they are connected, and with several Pages the first
 * guess can be the wrong business. The account's history stays where it was.
 */
export async function moveInstagramAction(input: { storeId: string; igUserId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const [ws, t] = await Promise.all([currentWorkspace(), getLang().then(dict)]);
  const b = t.boost;
  if (!ws) return { ok: false, error: t.actions.common.signIn };
  if (ws.kind !== "MERCHANT") return { ok: false, error: b.shopOnly };
  if (!can(ws.role, "configure")) return { ok: false, error: t.nr.team.roles.notAllowed };
  const igUserId = String(input?.igUserId ?? "");
  const [target, cred] = await Promise.all([
    db.store.findFirst({ where: { id: String(input?.storeId ?? ""), tenantId: ws.id }, select: { id: true, igUserId: true } }),
    db.oAuthCredential.findFirst({ where: { tenantId: ws.id, provider: "META_INSTAGRAM", providerAccountId: igUserId }, select: { providerAccountName: true } }),
  ]);
  if (!target || !cred) return { ok: false, error: b.moveFailed };
  if (target.igUserId === igUserId) return { ok: true };
  if (target.igUserId) return { ok: false, error: b.moveTaken };
  await db.$transaction([
    db.store.updateMany({ where: { tenantId: ws.id, igUserId }, data: { igUserId: null } }),
    db.store.update({ where: { id: target.id }, data: { igUserId, igUsername: (cred.providerAccountName ?? "").replace(/^@/, "") || null } }),
  ]);
  await db.auditLog.create({
    data: { tenantId: ws.id, actor: "USER", action: "store.instagram_moved", reasoning: `Moved Instagram ${cred.providerAccountName ?? igUserId} to another business.`, metadata: { igUserId, storeId: target.id } },
  });
  return { ok: true };
}
