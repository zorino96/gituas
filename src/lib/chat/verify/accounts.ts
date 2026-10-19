// Read-back of group_accounts. After the Page and the Instagram account were put in one group, the groups are read again from the
// database (inside the workspace only, one query) and compared with what was asked: both accounts must now sit in the same group,
// and the group the moved account left must no longer hold it. A check that cannot tell returns null; a problem is only a clear
// mismatch (the two accounts are in different groups, or the old group still holds the account).

import { db } from "@/lib/db";
import type { Lang } from "@/lib/i18n/lang";
import { groupPhrase, instagramPhrase, pagePhrase } from "../tools/reads-accounts";
import { clip, say } from "../tools/writes-common";
import type { VerifyFn, VerifyReport } from "../types";

// ---------------------------------------------------------------------------------------------------------------------
// The person's words (Sorani, Arabic, English). Arabic does not use Kurdish-only letters.

const up = (lang: Lang, s: string): string => (lang === "en" ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const W = {
  together: say(
    (page: string, insta: string, group: string) => `${page} و ${insta} ئێستا لە یەک گرووپدان: ${group}.`,
    (page: string, insta: string, group: string) => `${page} و${insta} الآن في مجموعة واحدة: ${group}.`,
    (page: string, insta: string, group: string) => `${up("en", page)} and ${insta} are now in one group: ${group}.`,
  ),
  oldClear: say(
    (moved: string, group: string) => `${moved} چیتر لە ${group} نییە.`,
    (moved: string, group: string) => `${group} لم تعد تضم ${moved}.`,
    (moved: string, group: string) => `${up("en", moved)} is no longer in ${group}.`,
  ),
  notTogether: say(
    (page: string, insta: string) => `${page} و ${insta} هێشتا لە یەک گرووپدا نین.`,
    (page: string, insta: string) => `${page} و${insta} ما زالا في مجموعتين مختلفتين.`,
    (page: string, insta: string) => `${up("en", page)} and ${insta} are still not in one group.`,
  ),
  oldStill: say(
    (moved: string, group: string) => `${moved} هێشتا لە ${group} ماوە.`,
    (moved: string, group: string) => `${group} ما زالت تضم ${moved}.`,
    (moved: string, group: string) => `${up("en", moved)} is still in ${group}.`,
  ),
};

// What the model is told to do about each problem (English).
const FIX = {
  notTogether:
    "The Page and the Instagram account are not in one group. Call show_accounts to see which group holds which, then offer group_accounts again (it needs a card); if it refuses, tell the owner the reason in plain words.",
  oldStill: "The group the account was moved from still holds it. Call show_accounts to see where each account is and offer group_accounts again (it needs a card).",
};

// ---------------------------------------------------------------------------------------------------------------------
// Reading

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const labelOf = (r: { name: string; igUsername: string | null }): string => r.name.replace(/\s+/g, " ").trim() || (r.igUsername ? `@${r.igUsername}` : "");

interface Found {
  problem: string;
  fix: string;
}
const report = (checked: string[], problems: Found[]): VerifyReport | null =>
  checked.length || problems.length ? { status: problems.length ? "problem" : "ok", checked, problems: problems.map((p) => p.problem), ...(problems.length ? { fix: problems[0].fix } : {}) } : null;

const verifyGroup: VerifyFn = async (ctx, _args, done) => {
  // The ids come from what the tool itself did (it resolved the names); a name the model wrote proves nothing here. The names are the
  // real ones, cut like the card's (writes-accounts.ts): the person reads the same spelling on the card, the done sentence and here.
  const d = obj(done.data);
  const fb = str(d?.facebook);
  const ig = str(d?.instagram);
  if (!fb || !ig) return null;
  const fromId = str(d?.fromGroup);
  const moved = d?.moved === "facebook" || d?.moved === "instagram" ? d.moved : null;
  const rows = await db.store.findMany({
    where: { tenantId: ctx.tenantId, OR: [{ fbPageId: fb }, { igUserId: ig }, ...(fromId ? [{ id: fromId }] : [])] },
    take: 6,
    select: { id: true, name: true, igUsername: true, fbPageId: true, igUserId: true },
  });

  const lang = ctx.lang;
  const page = pagePhrase(lang, clip(str(d?.facebookName) ?? "", 60) || null);
  const insta = instagramPhrase(lang, clip(str(d?.instagramName) ?? "", 60) || null);
  const fbHolder = rows.find((r) => r.fbPageId === fb);
  const igHolder = rows.find((r) => r.igUserId === ig);
  const checked: string[] = [];
  const problems: Found[] = [];

  if (!fbHolder || !igHolder || fbHolder.id !== igHolder.id) {
    problems.push({ problem: W.notTogether[lang](page, insta), fix: FIX.notTogether });
  } else {
    const label = clip(labelOf(fbHolder) || (str(d?.toName) ?? ""), 60);
    checked.push(W.together[lang](page, insta, label ? groupPhrase(lang, label) : "-"));
  }

  // The group the account left must not hold it any more (nothing to say when the group is gone or the account was in no group).
  const old = fromId && moved ? rows.find((r) => r.id === fromId) : undefined;
  if (old && moved) {
    const movedPhrase = moved === "facebook" ? page : insta;
    const oldName = groupPhrase(lang, clip(labelOf(old), 60) || "-");
    if ((moved === "facebook" ? old.fbPageId : old.igUserId) === (moved === "facebook" ? fb : ig)) {
      problems.push({ problem: W.oldStill[lang](movedPhrase, oldName), fix: FIX.oldStill });
    } else if (!problems.length) {
      checked.push(W.oldClear[lang](movedPhrase, oldName));
    }
  }
  return report(checked, problems);
};

export const ACCOUNT_VERIFIERS: Record<string, VerifyFn> = {
  group_accounts: verifyGroup,
};
