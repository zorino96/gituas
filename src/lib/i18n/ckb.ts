import { num } from "./num";

/**
 * The Sorani dictionary — the source of truth for keys. `ar.ts` must have exactly the same keys
 * (it is typed `Dict = typeof ckb`, and tests/i18n checks the key sets and that nothing is empty).
 *
 * Keys are grouped by screen: `nav.today`, `comments.empty`. Text with a variable is a function
 * of plain numbers or strings: `(n: number) => string`. Keep the parameters to numbers and
 * strings so the tests can call every function.
 *
 * Shared groups first (platform, common, time, errors, privacy), then one group per screen.
 * Add a new screen as a new group here AND in ar.ts.
 */
export const ckb = {
  brand: "گیتواس",

  platform: { FB: "فەیسبووک", IG: "ئینستاگرام", TT: "تیکتۆک", YT: "یوتیوب" },

  common: {
    refresh: "نوێ",
    refreshLabel: "نوێکردنەوە",
    wait: "چاوەڕێ بکە",
    you: "تۆ",
    user: "بەکارهێنەر",
    noText: "(بێ دەق)",
    mediaOrFile: "(وێنە یان فایل)",
    error: "هەڵە",
    writing: "دەنووسێت…",
    connectIt: "پەیوەستی بکە",
    noneConnected: "هیچ پەیجێک پەیوەست نەکراوە.",
    notConnected: (name: string) => `${name} پەیوەست نەکراوە.`,
    open: "کردنەوە",
    view: "بینین",
    views: "بینین",
  },

  time: {
    now: "ئێستا",
    minutes: (n: number) => `${num(n)} خولەک`,
    hours: (n: number) => `${num(n)} کاتژمێر`,
    days: (n: number) => `${num(n)} ڕۆژ`,
    /** "٣٠ی ئەیلوول" */
    dayMonth: (day: number, month: string) => `${num(day)}ی ${month}`,
    /** "٣٠ی ئەیلوول ٢٠٢٦" */
    date: (day: number, month: string, year: number) => `${num(day)}ی ${month} ${num(year).replace(/[٬,]/g, "")}`,
    /** The month names used in Iraqi Kurdistan, January first. */
    months: [
      "کانوونی دووەم", "شوبات", "ئازار", "نیسان", "ئایار", "حوزەیران",
      "تەممووز", "ئاب", "ئەیلوول", "تشرینی یەکەم", "تشرینی دووەم", "کانوونی یەکەم",
    ],
  },

  /** What friendlyError() says for the raw platform errors it recognises. */
  errors: {
    generic: "کارەکە نەکرا. دووبارە هەوڵ بدەرەوە.",
    expired: "پەیوەندییەکە بەسەرچووە. لە ڕێکخستن دووبارە پەیوەستی بکەوە.",
    rateLimit: "مێتا بۆ ماوەیەکی کورت ڕێگری دەکات. چەند خولەکێکی تر هەوڵ بدەرەوە.",
    window24h: "ماوەی ٢٤ کاتژمێرەکە تەواو بووە — ناتوانیت لێرەوە وەڵام بدەیتەوە.",
    gone: "ئەم شتە چیتر بوونی نییە — لەوانەیە سڕابێتەوە.",
  },

  /** TikTok's audience options, by the codes TikTok returns. */
  privacy: {
    PUBLIC_TO_EVERYONE: "هەموو کەس",
    MUTUAL_FOLLOW_FRIENDS: "هاوڕێکان (شوێنکەوتووی دوولایەنە)",
    FOLLOWER_OF_CREATOR: "شوێنکەوتووەکان",
    SELF_ONLY: "تەنیا خۆم",
  },
};

export type Dict = typeof ckb;
