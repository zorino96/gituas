"use server";

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
