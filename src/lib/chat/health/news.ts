// The finders of a news desk for the "check everything" tool (see types.ts). Counts and our own labels only: no story, headline, feed
// address or error text is ever selected or returned. Nothing here calls Facebook or Instagram.
//
// Where each signal comes from:
//   connections   OAuthCredential (Meta tokens and their expiry), NewsSettings.autoMode / autoAccounts
//   posts         AuditLog "app.publish_failed" and "news.autopilot_publish_failed"
//   scheduled     ScheduledPost PENDING and overdue
//   autopilot     NewsSettings (autoMode, lastFetchedAt, categories) + the newest NewsDraft the autopilot wrote + NewsItem fetched in the last day
//                 ("wrote nothing" is only said when a story that the desk's own category choice lets through came in)
//   sources       NewsSource.lastError of the enabled sources (set by the last fetch, cleared by the next good one)
//   plan          Tenant trial / plan dates through newsroomAccess (the same rule that freezes the desk)
//   chat_actions  ChatRun FAILED

import { newsroomAccess } from "@/lib/billing/trial";
import { db } from "@/lib/db";
import { num } from "@/lib/i18n/num";
import { matchesChoice, normalizeChoice } from "@/lib/news/taxonomy";
import { chatActionsFinder, postsFinder, scheduledFinder } from "./shop";
import { A, ago, DAY, E, endingSoon, found, HOUR, K, metaAccounts, MIN, N, nEn, say, words, type Def, type Finder, type Finding } from "./types";

// ---------------------------------------------------------------------------------------------------------------------
// Connections

const RECONNECT = words("لە ڕێکخستن دووبارە پەیوەستی بکەرەوە.", "أعد الربط من الإعدادات.", "Reconnect it in Settings.");

const noPage: Def = {
  area: "connections",
  severity: "high",
  text: say(
    () => "هیچ پەیجێکی فەیسبووک یان ئەکاونتی ئینستاگرام پەیوەست نەکراوە، بۆیە ناتوانرێت هیچ بڵاو بکرێتەوە.",
    () => "لا توجد صفحة فيسبوك أو حساب إنستغرام مربوط، لذلك لا يمكن نشر شيء.",
    () => "No Facebook Page or Instagram account is connected, so nothing can be posted.",
  ),
  todo: words("لە ڕێکخستن پەیجەکەت پەیوەست بکە.", "اربط صفحتك من الإعدادات.", "Connect your Page in Settings."),
  fix: "Nothing is connected, so the desk cannot post. The person must connect a Facebook Page or Instagram account in Settings (/newsroom/settings); you cannot do that for them.",
};
const expiredAll: Def = {
  area: "connections",
  severity: "high",
  text: say(
    (n) => `پەیوەندیی هەموو پەیج و ئەکاونتەکان (${num(n)}) بەسەرچووە، بۆیە هیچ بڵاو ناکرێتەوە.`,
    (n) => `انتهى ربط جميع الصفحات والحسابات (${num(n)})، لذلك لا يُنشر شيء.`,
    (n) => `The connection of every Page and account (${nEn(n)}) has ended, so nothing can be posted.`,
  ),
  todo: RECONNECT,
  fix: "Every connected Page and account has an expired token. Meta tokens cannot be refreshed: the person must reconnect in Settings (/newsroom/settings); you cannot do that for them. Until then neither the autopilot nor a person can post.",
};
const fbExpired: Def = {
  area: "connections",
  severity: "high",
  text: say(
    () => "پەیوەندیی فەیسبووک بەسەرچووە، بۆیە لە فەیسبووک هیچ بڵاو ناکرێتەوە.",
    () => "انتهى ربط فيسبوك، لذلك لا يُنشر شيء على فيسبوك.",
    () => "The Facebook connection has ended, so nothing is posted to Facebook.",
  ),
  todo: RECONNECT,
  fix: "The Facebook Page connection has expired. The person must reconnect it in Settings (/newsroom/settings); you cannot do that for them.",
};
const igExpired: Def = {
  area: "connections",
  severity: "high",
  text: say(
    () => "پەیوەندیی ئینستاگرام بەسەرچووە، بۆیە لە ئینستاگرام هیچ بڵاو ناکرێتەوە.",
    () => "انتهى ربط إنستغرام، لذلك لا يُنشر شيء على إنستغرام.",
    () => "The Instagram connection has ended, so nothing is posted to Instagram.",
  ),
  todo: RECONNECT,
  fix: "The Instagram connection has expired. The person must reconnect it in Settings (/newsroom/settings); you cannot do that for them.",
};
const chosenExpired: Def = {
  area: "connections",
  severity: "high",
  text: say(
    (n) => `پەیوەندیی ${K(n, N.account)} لەوانەی ئۆتۆپایلۆت پۆستیان تێدا دەکات بەسەرچووە.`,
    (n) => `انتهى ربط ${A(n, N.account, true)} من الحسابات التي ينشر عليها الطيار الآلي.`,
    (n) => `The connection of ${E(n, N.account)} the autopilot posts to has ended.`,
  ),
  todo: RECONNECT,
  fix: "A Page or account the autopilot is set to post to has an expired connection. The person must reconnect it in Settings (/newsroom/settings); you cannot do that for them.",
};
const someExpired: Def = {
  area: "connections",
  severity: "medium",
  text: say(
    (n) => `پەیوەندیی ${K(n, N.account)} بەسەرچووە، بەڵام ئەوانی تر کار دەکەن.`,
    (n) => `انتهى ربط ${A(n, N.account, true)}، لكن بقية الحسابات تعمل.`,
    (n) => `The connection of ${E(n, N.account)} has ended, but the others still work.`,
  ),
  todo: RECONNECT,
  fix: "Some connected accounts have an expired token while others work. If the person still wants them, they must reconnect them in Settings (/newsroom/settings); you cannot do that for them.",
};
const expiring: Def = {
  area: "connections",
  severity: "medium",
  text: say(
    (n) => `پەیوەندیی ${K(n, N.fbPage)} لە ماوەی هەفتەیەکدا بەسەر دەچێت.`,
    (n) => `سينتهي ربط ${A(n, N.fbPage, true)} خلال أسبوع.`,
    (n) => `The connection of ${E(n, N.fbPage)} ends within a week.`,
  ),
  todo: words("پێش ئەوەی تەواو ببێت دووبارە پەیوەستی بکەرەوە.", "أعد الربط قبل أن ينتهي.", "Reconnect it before it ends."),
  fix: "A Facebook Page connection ends within 7 days. The person must reconnect it in Settings (/newsroom/settings) before then; you cannot do that for them.",
};

/** The accounts the autopilot posts to, as stored: "FB:<id>" and "IG:<id>". */
function chosenKeys(stored: readonly string[]): string[] {
  const out: string[] = [];
  for (const s of stored) {
    const at = s.indexOf(":");
    if (at < 1) continue;
    const kind = s.slice(0, at);
    const id = s.slice(at + 1);
    if (id && (kind === "FB" || kind === "IG")) out.push(`${kind === "FB" ? "META_FACEBOOK" : "META_INSTAGRAM"}:${id}`);
  }
  return out;
}

export const connectionsFinder: Finder = {
  area: "connections",
  async run(c) {
    const [creds, settings] = await Promise.all([
      db.oAuthCredential.findMany({
        where: { tenantId: c.tenantId, provider: { in: ["META_FACEBOOK", "META_INSTAGRAM"] } },
        select: { provider: true, providerAccountId: true, expiresAt: true },
        orderBy: { updatedAt: "desc" },
        take: 60,
      }),
      db.newsSettings.findUnique({ where: { tenantId: c.tenantId }, select: { autoMode: true, autoAccounts: true } }),
    ]);
    const accounts = metaAccounts(creds, c.now);
    const all = [...accounts.values()];
    const href = `${c.base}/settings`;
    const out: Finding[] = [];
    if (!all.length) return [found(c, noPage, 0, href)];
    if (!all.some((a) => a.live)) return [found(c, expiredAll, all.length, href)];

    const fb = all.filter((a) => a.provider === "META_FACEBOOK");
    const ig = all.filter((a) => a.provider === "META_INSTAGRAM");
    const fbDead = fb.length > 0 && !fb.some((a) => a.live);
    const igDead = ig.length > 0 && !ig.some((a) => a.live);
    if (fbDead) out.push(found(c, fbExpired, fb.length, href));
    if (igDead) out.push(found(c, igExpired, ig.length, href));
    if (!fbDead && !igDead) {
      const chosenDead = settings?.autoMode === "PUBLISH" ? chosenKeys(settings.autoAccounts).filter((k) => accounts.get(k)?.live !== true).length : 0;
      const dead = all.filter((a) => !a.live).length;
      if (chosenDead) out.push(found(c, chosenExpired, chosenDead, href));
      else if (dead) out.push(found(c, someExpired, dead, href));
    }
    const soon = endingSoon(all, c.now, 7 * DAY).length;
    if (soon) out.push(found(c, expiring, soon, href));
    return out;
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// The desk's plan and trial

const frozen: Def = {
  area: "plan",
  severity: "high",
  text: say(
    () => "ماوەی تاقیکردنەوە یان پلانەکەت تەواو بووە، بۆیە تەنها دەتوانیت ببینیت: هیچ نانووسرێت و بڵاو ناکرێتەوە.",
    () => "انتهت التجربة أو خطتك، لذلك يمكنك القراءة فقط: لا يُكتب ولا يُنشر شيء.",
    () => "Your trial or plan has ended, so the desk can only read: nothing is written or posted.",
  ),
  todo: words("پلانێک هەڵبژێرە لە «پلان و پارەدان».", "اختر خطة من «الخطة والدفع».", "Choose a plan in Billing."),
  fix: "The trial or paid plan has ended, so the desk is frozen (read only): drafting, publishing, scheduling and the autopilot are all refused. A plan is bought on the Billing screen (/newsroom/billing); the person must pay there. Do not offer any change until then.",
};
const trialEnding: Def = {
  area: "plan",
  severity: "medium",
  text: say(
    (n) => `${K(n, N.day)} ماوە لە تاقیکردنەوەی بەخۆڕایی.`,
    (n) => `تنتهي التجربة المجانية بعد ${A(n, N.day, true)}.`,
    (n) => `The free trial ends in ${E(n, N.day)}.`,
  ),
  todo: words("پێش تەواوبوون پلانێک هەڵبژێرە.", "اختر خطة قبل أن تنتهي.", "Choose a plan before it ends."),
  fix: "The free trial ends within 3 days; after that the desk is frozen (read only). A plan is bought on the Billing screen (/newsroom/billing); the person must pay there.",
};
const planEnding: Def = {
  area: "plan",
  severity: "medium",
  text: say(
    (n) => `${K(n, N.day)} ماوە لە پلانی پارەدراو.`,
    (n) => `تنتهي الخطة المدفوعة بعد ${A(n, N.day, true)}.`,
    (n) => `The paid plan ends in ${E(n, N.day)}.`,
  ),
  todo: words("پێش تەواوبوون نوێی بکەرەوە.", "جدّدها قبل أن تنتهي.", "Renew it before it ends."),
  fix: "The paid plan ends within 3 days; after that the desk is frozen (read only). Renewing is on the Billing screen (/newsroom/billing); the person must pay there.",
};

const TENANT = { kind: true, plan: true, planPaidUntil: true, trialEndsAt: true } as const;

export const planFinder: Finder = {
  area: "plan",
  async run(c) {
    const t = await db.tenant.findUnique({ where: { id: c.tenantId }, select: TENANT });
    if (!t || t.kind !== "NEWS") return [];
    const access = newsroomAccess(t, c.now);
    const href = `${c.base}/billing`;
    if (!access.active) return [found(c, frozen, 0, href)];
    if (access.reason === "trial" && access.daysLeft !== null && access.daysLeft <= 3) return [found(c, trialEnding, access.daysLeft, href)];
    if (access.reason === "paid" && t.planPaidUntil) {
      const left = Math.ceil((t.planPaidUntil.getTime() - c.now.getTime()) / DAY);
      if (left <= 3) return [found(c, planEnding, Math.max(1, left), href)];
    }
    return [];
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// The autopilot

const STALE_FETCH = 6 * HOUR;

const neverFetched: Def = {
  area: "autopilot",
  severity: "medium",
  text: say(
    () => "ئۆتۆپایلۆت چالاکە، بەڵام هێشتا هیچ هەواڵێک وەرنەگیراوە.",
    () => "الطيار الآلي يعمل، لكن لم تُجلب أي أخبار بعد.",
    () => "The autopilot is on, but no stories have been fetched yet.",
  ),
  todo: words("هەواڵەکان نوێ بکەرەوە و سەرچاوەکان بپشکنە.", "حدّث الأخبار وافحص المصادر.", "Refresh the news and check the sources."),
  fix: "The autopilot is on but the desk has not fetched any story for a while (NewsSettings.lastFetchedAt is empty and no story arrived in a day). Offer refresh_news; if nothing arrives, check the sources finding and tell the person to contact support if it persists.",
};
const staleFetch: Def = {
  area: "autopilot",
  severity: "medium",
  text: say(
    (n) => `ئۆتۆپایلۆت چالاکە، بەڵام ${num(n)} کاتژمێرە هەواڵی نوێ وەرنەگیراوە.`,
    (n) => `الطيار الآلي يعمل، لكن لم تُجلب أخبار جديدة منذ ${A(n, N.hour, true)}.`,
    (n) => `The autopilot is on, but no new stories have been fetched for ${E(n, N.hour)}.`,
  ),
  todo: words("هەواڵەکان نوێ بکەرەوە و سەرچاوەکان بپشکنە.", "حدّث الأخبار وافحص المصادر.", "Refresh the news and check the sources."),
  fix: "The autopilot is on but the desk's news have not been refreshed for hours (NewsSettings.lastFetchedAt); the background clock may be stalled. Offer refresh_news; if nothing changes, tell the person to contact support.",
};
const noStories: Def = {
  area: "autopilot",
  severity: "medium",
  text: say(
    () => "ئۆتۆپایلۆت چالاکە، بەڵام لە ٢٤ کاتژمێری ڕابردوودا هیچ هەواڵێکی نوێ نەهات.",
    () => "الطيار الآلي يعمل، لكن لم يصل أي خبر جديد خلال آخر ٢٤ ساعة.",
    () => "The autopilot is on, but no new story arrived in the last 24 hours.",
  ),
  todo: words("سەرچاوەکان و وشە سەرەکییەکان بپشکنە.", "افحص المصادر والكلمات المفتاحية.", "Check the sources and the keywords."),
  fix: "No story was fetched in 24 hours while the autopilot is on. Check the sources finding, then the keywords and the news filter with get_desk_settings; offer refresh_news.",
};
const silent: Def = {
  area: "autopilot",
  severity: "medium",
  text: say(
    (n) => `ئۆتۆپایلۆت چالاکە و ${K(n, N.story)} هات، بەڵام لە ٢٤ کاتژمێری ڕابردوودا هیچ ڕەشنووسێکی نەنووسیوە.`,
    (n) => `الطيار الآلي يعمل ووصل ${A(n, N.story)}، لكنه لم يكتب أي مسودة خلال آخر ٢٤ ساعة.`,
    (n) => `The autopilot is on and ${E(n, N.story)} came in, but it has written no draft in the last 24 hours.`,
  ),
  todo: words("سنووری مانگانە، کاتی بێدەنگی و فلتەری هەواڵ بپشکنە.", "افحص الحد الشهري وساعات الهدوء وفلتر الأخبار.", "Check the monthly limit, the quiet hours and the news filter."),
  fix: "The autopilot is on and stories that match the desk's own category choice came in (still unused), but it wrote no draft in 24 hours. Possible causes: the plan's monthly drafts are used up (get_desk_usage), quiet hours or the daily maximum (get_desk_settings), the news filter hiding everything, or a stalled clock. Check these before suggesting any change; do not switch settings on your own.",
};

/** Saving the keywords clears lastFetchedAt, and the clock fetches again within minutes: only a gap that lasts is "never fetched". */
const FETCH_GRACE = 10 * MIN;
/** The most stories read to see whether any of them could have been drafted. */
const ELIGIBLE_ROWS = 300;

export const autopilotFinder: Finder = {
  area: "autopilot",
  async run(c) {
    const [tenant, settings, last, items] = await Promise.all([
      db.tenant.findUnique({ where: { id: c.tenantId }, select: TENANT }),
      db.newsSettings.findUnique({ where: { tenantId: c.tenantId }, select: { autoMode: true, lastFetchedAt: true, updatedAt: true, categories: true, filterMode: true } }),
      db.newsDraft.findFirst({ where: { tenantId: c.tenantId, auto: true }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      db.newsItem.count({ where: { tenantId: c.tenantId, createdAt: { gt: ago(c, DAY) } } }),
    ]);
    // Off, or frozen (the plan finder says so): the autopilot is not expected to do anything.
    if (!settings || settings.autoMode === "OFF" || !tenant || tenant.kind !== "NEWS" || !newsroomAccess(tenant, c.now).active) return [];
    const href = `${c.base}/autopilot`;
    if (!settings.lastFetchedAt) {
      // Stories came in, or the keywords were only just saved: it was fetched (or will be in a minute), not "never".
      if (items > 0 || c.now.getTime() - settings.updatedAt.getTime() < FETCH_GRACE) return [];
      return [found(c, neverFetched, 0, href)];
    }
    const sinceFetch = c.now.getTime() - settings.lastFetchedAt.getTime();
    if (sinceFetch > STALE_FETCH) return [found(c, staleFetch, Math.floor(sinceFetch / HOUR), href)];
    if (items === 0) return [found(c, noStories, 0, href)];
    if (!last || c.now.getTime() - last.createdAt.getTime() > DAY) {
      // Stories came in, but the desk's own choice (its categories, its news prompt) may keep every one of them from the autopilot, and
      // then it is right to write nothing. Only a story that the choice lets through makes silence a finding.
      const chosen = normalizeChoice(settings.categories);
      if (settings.categories.length && !chosen.length) return [];
      const fresh = await db.newsItem.findMany({
        where: {
          tenantId: c.tenantId,
          status: "NEW",
          category: { not: null },
          createdAt: { gt: ago(c, DAY) },
          ...(settings.filterMode === "PROMPT" ? { focusMatch: true } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: ELIGIBLE_ROWS,
        select: { category: true, subcategory: true },
      });
      const eligible = fresh.filter((i) => matchesChoice(i.category, i.subcategory, chosen)).length;
      if (eligible > 0) return [found(c, silent, eligible, href)];
    }
    return [];
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// News sources

const noSources: Def = {
  area: "sources",
  severity: "medium",
  text: say(
    () => "هیچ سەرچاوەیەکی هەواڵ چالاک نییە، بۆیە هەواڵی نوێ نایەت.",
    () => "لا يوجد أي مصدر أخبار مفعّل، لذلك لن تصل أخبار جديدة.",
    () => "No news source is switched on, so no new stories will come.",
  ),
  todo: words("سەرچاوەیەک زیاد بکە یان بیکەرەوە.", "أضف مصدراً أو فعّله.", "Add a source or switch one on."),
  fix: "No news source is enabled. Offer add_news_feed or toggle_news_source (each needs a card).",
};
const allFail: Def = {
  area: "sources",
  severity: "medium",
  text: say(
    (n) => `هەموو سەرچاوەکانی هەواڵ (${num(n)}) لە دوایین پشکنیندا سەرنەکەوتن، بۆیە هەواڵی نوێ نایەت.`,
    (n) => `فشلت جميع مصادر الأخبار (${num(n)}) في آخر فحص، لذلك لا تصل أخبار جديدة.`,
    (n) => `All news sources (${nEn(n)}) failed on the last check, so no new stories are arriving.`,
  ),
  todo: words("ناونیشانی سەرچاوەکان بپشکنە یان سەرچاوەیەکی نوێ زیاد بکە.", "افحص عناوين المصادر أو أضف مصدراً جديداً.", "Check the source addresses or add a new source."),
  fix: "Every enabled source failed its last fetch (NewsSource.lastError; the error text is not read here). Offer refresh_news to try again; if it fails again, offer toggle_news_source or remove_news_feed / add_news_feed (each needs a card) and check the addresses with the person.",
};
const someFail: Def = {
  area: "sources",
  severity: "info",
  text: say(
    (n) => `${K(n, N.source)} لە دوایین پشکنیندا سەرنەکەوت.`,
    (n) => `تعذّر الوصول إلى ${A(n, N.source, true)} في آخر فحص.`,
    (n) => `${E(n, N.source)} failed on the last check.`,
  ),
  todo: words("ئەگەر دووبارە بوویەوە، سەرچاوەکە بسڕەوە یان بیکوژێنەرەوە.", "إن تكرر ذلك فاحذف المصدر أو أوقفه.", "If it keeps failing, remove that source or switch it off."),
  fix: "Some sources failed their last fetch (NewsSource.lastError; the error text is not read here) while others work. Mention it; offer toggle_news_source or remove_news_feed only if it keeps failing (each needs a card).",
};

export const sourcesFinder: Finder = {
  area: "sources",
  async run(c) {
    const rows = await db.newsSource.findMany({ where: { tenantId: c.tenantId, enabled: true }, select: { lastError: true }, take: 100 });
    const href = `${c.base}/sources`;
    if (!rows.length) return [found(c, noSources, 0, href)];
    const failing = rows.filter((r) => !!r.lastError).length;
    if (failing === rows.length) return [found(c, allFail, failing, href)];
    return failing ? [found(c, someFail, failing, href)] : [];
  },
};

// ---------------------------------------------------------------------------------------------------------------------

/** The finders of a news desk, in the order their findings are listed within one severity. */
export function newsFinders(): Finder[] {
  return [connectionsFinder, planFinder, postsFinder(["app.publish_failed", "news.autopilot_publish_failed"]), scheduledFinder, autopilotFinder, sourcesFinder, chatActionsFinder];
}
