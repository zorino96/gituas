import { num } from "./num";
import { nrNewsCkb } from "./nr/news.ckb";
import { nrShellCkb } from "./nr/shell.ckb";
import { nrTeamCkb } from "./nr/team.ckb";

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

  /** How numbers are written: Arabic-Indic digits here and in Arabic, Western digits in English. */
  fmt: {
    num,
    /** Rewrites the Western digits in a string, e.g. a clock time "15:30". */
    digits: (s: string | number) => String(s).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]),
    /** Between a date and a time, or two names. */
    listSep: "، ",
  },

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
    newsOnly: "ئەم هەژمارە تا ئێستا تەنها بۆ هەواڵنووس بەکارهاتووە. دووکانێکیش بۆ هەمان هەژمار دروست بکە:",
    createShop: "دووکانەکەم دروست بکە",
    goNewsroom: "بچۆ هەواڵنووس",
    inDesk: (name: string) => `ئێستا لە مێزی هەواڵی «${name}»یت.`,
    goShop: (name: string) => `بچۆ دووکانی «${name}»`,
    backNewsroom: "بگەڕێوە بۆ هەواڵنووس",
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
    /** imageToJpeg (to-jpeg.ts) throws these when a PNG or WebP cannot be redrawn as JPEG. */
    canvasMissing: "کانڤاس بەردەست نییە.",
    jpegFailed: "گۆڕینی وێنە بۆ JPEG سەرکەوتوو نەبوو.",
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

  settings: {
    title: "ڕێکخستن",
    connected: "پەیوەست کرا.",
    connectFailed: "پەیوەستکردن سەرکەوتوو نەبوو. دووبارە هەوڵ بدەرەوە.",
    /** The ?error= codes the OAuth callback redirects back with. */
    connectErrors: {
      access_denied: "پەیوەستکردن هەڵوەشێنرایەوە.",
      state_expired: "کاتەکەی بەسەرچوو — دووبارە هەوڵ بدەرەوە.",
      token_exchange_failed: "پلاتفۆرمەکە ڕێگەی نەدا — دووبارە هەوڵ بدەرەوە.",
      provider_mismatch: "ئەکاونتێکی هەڵە هەڵبژێردرا.",
    },
    billingLink: "پلان و پارەدان",
    accountsSec: "ئەکاونتەکان",
    /** What each connection does, by provider. */
    connNote: {
      META_FACEBOOK: "کۆمێنت، مەسنجەر، بڵاوکردنەوە و ئامار",
      META_INSTAGRAM: "کۆمێنت، دایرێکت، بڵاوکردنەوە و ئامار",
      TIKTOK: "بڵاوکردنەوەی ڤیدیۆ و وێنە",
      YOUTUBE: "بڵاوکردنەوەی ڤیدیۆ و ئامار",
    },
    connectedBadge: "پەیوەستە",
    notConnectedBadge: "پەیوەست نییە",
    reconnect: "دووبارە پەیوەست بکەوە",
    connect: "پەیوەست بکە",
    igHint:
      "بۆ ئینستاگرام، لە ئەپی ئینستاگرام «Allow access to messages» هەڵبکە (Settings ← Messages and story replies ← Message controls ← Connected tools)، ئەگەرنا نامەکان نایەن.",
    whatsappSec: "وەتسئەپ",
    whatsappNumber: "ژمارەی وەتسئەپی دووکان",
    numberInvalid: "ژمارەکە دروست نییە",
    saving: "پاشەکەوت دەکرێت…",
    save: "پاشەکەوت",
    saved: "پاشەکەوت کرا.",
    numberRemoved: "ژمارەکە لابرا.",
    testMsgBtn: "نامەیەک بۆ خۆت بنێرە",
    /** The text pre-filled in the WhatsApp test message. */
    testMsgText: "تاقیکردنەوەی گیتواس",
    handoffHint: "ئەو لینکەی بۆ کڕیاران دەنێردرێت و دەژمێردرێت:",
    passwordSec: "وشەی نهێنی",
    accountSec: "هەژمار",
    signedInAs: "چوویتە ژوورەوە وەک",
    signOut: "چوونەدەرەوە",

    password: {
      changed: "وشەی نهێنی گۆڕدرا. ئامێرەکانی تر لە هەژمارەکەت دەرکران.",
      added: "وشەی نهێنی زیاد کرا. ئێستا بە ئیمەیڵیش دەتوانیت بچیتە ژوورەوە.",
      current: "وشەی نهێنیی ئێستا",
      noPasswordHint: "هەژمارەکەت بە گووگڵ یان GitHub دروست کراوە. وشەی نهێنییەک زیاد بکە تا بە ئیمەیڵیش بتوانیت بچیتە ژوورەوە.",
      next: "وشەی نهێنیی نوێ (لانیکەم ٨ پیت)",
      hide: "شاردنەوەی وشەی نهێنی",
      show: "پیشاندانی وشەی نهێنی",
      saving: "پاشەکەوت دەکرێت…",
      change: "گۆڕینی وشەی نهێنی",
      add: "زیادکردنی وشەی نهێنی",
    },

    /** The brand-colour picker on the newsroom settings screen. */
    colors: {
      primary: "ڕەنگی سەرەکی",
      accent: "ڕەنگی دووەم",
      text: "ڕەنگی نووسین",
      cantRead: "ڕەنگەکانی ئەم وێنەیە ناخوێنرێنەوە. وێنەیەکی تر تاقی بکەرەوە.",
      loadFailed: "وێنەکە نەکرایەوە.",
      refImage: "وێنەی ڕیفرێنس",
      myLogo: "لۆگۆکەم",
      fromScreen: "لە شاشەوە",
      whichColorAria: "کام ڕەنگ دابنرێت",
      clickHint: (slot: string) => `کلیک لەسەر هەر شوێنێکی وێنەکە بکە بۆ «${slot}»، یان یەکێک لە ڕەنگە سەرەکییەکانی خوارەوە هەڵبژێرە.`,
      paletteAria: "ڕەنگە سەرەکییەکانی وێنەکە",
      swatchAria: (hex: string, slot: string) => `${hex} بۆ ${slot}`,
      emptyHint: "وێنەیەکی کەناڵەکەت یان لۆگۆکەت بکەرەوە و ڕەنگەکان ڕاستەوخۆ لێیەوە هەڵبگرە. وێنەکە بار ناکرێت، تەنها لە وێبگەڕەکەتدا دەخوێنرێتەوە.",
      matchText: "ڕەنگی نووسینی گونجاو بۆ ڕەنگی سەرەکی",
    },

    /** The newsroom's own settings (keywords, sources, topics, brand), shown on the settings page of a news workspace. */
    news: {
      keywordsSec: "وشە سەرەکییەکان",
      keywordsPlaceholder: "هەولێر، Erbil، أربيل، ئابووری",
      keywordsHint: "بە کۆما جیایان بکەرەوە. بە چەند زمانێک بنووسە تا هەواڵی زیاتر بدۆزرێتەوە.",
      save: "پاشەکەوت",
      saved: "پاشەکەوت کرا.",
      changed: "گۆڕدرا.",
      removed: "لابرا.",
      added: "زیاد کرا.",
      keywordFilterLabel: "تەنها ئەو هەواڵانەی RSS کە یەکێک لە وشە سەرەکییەکانیان تێدایە",
      keywordFilterAria: "فلتەری وشە سەرەکی بۆ RSS",
      sourcesSec: "سەرچاوەکان",
      sourceError: (msg: string) => `هەڵە: ${msg}`,
      remove: "لابردن",
      sourceName: "ناوی سەرچاوە",
      rssRights: "تەنها ئەو RSSـانە زیاد بکە کە مافی بەکارهێنانیانت هەیە. گیتواس هەرگیز دەق یان وێنەی سەرچاوەکە بڵاو ناکاتەوە.",
      addRss: "زیادکردنی RSS",
      topicsSec: "بابەتەکان",
      topicsHint: "کام بابەتانە بهێنرێن؟ ئەگەر هیچ هەڵنەبژێریت، هەموو بابەتەکان دێن. هەواڵەکان بە زیرەکیی دەستکرد پۆلێن دەکرێن.",
      saveTopics: "پاشەکەوتی بابەتەکان",
      voiceSec: "شێوازی نووسین",
      voiceLabel: "شێوازی نووسینی کەناڵەکەت (ئارەزوومەندانە)",
      voiceHint: "بۆ نموونە: ڕستەی کورت، بێ وشەی بیانی، ناونیشانی بەهێز. AI هەر تەنها ڕاستییەکانی سەرچاوەکە دەنووسێت.",
      /** The autopilot card: what it does by itself, where it posts, and how much. */
      autoSec: "ئۆتۆپایلۆت",
      autoMode: { OFF: "کوژاوە", DRAFT: "ڕەشنووسی خۆکار", PUBLISH: "بڵاوکردنەوەی خۆکار" },
      autoPlanOnly: "تەنها لە پلانی پرۆ و دامەزراوە",
      autoTopicsAbove: "بابەت و سەرچاوەکان لە سەرەوە دیاری دەکرێن",
      autoTikTok: "تیکتۆک — بە پێی یاساکانی تیکتۆک، هەر پۆستێک دەبێت خۆت پەسەندی بکەیت",
      autoYouTube: "یوتیوب — تەنها ڤیدیۆ وەردەگرێت",
      autoDailyMax: "زۆرترین پۆستی خۆکار لە ڕۆژێکدا",
      autoMinGap: "کەمترین ماوە لە نێوان دوو پۆست (خولەک)",
      autoWarn:
        "ئۆتۆپایلۆت بێ پێداچوونەوەی مرۆڤ بڵاو دەکاتەوە. AI تەنها ڕاستییەکانی سەرچاوەکە دەنووسێتەوە، بەڵام بەرپرسیارێتی ناوەڕۆک لە سەر کەناڵەکەتە. سەرەتا «ڕەشنووسی خۆکار» تاقی بکەرەوە.",
      autoConfirm: "بڵاوکردنەوەی خۆکار چالاک بکرێت؟",
      brandSec: "براند",
      fontKufi: "کوفی",
      fontSans: "ئاسایی",
      uploading: "بارکردن…",
      changeLogo: "گۆڕینی لۆگۆ",
      logo: "لۆگۆ",
      onlyImages: "تەنها PNG/JPG/WEBP.",
      logoUploaded: "لۆگۆ بارکرا. پاشەکەوتی براند بکە تا پاشەکەوت بێت.",
      logoFailed: (msg: string) => `بارکردنی لۆگۆ سەرکەوتوو نەبوو: ${msg}`,
      saveBrand: "پاشەکەوتی براند",
      brandSaved: "براند پاشەکەوت کرا.",
      /** The sample headline drawn on the card preview. */
      cardSample: "نموونەی سەردێڕێکی هەواڵ لەسەر کارتەکەت",
    },
  },

  automation: {
    title: "ئۆتۆمەیشن",
    sub: "وەڵامدانەوەی خۆکار بۆ کۆمێنت و نامە",
    /** Shown on both the automation and the products screen when no page is connected yet. */
    noPageTitle: "هێشتا پەیجێکت پەیوەست نەکردووە",
    noPageBody: "لە ڕێکخستنەکان فەیسبووک یان ئینستاگرام پەیوەست بکە، ئینجا ئۆتۆمەیشن لێرە دەردەکەوێت.",
    settingsLink: "ڕێکخستنەکان",
    pageAria: "پەیج",
    saved: "پاشەکەوت کرا",

    statusSec: "دۆخ",
    switchLabel: "ئۆتۆمەیشن",
    switchOn: "چالاکە — وەڵام دەدرێتەوە",
    switchOff: "کوژاوەتەوە — هیچ شتێک نانێردرێت",
    paused: "پەیجەکەت دووبارە پەیوەست بکەرەوە — تۆکنەکەی بەسەرچووە.",

    usageSec: "بەکارهێنان",
    activePosts: "پۆستی چالاک",
    allPosts: "هەموو",
    sentToday: "وەڵامی ئەمڕۆ",
    aiVaried: "گۆڕینی AI ئەم مانگە",
    plan: (plan: string) => `پلان: ${plan}`,

    readySec: "ئامادەکاری",
    pageConnected: "پەیج پەیوەستە",
    webhooks: "ئاگادارکردنەوەکانی Meta تۆمار کراون",
    oneProduct: "لانیکەم یەک بەرهەم",
    productsLink: "بەرهەمەکان",
    sampleWritten: "نموونەی وەڵام نووسراوە",
    sampleHint: "ئەگەر ننووسیت، نموونەی ئامادە بەکاردێت",
    igHint: "ئینستاگرام: Settings ← Messages and story replies ← Connected tools ← Allow access to messages چالاک بکە، ئەگینا نامە ناگات.",

    // reply templates
    repliesSec: "وەڵامەکان",
    othersSec: "تێمپلەیتەکانی تر",
    /** The name a new default template is saved under. */
    defaultName: "بنەڕەت",
    templateName: "ناو",
    questionSamples: "نموونەی وەڵام بۆ پرسیار (هەر دێڕێک یەک نموونە، تا ٥)",
    thanksSamples: "نموونەی سوپاس (تا ٥)",
    aiHint: "AI هەر جارێک بە زمانی کڕیار دەیگۆڕێت و هیچ ژمارەیەک ناخاتە سەری. وەڵامی گشتی تەنها کاتێک دەچێت کە نامەی تایبەتیش بچێت.",
    dmGreeting: "سڵاوی AI لە سەرەتای نامەدا",
    whatsappAlways: "لینکی واتسئەپ هەمیشە لە نامەکەدا بێت",
    save: "پاشەکەوت",
    edit: "دەستکاری",
    makeDefault: "بیکە بە بنەڕەت",
    delete: "سڕینەوە",
    confirmDeleteTemplate: "ئەم تێمپلەیتە بسڕدرێتەوە؟",
    newTemplate: "تێمپلەیتی نوێ",

    // delivery and comments
    deliverySec: "نامەی تایبەت و گەیاندن",
    defaultDm: "نامەی تایبەت بۆ پۆستێک کە کارتی بەرهەمی نییە",
    deliveryFee: "کرێی گەیاندن (دینار، 0 = بەخۆڕایی)",
    deliveryTime: "ماوەی گەیاندن (بۆ نموونە: ١-٢ ڕۆژ)",
    commentsSec: "کۆمێنت",
    likeComments: "لایکی کۆمێنت بکە",
    likeHint: "تەنها فەیسبووک",
    hideSpam: "سپام و جنێو بشارەوە",
    expiryDays: "پۆستەکان دوای چەند ڕۆژ بوەستن",
    stopBefore: "پۆستەکانی پێش ئەم ڕێکەوتە ئۆتۆمەیشنیان نەبێت",

    // posts
    postsSec: "پۆستەکان",
    noPosts: "هیچ پۆستێک نەدۆزرایەوە",
    activeUntil: "چالاکە تا",
    off: "کوژاوەتەوە",
    productAria: "بەرهەم",
    noCard: "بێ کارتی بەرهەم",
    templateAria: "تێمپلەیت",
    defaultTemplate: "بنەڕەت",
  },

  products: {
    title: "بەرهەمەکان",
    sub: "نرخ و وێنەکان لێرە دادەنرێن — ژمارەکان هەرگیز لە AIیەوە نایەن",
    newProduct: "بەرهەمی نوێ",
    emptyTitle: "هێشتا هیچ بەرهەمێک نییە",
    emptyBody: "بەرهەمێک زیاد بکە، ئینجا لە پەڕەی ئۆتۆمەیشن بیبەستەوە بە پۆستەکانەوە.",
    edit: "دەستکاری",
    delete: "سڕینەوە",
    confirmDelete: "ئەم بەرهەمە بسڕدرێتەوە؟",

    name: "ناو",
    description: "وەسف (ئارەزوومەندانە)",
    photos: "وێنەکان (تا ٥)",
    removePhoto: "لابردنی وێنە",
    uploading: "بارکردن…",
    maxPhotos: "زیاتر لە ٥ وێنە ناکرێت.",
    noneUploaded: "هیچ وێنەیەک نەبارکرا.",
    uploadFailed: (msg: string) => `بارکردن سەرکەوتوو نەبوو: ${msg}`,
    variantsSec: "جۆرەکان",
    variantLabel: "جۆر (قیاس/ڕەنگ)",
    price: "نرخ",
    currency: "دراو",
    iqd: "دینار",
    usd: "دۆلار",
    inStock: "بەردەستە",
    removeVariant: "لابردنی جۆر",
    addVariant: "+ جۆری تر",
    save: "پاشەکەوت",
    cancel: "پاشگەزبوونەوە",
  },

  billing: {
    title: "پلان و پارەدان",
    sub: "بە FIB، ZainCash، QiCard، FastPay یان کارت — لە ڕێگەی Wayl",
    testMode: "مۆدی تاقیکردنەوە — هیچ پارەیەکی ڕاستەقینە وەرناگیرێت.",
    notReady: "پارەدان هێشتا ئامادە نییە.",
    /** What Wayl said about the invoice the buyer just came back from. */
    result: {
      paid: "پارەدان سەرکەوتوو بوو — پلانەکەت چالاک کرا.",
      paidTest: "تاقیکردنەوەی پارەدان سەرکەوتوو بوو — لە مۆدی تاقیکردنەوەدا پلان ناگۆڕدرێت.",
      pending: "پارەدانەکە هێشتا تەواو نەبووە. ئەگەر پارەت داوە، چەند خولەکێکی تر ئەم پەڕەیە نوێ بکەرەوە.",
    },
    noPage: "هێشتا پەیجێکت پەیوەست نەکردووە.",
    plan: (label: string) => `پلان: ${label}`,
    activeUntil: (date: string) => `چالاکە تا ${date}`,
    coversAll: "یەک پلان هەموو پلاتفۆرمەکانی ئەم کارە دەگرێتەوە.",
    trialLeft: (n: number) => `تاقیکردنەوە: ${n} ڕۆژ ماوە`,
    renew: (plan: string, price: string) => `نوێکردنەوە ${plan} — ${price} بۆ مانگێک`,
    buy: (plan: string, price: string) => `کڕین ${plan} — ${price} بۆ مانگێک`,
    current: "پلانی ئێستا",
    perMonth: (price: string) => `${price} بۆ مانگێک`,
    /** What a plan includes (src/lib/billing/features.ts). */
    features: {
      label: {
        refresh: "نوێکردنەوەی هەواڵ",
        drafts: "ڕەشنووسی AI لە مانگێکدا",
        improves: "باشترکردن لە مانگێکدا",
        publishes: "بڵاوکردنەوە لە مانگێکدا",
        sources: "سەرچاوە",
        seats: "ئەندامی تیم",
        desks: "مێز",
        mode: "ئۆتۆپایلۆت",
        shopPosts: "پۆستی ئۆتۆمەیشنکراو",
        shopReplies: "وەڵامی خۆکار لە ڕۆژێکدا",
        shopAi: "گۆڕینی AI لە مانگێکدا",
      },
      /** The refresh interval: "every 30 seconds", "every minute", "every 2 minutes". */
      refresh: (sec: number) => (sec < 60 ? `هەر ${num(sec)} چرکە` : sec === 60 ? "هەر خولەکێک" : `هەر ${num(Math.round(sec / 60))} خولەک`),
      autoDraft: "ڕەشنووسی خۆکار — بڵاوکردنەوە بە دەست",
      autoPublish: "بڵاوکردنەوەی تەواو خۆکار (فەیسبووک و ئینستاگرام)",
      all: "هەموو پۆستەکان",
    },
    historySec: "مێژووی پارەدان",
    status: { PAID: "دراوە", PENDING: "چاوەڕوان", EXPIRED: "بەسەرچوو", CANCELLED: "هەڵوەشاوە" },
  },

  orders: {
    title: "داواکارییەکان",
    sub: "داواکارییەکانی کۆمێنت و نامە لێرە دەردەکەون، یان خۆت تۆماریان بکە",
    filterAll: "هەموو",
    status: { NEW: "نوێ", CONFIRMED: "پشتڕاستکراوە", SENT: "نێردراوە", DELIVERED: "گەیەندراوە", RETURNED: "گەڕاوەتەوە", CANCELLED: "هەڵوەشاوە" },
    source: { COMMENT: "لە کۆمێنت", DM: "لە نامە" },
    newOrder: "داواکاری نوێ",
    byCity: "بە پێی شار",
    iqd: "دینار",
    usd: "دۆلار",
    count: (n: number) => `${num(n)} داواکاری`,
    emptyTitle: "هێشتا هیچ داواکارییەک نییە",
    emptyBody: "کاتێک کڕیارێک بە کۆمێنت یان نامە داوای شتێک بکات، لێرە دەردەکەوێت.",
    noneInStatus: "هیچ داواکارییەک لەم دۆخەدا نییە.",
    statusAria: "دۆخی داواکاری",
    edit: "دەستکاری",
    cod: "پارەدان لە کاتی گەیاندن",

    customerName: "ناوی کڕیار",
    phone: "ژمارەی مۆبایل",
    city: "شار",
    address: "ناونیشان",
    product: "بەرهەم",
    otherProduct: "تر",
    variant: "جۆر",
    price: "نرخ",
    currency: "دراو",
    deliveryFee: "کرێی گەیاندن",
    note: "تێبینی",
    save: "پاشەکەوت",
    cancel: "پاشگەزبوونەوە",
  },

  /**
   * What the shop's server actions (the actions.ts files under src/app/app) and the libraries they
   * call answer with. "Not allowed" is t.nr.team.roles.notAllowed.
   */
  actions: {
    common: {
      signIn: "چوونەژوورەوە پێویستە.",
      aiDown: "AI کار ناکات.",
      productNotFound: "بەرهەمەکە نەدۆزرایەوە.",
      badDeliveryFee: "کرێی گەیاندن دروست نییە.",
    },
    inbox: {
      emptyText: "دەقەکە بەتاڵە.",
      textTooLong: (max: number) => `دەقەکە لە ${max} پیت درێژترە.`,
      sendFailed: "ناردن سەرکەوتوو نەبوو.",
      failed: "نەکرا.",
      deleteFailed: "سڕینەوە نەکرا.",
      nothingToReply: "هیچ دەقێک نییە بۆ وەڵامدانەوە.",
      aiNoReply: "AI هیچ وەڵامێکی نەدایەوە.",
    },
    settings: {
      noEmail: "ئەم هەژمارە ئیمەیڵی نییە.",
      passwordShort: "وشەی نهێنیی نوێ دەبێت لانیکەم ٨ پیت بێت.",
      passwordLong: "وشەی نهێنیی نوێ زۆر درێژە.",
      tooManyTries: "زۆر جار هەڵە کرا. ١٥ خولەک چاوەڕێ بکە.",
      wrongPassword: "وشەی نهێنیی ئێستا هەڵەیە.",
      whatsappShopOnly: "ژمارەی وەتسئەپ تەنها بۆ دووکانە.",
      badWhatsapp: "ژمارەکە دروست نییە. بۆ نموونە: 0750 123 4567",
    },
    publish: {
      aiNoCaption: "AI هیچ دەقێکی نەنووسی.",
      unknownTarget: "ئامانجێکی نەناسراو.",
      needMedia: "ئینستاگرام و تیکتۆک وێنە یان ڤیدیۆیان دەوێت.",
      igNeedsMedia: "ئینستاگرام وێنە یان ڤیدیۆی دەوێت.",
      badFile: "فایلەکە ناناسرێتەوە. دووبارە بارکردنی بکە.",
      jpgOnly: "ئینستاگرام و تیکتۆک تەنها وێنەی JPG وەردەگرن.",
      igJpgOnly: "ئینستاگرام تەنها وێنەی JPG وەردەگرێت.",
      cardChanged: "کارتەکە گۆڕاوە. لە مێزی هەواڵ دووبارە ئامادەی بکەوە.",
      ttNoSettings: "ڕێکخستنەکانی تیکتۆک دیاری نەکراون.",
      ttIncomplete: (problems: string) => `ڕێکخستنی تیکتۆک تەواو نییە (${problems}).`,
      // Scheduling (src/lib/merchant/schedule.ts).
      noTiktokSchedule: "بۆ تیکتۆک خشتەکردن نییە — ڕاستەوخۆ بڵاوی بکەرەوە.",
      tooSoon: "کاتەکە دەبێت لانیکەم ١٠ خولەک دوای ئێستا بێت.",
      tooFar: "کاتەکە دەبێت لە ماوەی ٦٠ ڕۆژدا بێت.",
      badTime: "کاتەکە دروست نییە.",
      cantCancel: "ئەم پۆستە ئێستا ناتوانرێت هەڵبوەشێنرێتەوە.",
    },
    automation: {
      storeNotFound: "دووکانەکە نەدۆزرایەوە.",
      badDays: "ڕۆژەکان دەبێت لە ١ تا ٣٦٥ بن.",
      badDate: "ڕێکەوتەکە دروست نییە.",
      templateName: "ناوێک بۆ تێمپلەیتەکە بنووسە.",
      templateNotFound: "تێمپلەیتەکە نەدۆزرایەوە.",
      badPost: "پۆستەکە دروست نییە.",
      productName: "ناوی بەرهەمەکە بنووسە.",
      badPhoto: "وێنەیەک دروست نییە.",
      needPrice: "لانیکەم یەک نرخ پێویستە.",
      badRowPrice: (row: number) => `نرخی ڕیزی ${row} دروست نییە.`,
      rowLabel: (row: number) => `ناوی جۆری ڕیزی ${row} بنووسە (قیاس یان ڕەنگ).`,
    },
    orders: {
      customerName: "ناوی کڕیار بنووسە.",
      badPhone: "ژمارەی مۆبایل دروست نییە.",
      badCity: "شارەکە دروست نییە.",
      badStatus: "دۆخەکە دروست نییە.",
      badPrice: "نرخەکە دروست نییە.",
      notFound: "داواکارییەکە نەدۆزرایەوە.",
    },
  },

  /** The sign-in, sign-up and password-reset pages and their server actions (src/app/login, signup, forgot; src/lib/email-code-store.ts). */
  auth: {
    /** The resend button while its 60-second wait runs. */
    resendIn: (s: number) => `دوای ${num(s)} چرکە کۆدێکی تر بنێرە`,

    /** Text the three pages share, on screen and in server answers. */
    common: {
      email: "ئیمەیڵ",
      password: "وشەی نهێنی",
      showPassword: "پیشاندانی وشەی نهێنی",
      hidePassword: "شاردنەوەی وشەی نهێنی",
      orEmail: "یان بە ئیمەیڵ",
      signIn: "بچۆ ژوورەوە",
      emailCode: "کۆدی ئیمەیڵ",
      /** Before the resend button. */
      noEmail: "ئیمەیڵەکە نەگەیشت؟ فۆڵدەری Spam بپشکنە، یان",
      resend: "کۆدێکی تر بنێرە",
      changeEmail: "ئیمەیڵەکە بگۆڕە",
      badEmail: "ئیمەیڵەکە دروست نییە.",
      passwordShort: "وشەی نهێنی دەبێت لانیکەم ٨ پیت بێت.",
      passwordLong: "وشەی نهێنی زۆر درێژە.",
      newCode: "کۆدێکی نوێ داوا بکە.",
      unavailable: "ئەم خزمەتگوزارییە ئێستا بەردەست نییە.",
    },

    /** What the emailed-code check answers (issueEmailCode and consumeEmailCode in src/lib/email-code-store.ts). */
    code: {
      justSent: "کۆدێک تازە نێردرا. یەک خولەک چاوەڕێ بکە پێش داواکردنی کۆدێکی تر.",
      tooMany: "کۆدی زۆر داواکراوە. دوای کاتژمێرێک هەوڵ بدەرەوە.",
      sendFailed: "نەتوانرا ئیمەیڵ بنێردرێت. ئیمەیڵەکە بپشکنە و دووبارە هەوڵ بدەرەوە.",
      sixDigits: "کۆدەکە ٦ ژمارەیە.",
      expired: "کاتی کۆدەکە بەسەرچووە. کۆدێکی نوێ داوا بکە.",
      tooManyWrong: "زۆر جار هەڵە کرا. کۆدێکی نوێ داوا بکە.",
      wrong: "کۆدەکە هەڵەیە.",
    },

    login: {
      /** The tab title is this, a dash, then the product name. */
      pageTitle: "چوونەژوورەوە",
      subtitleShop: "بچۆ ژوورەوە بۆ کۆمێنت، نامە و بڵاوکردنەوەی دووکانەکەت.",
      subtitleNewsroom: "بچۆ ژوورەوە بۆ ژووری هەواڵی کەناڵەکەت.",
      /** Google came back with an address that already has a password. */
      emailHasPassword: "ئەم ئیمەیڵە پێشتر بە وشەی نهێنی تۆمار کراوە — بە ئیمەیڵ و وشەی نهێنی بچۆ ژوورەوە.",
      oauthFailed: "چوونەژوورەوە سەرکەوتوو نەبوو. دووبارە هەوڵ بدەرەوە.",
      wrongCredentials: "ئیمەیڵ یان وشەی نهێنی هەڵەیە. ئەگەر زۆر جار هەڵەت کردووە، ١٥ خولەک چاوەڕێ بکە.",
      google: "بە گووگڵ بچۆ ژوورەوە",
      github: "بە GitHub بچۆ ژوورەوە",
      forgot: "وشەی نهێنیت لەبیرچووە؟",
      submitting: "چوونەژوورەوە…",
      noAccount: "هەژمارت نییە؟",
      signUp: "خۆت تۆمار بکە",
    },

    signup: {
      /** The tab title is this, a dash, then the product name. */
      pageTitle: "خۆتۆمارکردن",
      subtitleShop: "هەژمارێکی نوێ دروست بکە — کۆمێنت، نامە و بڵاوکردنەوە لە یەک شوێن.",
      subtitleNewsroom: "هەژمارێک بۆ کەناڵەکەت دروست بکە — هەواڵ، کارت و بڵاوکردنەوە لە یەک شوێن.",
      /** The two halves of one sentence around the address; the second half starts with its own punctuation or space. */
      codeSentBefore: "کۆدێکی ٦ ژمارەییمان نارد بۆ",
      codeSentAfter: ". بینووسە بۆ تەواوکردنی تۆمارکردن.",
      verify: "دڵنیاکردنەوە",
      verifying: "دەپشکنرێت…",
      google: "بە گووگڵ خۆت تۆمار بکە",
      nameShop: "ناوی دووکان یان ناوی خۆت",
      nameNewsroom: "ناوی کەناڵ",
      passwordLabel: "وشەی نهێنی (لانیکەم ٨ پیت)",
      submit: "هەژمار دروست بکە",
      submitting: "دروست دەکرێت…",
      haveAccount: "هەژمارت هەیە؟",
      autoSignInFailed: "هەژمارەکە دروست کرا، بەڵام چوونەژوورەوە سەرکەوتوو نەبوو. لە پەڕەی چوونەژوورەوە هەوڵ بدەرەوە.",
      nameMissing: "ناوی دووکان یان ناوی خۆت بنووسە.",
      taken: "ئەم ئیمەیڵە پێشتر تۆمار کراوە — بچۆ ژوورەوە.",
      signUpAgain: "دووبارە خۆت تۆمار بکەرەوە.",
      expired: "کاتی ئەم تۆمارکردنە بەسەرچووە. دووبارە خۆت تۆمار بکەرەوە.",
    },

    forgot: {
      /** The tab title is this, a dash, then the product name. */
      pageTitle: "وشەی نهێنیی نوێ",
      subtitle: "ئیمەیڵی هەژمارەکەت بنووسە، کۆدێکت بۆ دەنێرین بۆ دانانی وشەی نهێنیی نوێ.",
      send: "کۆدم بۆ بنێرە",
      sending: "دەنێردرێت…",
      /** The two halves of one sentence around the address; the second half starts with its own punctuation or space. */
      sentBefore: "ئەگەر هەژمارێک بە",
      sentAfter: " هەبێت، کۆدێکی ٦ ژمارەییمان بۆ ناردووە.",
      newPasswordLabel: "وشەی نهێنیی نوێ (لانیکەم ٨ پیت)",
      submit: "وشەی نهێنیی نوێ دابنێ",
      saving: "پاشەکەوت دەکرێت…",
      newCodeSent: "کۆدێکی نوێ نێردرا.",
      back: "گەڕانەوە بۆ چوونەژوورەوە",
      retry: "دووبارە هەوڵ بدەرەوە.",
    },
  },

  /** The page chooser shown after Facebook sign-in (src/app/connect/facebook/page.tsx). */
  connectFacebook: {
    metaTitle: "پەیجەکەت هەڵبژێرە — گیتواس",
    expired: "کاتی هەڵبژاردن بەسەرچوو یان ئەم بەستەرە بۆ تۆ نییە. لە ڕێکخستن دووبارە فەیسبووک پەیوەست بکەوە.",
    title: "کام پەیج پەیوەست بکرێت؟",
    subDesk: "ئەم پەیجانە لە فەیسبووک بەڕێوە دەبەیت. ئەوەی بۆ ئەم مێزەیە هەڵبژێرە.",
    subShop: "ئەم پەیجانە لە فەیسبووک بەڕێوە دەبەیت. ئەوەی بۆ ئەم دووکانەیە هەڵبژێرە.",
    error: "پەیوەستکردن سەرکەوتوو نەبوو. دووبارە هەوڵ بدەرەوە.",
    cancel: "پاشگەزبوونەوە",
  },

  // gituas.com for visitors who are not signed in: what Gituas is, and the way in.
  welcome: {
    metaTitle: "گیتواس — فرۆشتن لە سۆشیال میدیا، بە ئاسانی",
    metaDescription: "پۆست، وەڵامی کۆمێنت و نامە و داواکارییەکانی دووکانەکەت لە یەک شوێن — بۆ فەیسبووک، ئینستاگرام، تیکتۆک و یوتیوب.",
    title: "دووکانەکەت لە سۆشیال میدیا بە ئاسانی بەڕێوە ببە",
    lead: "یەک جار پۆست بکە بۆ فەیسبووک، ئینستاگرام، تیکتۆک و یوتیوب. گیتواس وەڵامی کۆمێنت و نامەکان دەداتەوە و داواکارییەکانت بۆ کۆدەکاتەوە.",
    start: "بەخۆڕایی دەست پێبکە",
    signIn: "چوونەژوورەوە",
    promise: "بەخۆڕایی دەست پێبکە — پارەدان بە FIB، زەین کاش، کی کارد یان کارت",
    features: {
      publish: { title: "یەک پۆست، هەموو پلاتفۆرمەکان", body: "وێنە یان ڤیدیۆیەک هەڵبژێرە و بە یەک کرتە لە فەیسبووک، ئینستاگرام، تیکتۆک و یوتیوب بڵاوی بکەرەوە، یان کاتێکی بۆ دابنێ." },
      ai: { title: "دەقی پۆست بە زیرەکیی دەستکرد", body: "چەند وشەیەک بنووسە، گیتواس دەقێکی فرۆشتنی ئامادە لەگەڵ هاشتاگی شارەکان بۆت دەنووسێت." },
      replies: { title: "وەڵامی خۆکار", body: "پرسیاری نرخ و گەیاندن لە کۆمێنت و نامەکاندا خۆکار وەڵام دەدرێنەوە، لەگەڵ کارتی بەرهەمەکە." },
      orders: { title: "هەموو داواکارییەکان لە یەک شوێن", body: "داواکارییەکانی نامە تۆمار بکە، بە پێی شار بیانبینە و دۆخیان بگۆڕە تا دەگەنە دەستی کڕیار." },
      insights: { title: "ئامار", body: "فۆڵۆوەر، گەیشتن و چالاکیی پەیجەکانت لە یەک شاشەدا ببینە." },
    },
    footer: {
      privacy: "سیاسەتی تایبەتمەندی",
      terms: "مەرجەکان",
      dataDeletion: "سڕینەوەی زانیاری",
      newsroom: "هەواڵنووس — بۆ کەناڵە هەواڵییەکان",
    },
  },

  // The newsroom's own screens, one file per area in ./nr/.
  nr: { shell: nrShellCkb, news: nrNewsCkb, team: nrTeamCkb },
};

export type Dict = typeof ckb;
