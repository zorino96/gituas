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

  nav: {
    label: "بەشەکان",
    today: "ئەمڕۆ",
    automation: "ئۆتۆمەیشن",
    orders: "داواکاری",
    comments: "کۆمێنت",
    messages: "نامە",
    publish: "بڵاوکردنەوە",
    insights: "ئامار",
    news: "هەواڵ",
  },

  layout: {
    metaDescription: "وەڵامدانەوە و بڵاوکردنەوە بۆ دووکانەکەت",
    settings: "ڕێکخستن",
    newsOnly: "ئەم هەژمارە تا ئێستا تەنها بۆ نیوزڕووم بەکارهاتووە. دووکانێکیش بۆ هەمان هەژمار دروست بکە:",
    createShop: "دووکانەکەم دروست بکە",
    goNewsroom: "بچۆ نیوزڕووم",
    inDesk: (name: string) => `ئێستا لە مێزی هەواڵی «${name}»یت.`,
    goShop: (name: string) => `بچۆ دووکانی «${name}»`,
    backNewsroom: "بگەڕێوە بۆ نیوزڕووم",
  },

  home: {
    title: "ئەمڕۆ",
    sub: "ئەوەی چاوەڕێی تۆیە، لە یەک شوێندا.",
    connectFirst: "سەرەتا پەیجەکانت پەیوەست بکە",
    connectHint: "فەیسبووک، ئینستاگرام و تیکتۆک — پاشان کۆمێنت و نامەکانت لێرە دەبینیت.",
    connectBtn: "پەیوەستیان بکە",
    unansweredComments: "کۆمێنتی بێوەڵام",
    waitingMessages: "نامەی چاوەڕوان",
    postsThisWeek: "پۆستی ئەم هەفتەیە",
    whatsappTaps: "چوونە وەتسئەپ",
    noCommentsWaiting: "هیچ کۆمێنتێک چاوەڕێی وەڵام نییە.",
    appearAfterConnect: "دوای پەیوەستکردن لێرە دەردەکەون.",
    waitingBadge: "چاوەڕێی وەڵامە",
    noMessagesWaiting: "هیچ نامەیەک چاوەڕێت ناکات.",
    customer: "کڕیار",
  },

  /** The reply box shared by comments and messages. */
  composer: {
    placeholderDm: "نامەکەت بنووسە…",
    placeholderComment: "وەڵامەکەت بنووسە…",
    label: "وەڵام",
    aiSuggest: "پێشنیاری AI",
    whatsappLink: "لینکی وەتسئەپ",
    whatsappLinkTitle: "سەرەتا ژمارەی وەتسئەپ لە ڕێکخستن دابنێ",
    whatsappLine: (url: string) => `بۆ داواکردن لە وەتسئەپ: ${url}`,
    whatsappHint: "بۆ لینکی وەتسئەپ، ژمارەکەت لە ڕێکخستن دابنێ.",
    close: "داخستن",
    send: "بنێرە",
    sending: "دەنێردرێت…",
  },

  comments: {
    title: "کۆمێنتەکان",
    sub: (n: number) => `${num(n)} کۆمێنت لە دوایین پۆستەکانی فەیسبووک و ئینستاگرام`,
    filterLabel: "پاڵاوتن",
    filterUnanswered: "وەڵام نەدراوە",
    filterAll: "هەموو",
    filterAnswered: "وەڵام دراوە",
    filterHidden: "شاردراوە",
    filterNeeds: "پێویستی بە تۆیە",
    badgeUnanswered: "چاوەڕێی وەڵامە",
    badgeAnswered: "وەڵام دراوە",
    badgeHidden: "شاردراوە",
    badgeOwn: "کۆمێنتی تۆ",
    autoReplied: "وەڵامی خۆکار",
    /** Why the automation left a comment for the merchant, by outcomeReason. */
    reasons: {
      negotiation: "داوای داشکاندن",
      complaint: "گلەیی",
      abuse: "جنێو",
      spam: "سپام",
      other: "پێویستی بە تۆیە",
      low_confidence: "دڵنیا نییە",
      no_product: "کارتی بەرهەم نییە",
      private_window: "درەنگە بۆ نامەی تایبەت",
      unclear: "ڕوون نییە",
      needs_you: "پێویستی بە تۆیە",
      no_action: "پێویستی بە تۆیە",
    },
    emptyAllAnswered: "هەموو کۆمێنتەکان وەڵام دراونەتەوە",
    emptyNone: "هیچ کۆمێنتێک نییە",
    nothingWaitingNews: "هیچ کۆمێنتێک چاوەڕێی وەڵام نییە.",
    nothingWaitingShop: "هیچ کڕیارێک چاوەڕێ ناکات.",
    newPost: "پۆستێکی نوێ بڵاو بکەرەوە",
    postAria: (platform: string) => `پۆستی ${platform}`,
    postLink: "پۆستەکە",
    yourReply: "وەڵامی تۆ",
    confirmDelete: "ئەم کۆمێنتە بۆ هەمیشە دەسڕدرێتەوە. دڵنیایت؟",
    deleting: "دەسڕدرێتەوە…",
    confirmYes: "بەڵێ، بیسڕەوە",
    confirmNo: "نا",
    reply: "وەڵام",
    show: "دەریبخەرەوە",
    hide: "بیشارەوە",
    delete: "بیسڕەوە",
  },

  messages: {
    title: "نامەکان",
    sub: (n: number) => `${num(n)} گفتوگۆ چاوەڕێی وەڵامی تۆن`,
    viewer: "بینەر",
    customer: "کڕیار",
    back: "گەڕانەوە",
    noMessages: "هیچ نامەیەک نییە.",
    windowClosed: (who: string) =>
      `مێتا تەنیا لە ماوەی ٢٤ کاتژمێر دوای دوایین نامەی ${who} ڕێگە بە وەڵامدانەوە دەدات. ئەم گفتوگۆیە لەو ماوەیە دەرچووە.`,
    messenger: "مەسنجەر",
    unreadable: (n: number) => `${num(n)} گفتوگۆی کۆن هەیە کە ئینستاگرام ڕێگە نادات لێرەوە بخوێنرێنەوە — لە ئەپی ئینستاگرام دەبینرێن.`,
    emptyTitle: "هیچ نامەیەک نییە",
    emptyShop: "کاتێک کڕیارێک نامە دەنێرێت، لێرە دەردەکەوێت.",
    emptyNews: "کاتێک بینەرێک نامە دەنێرێت، لێرە دەردەکەوێت.",
    youPrefix: "تۆ: ",
    needsYou: "چاوەڕێی تۆیە",
    outsideWindow: "دەرەوەی ٢٤ کاتژمێر",
  },

  publish: {
    title: "بڵاوکردنەوە",
    sub: "یەک جار — بۆ فەیسبووک، ئینستاگرام و تیکتۆک پێکەوە.",
    notAllowed: "تەنها خاوەن و سەرنووسەر دەتوانن بڵاو بکەنەوە. کارتەکە ئامادە بکە و سەرنووسەرەکەت ئاگادار بکەرەوە.",
    draftStale: "کارتی ئەم هەواڵە کۆن بووە. لە مێزی هەواڵ دووبارە ئامادەی بکەوە.",
    fbPage: "پەیجی فەیسبووک",
    newsHintPre: "بۆ بڵاوکردنەوەی هەواڵ: لە",
    newsHintLink: "بەشی هەواڵ",
    newsHintPost: "هەواڵێک بکەرەوە و «ئامادەکردن بۆ بڵاوکردنەوە» دابگرە — کارت و دەقەکە خۆکار لێرە دادەنرێن.",

    // media
    badType: "تەنیا وێنەی JPG/PNG/WEBP یان ڤیدیۆی MP4/MOV.",
    tooBig: "فایلەکە لە ٢٥٠ مێگابایت گەورەترە.",
    uploadFailed: (msg: string) => `بارکردن سەرکەوتوو نەبوو: ${msg}`,
    uploadAria: "بارکردن",
    ready: "ئامادەیە",
    videoSecs: (n: number) => `ڤیدیۆ · ${num(n)} چرکە`,
    uploading: (percent: number) => `بارکردن… ${num(percent)}٪`,
    remove: "لابردن",
    dropTitle: "وێنە یان ڤیدیۆ هەڵبژێرە",
    dropHint: "JPG، PNG، MP4 — تا ٢٥٠ مێگابایت",

    // caption
    captionSec: "دەق",
    captionPlaceholderNews: "دەقی پۆستەکە بنووسە…",
    captionPlaceholderShop: "دەربارەی بەرهەمەکە بنووسە… یان چەند وشەیەک بنووسە و زیرەکیی دەستکرد دەقەکەت بۆ دەنووسێت.",
    captionAria: "دەقی پۆست",
    writeForMe: "دەقێکم بۆ بنووسە",
    cityTags: "+ هاشتاگی شارەکان",
    productLabel: "کارتی بەرهەم (ئارەزوومەندانە)",
    noProduct: "بێ کارت",
    productHint: "ئەگەر هەڵیبژێریت، هەر کەسێک پرسیاری نرخ بکات، نامەیەکی تایبەت بە نرخ و وێنەکانەوە بە خۆکاری بۆی دەچێت.",

    // targets
    whereSec: "بۆ کوێ",
    ttLiveOnly: "تیکتۆک تەنها ڕاستەوخۆ",
    notConnected: "پەیوەست نەکراوە — پەیوەستی بکە",
    ytVideoOnly: "یوتیوب تەنها ڤیدیۆ وەردەگرێت.",
    addVideoFirst: "سەرەتا ڤیدیۆ زیاد بکە",
    addMediaFirst: "سەرەتا وێنە یان ڤیدیۆ زیاد بکە",
    ytPrivate: "تا Google ئەپەکە پەسەند دەکات، ڤیدیۆکان وەک تایبەت (Private) بڵاو دەبنەوە.",

    // tiktok (the audited elements)
    ttLoading: "زانیاری تیکتۆک دێت…",
    ttPostingTo: "بڵاو دەکرێتەوە لە",
    ttAccount: "ئەکاونتی تیکتۆک",
    ttWhoVideo: "کێ ڤیدیۆکە ببینێت",
    ttWhoPost: "کێ پۆستەکە ببینێت",
    ttPickOne: "یەکێکیان هەڵبژێرە — هیچ هەڵبژاردنێکی پێشوەختە نییە.",
    ttAllow: "ڕێگە بە خەڵک بدە",
    ttComment: "کۆمێنت",
    ttDisabled: "لە ڕێکخستنی تیکتۆکەکەتدا کوژاوەتەوە",
    ttCommercialSec: "ناوەڕۆکی بازرگانی",
    ttAdVideo: "ئەم ڤیدیۆیە ڕیکلامە",
    ttAdPost: "ئەم پۆستە ڕیکلامە",
    ttAdHint: "ئەگەر ڕیکلام بۆ خۆت، براندێک، بەرهەمێک یان خزمەتگوزارییەک دەکات.",
    ttYourBrand: "Your brand — براندی خۆت",
    ttYourBrandHint: "ڕیکلام بۆ خۆت یان کاری خۆت. وەک «Promotional content» نیشان دەدرێت.",
    ttBranded: "Branded content — ناوەڕۆکی براند",
    ttBrandedHint: "هاوبەشی پارەدار لەگەڵ براندێکی تر. وەک «Paid partnership» نیشان دەدرێت.",
    ttConsentPre: "بە بڵاوکردنەوە، ڕازیت بە",
    ttAnd: "و",
    ttConsentPost: "ـی تیکتۆک.",

    // blockers: why the button is still off
    blockPickTarget: "لانیکەم یەک شوێن هەڵبژێرە.",
    blockNeedContent: "دەق یان وێنە/ڤیدیۆیەک زیاد بکە.",
    blockUploading: "چاوەڕێ بکە تا بارکردن تەواو دەبێت.",
    blockCaptionLong: "دەقەکە بۆ یەکێک لە شوێنەکان درێژە.",
    blockTtInfo: "زانیاری تیکتۆک هێشتا نەهاتووە.",
    blockTtPrivacyVideo: "لە تیکتۆک دیاری بکە کێ ڤیدیۆکە ببینێت.",
    blockTtPrivacyPost: "لە تیکتۆک دیاری بکە کێ پۆستەکە ببینێت.",
    blockTtCommercial: "جۆری ناوەڕۆکی بازرگانی هەڵبژێرە.",
    blockTtBranded: "ناوەڕۆکی براند ناتوانێت «تەنیا خۆم» بێت.",
    blockTtDuration: "ڤیدیۆکە لە سنووری تیکتۆکی ئەم ئەکاونتە درێژترە.",
    blockPickTime: "کاتی بڵاوکردنەوە دیاری بکە.",

    // when
    whenSec: "کات",
    now: "ئێستا",
    later: "کاتێکی دیاریکراو",
    runAt: "کاتی بڵاوکردنەوە (کاتی عێراق)",
    schedule: "خشتەکردن",
    scheduling: "خشتە دەکرێت…",
    publishing: "بڵاو دەکرێتەوە…",
    publishBtn: "بڵاوی بکەرەوە",
    publishTo: (platforms: string) => `بڵاوی بکەرەوە — ${platforms}`,
    igVideoWait: "ڤیدیۆی ئینستاگرام تا یەک خولەک دەخایەنێت.",
    scheduledMsg: (when: string) => `خشتە کرا — ${when} بڵاو دەکرێتەوە.`,
    scheduledSec: "پۆستە خشتەکراوەکان",
    cancel: "هەڵوەشاندنەوە",
    sendingNow: "دەنێردرێت…",
    failed: "نەکرا",

    // result
    resultsTitle: "ئەنجامی بڵاوکردنەوە",
    posted: "بڵاو کرایەوە.",
    ttPosted: "بڵاو کرایەوە لە تیکتۆک.",
    ttRejected: (msg: string) => `تیکتۆک ڕەتی کردەوە: ${msg}`,
    ttSlowVideo: "تیکتۆک هێشتا ڤیدیۆکە پرۆسێس دەکات — چەند خولەکێکی تر لە پرۆفایلەکەت دەردەکەوێت.",
    ttSlowPost: "تیکتۆک هێشتا پۆستەکە پرۆسێس دەکات — چەند خولەکێکی تر لە پرۆفایلەکەت دەردەکەوێت.",
    ttBusyVideo: "تیکتۆک ڤیدیۆکە وەردەگرێت و پرۆسێسی دەکات…",
    ttBusyPost: "تیکتۆک پۆستەکە وەردەگرێت و پرۆسێسی دەکات…",
    succeeded: "سەرکەوتوو",
    newPost: "پۆستێکی نوێ",
  },

  insights: {
    title: "ئامار",
    subNews: "کام پۆست زۆرترین کارلێکی هەبووە.",
    subShop: "کام پۆست کڕیاری بۆ هێنایت، و چەند کەس چوونە وەتسئەپ.",
    fbFollowers: "شوێنکەوتووی فەیسبووک",
    whatsapp7d: "چوونە وەتسئەپ · ٧ ڕۆژ",
    /** Instagram metrics, by the names the engage client returns. */
    ig: {
      followers: "شوێنکەوتووی ئینستاگرام",
      reach_7d: "گەیشتنی ئینستاگرام · ٧ ڕۆژ",
      reach_28d: "گەیشتنی ئینستاگرام · ٢٨ ڕۆژ",
      posts: "پۆستی ئینستاگرام",
    },
    fb: {
      page_post_engagements: "کارلێک لەگەڵ پۆستەکانی فەیسبووک",
      page_views_total: "سەردانی پەیجی فەیسبووک",
      page_total_actions: "کلیک لەسەر پەیجی فەیسبووک",
    },
    /** YouTube tiles, by key. */
    yt: {
      subscribers: "بەشداربوو",
      views: "بینین",
      videos: "ڤیدیۆ",
    },
    ytFailed: "ئاماری یوتیوب نەهات.",
    ytReconnect: "لە ڕێکخستن دووبارە پەیوەستی بکەوە",
    noTitle: "(بێ ناونیشان)",
    topSec: "پۆستەکانی زۆرترین کۆمێنت",
    topEmpty: "هێشتا هیچ پۆستێک کۆمێنتی نییە.",
    topPublish: "پۆستێک بڵاو بکەرەوە",
    notes: "هەندێک ئامار نەهات: مێتا ئامار بۆ پەیجی نوێ یان بچووک هەمیشە نادات. ئەوانەی سەرەوە ئەوەن کە هاتن.",
  },
};

export type Dict = typeof ckb;
