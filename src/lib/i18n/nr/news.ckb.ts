import { num } from "../num";

// The newsroom's news text in Sorani. Wired into ckb.ts as `nr.news`; nr/news.ar.ts has the same keys.
// The pure helpers in src/lib/news (rules, taxonomy) and src/lib/newsroom/checklist.ts default to it.
export const nrNewsCkb = {
  /** The story list (/newsroom/news). */
  list: {
    title: "هەواڵەکان",
    tabs: { new: "نوێ", ready: "ئامادە", done: "بڵاوکراوە" },
    /** `every` is t.billing.features.refresh(sec). */
    autoRefresh: (every: string) => `نوێکردنەوەی خۆکار: ${every}`,
    refreshing: "نوێ دەکرێتەوە…",
    statDrafts: "ئامادەکراوی ئەم مانگە",
    statSources: "سەرچاوە",
    noSources: "هیچ سەرچاوەیەکت چالاک نییە.",
    noSourcesLink: "لە ڕێکخستن سەرچاوە زیاد بکە",
    noKeywords: "GDELT و NewsData وشەی سەرەکییان دەوێت.",
    noKeywordsLink: "وشە سەرەکییەکانت دابنێ",
    /** Sources that did not answer this fetch, already joined. */
    noAnswer: (names: string) => `وەڵامی نەدایەوە: ${names}`,
    empty: "هیچ هەواڵێک لێرە نییە.",
    auto: "خۆکار",
    sourceCount: (n: number) => `${num(n)} سەرچاوە`,
    /** "Some stories come through <A> and <B>", around the linked source names. */
    attribBefore: "هەندێک هەواڵ لە ڕێگەی",
    attribAnd: " و ",
    attribAfter: "ەوە دێن.",
  },

  filters: {
    topic: "بابەت",
    allTopics: "هەموو بابەتەکان",
    region: "ناوچە",
    allRegions: "هەموو ناوچەکان",
    source: "سەرچاوە",
    allSources: "هەموو سەرچاوەکان",
  },

  /** A story's or a source's language. */
  langs: { ckb: "کوردی", ku: "کوردی", ar: "عەرەبی", en: "ئینگلیزی", tr: "تورکی" },

  /** The ids in src/lib/news/taxonomy.ts. */
  topics: {
    politics: "سیاسەت",
    economy: "ئابووری",
    security: "ئاسایش",
    sports: "وەرزش",
    health: "تەندروستی",
    tech: "زانست و تەکنەلۆژیا",
    society: "کۆمەڵگە",
    culture: "کلتوور و هونەر",
    other: "ئەوانی تر",
  },
  subtopics: {
    politics: {
      government: "حکومەت و پەرلەمان",
      elections: "هەڵبژاردن",
      diplomacy: "پەیوەندیی نێودەوڵەتی",
      parties: "پارتە سیاسییەکان",
    },
    economy: {
      energy: "نەوت و وزە",
      salaries: "مووچە و بودجە",
      markets: "بازاڕ و دراو",
      trade: "بازرگانی و وەبەرهێنان",
    },
    security: {
      conflict: "جەنگ و ململانێ",
      terrorism: "تیرۆر",
      crime: "تاوان و پۆلیس",
      accidents: "ڕووداو و کارەسات",
    },
    sports: {
      football: "تۆپی پێ",
      local: "وەرزشی کوردستان و عێراق",
      other: "وەرزشەکانی تر",
    },
    society: {
      education: "پەروەردە و خوێندن",
      environment: "ژینگە و کەشوهەوا",
      services: "کارەبا، ئاو و خزمەتگوزاری",
      humanitarian: "کۆچ و بارودۆخی مرۆیی",
    },
  },
  regions: { kurdistan: "کوردستان", iraq: "عێراق", region: "ناوچەکە", world: "جیهان" },

  /** A new desk's first steps (src/lib/newsroom/checklist.ts). */
  checklist: {
    title: "هەنگاوەکانی یەکەم",
    done: "تەواو",
    guide: "ڕێنمایی تەواو بخوێنەوە",
    steps: {
      connect: "پەیجێکی فەیسبووک، ئینستاگرام یان تیکتۆک ببەستەوە",
      brand: "لۆگۆی کەناڵەکەت دابنێ",
      sources: "وشە سەرەکییەکان یان RSSێک دابنێ",
      card: "یەکەم کارتت دروست بکە",
      publish: "یەکەم هەواڵت بڵاو بکەرەوە",
    },
  },

  /** One story: the source, the draft and the card (/newsroom/news/[id]). */
  editor: {
    sourceSec: "سەرچاوە",
    open: "کردنەوە",
    summarySec: "کورتەی کوردی",
    improve: "باشترکردن",
    dismiss: "لابردن",
    improving: "باشتر دەنووسرێتەوە… (تا ١٠ چرکە)",
    drafting: "ئامادە دەکرێت… (تا ٢٠ چرکە)",
    draftingShort: "ئامادە دەکرێت…",
    headline: "سەردێڕ",
    body: "دەق",
    kindAria: "جۆری کارت",
    kinds: { STANDARD: "ئاسایی", BREAKING: "بەپەلە", STAT: "ژمارە", QUOTE: "وتە" },
    stat: "ژمارە",
    quote: "وتە",
    speaker: "خاوەنی وتە",
    changePhoto: "گۆڕینی وێنە",
    ownPhoto: "وێنەی خۆت",
    photoNote: "تەنها وێنەی خۆتان — هیچ وێنەیەک لە سەرچاوەکان وەرناگیرێت.",
    photoTypes: "تەنها وێنەی JPG/PNG/WEBP.",
    uploadFailed: (msg: string) => `بارکردن سەرکەوتوو نەبوو: ${msg}`,
    tooLong: "دەقەکە بۆ کارتەکە درێژە. کورتی بکەرەوە.",
    cardSec: "کارت",
    saving: "پاشەکەوت دەکرێت…",
    rendering: "کارت دروست دەکرێت…",
    uploadingCard: "کارت بار دەکرێت…",
    prepare: "ئامادەکردن بۆ بڵاوکردنەوە",
    prepareHint: "دوای ئەمە پەڕەی بڵاوکردنەوە دەکرێتەوە: شوێنەکان هەڵدەبژێریت و پەسەندی دەکەیت. هیچ شتێک بێ کلیکی تۆ بڵاو نابێتەوە.",
  },

  /** The desk's legal rules (src/lib/news/rules.ts): each one blocks the card. */
  rules: {
    empty: "سەردێڕ و دەق هەردووکیان پێویستن.",
    headlineLong: (max: number) => `سەردێڕ لە ${num(max)} پیت درێژترە.`,
    bodyLong: (max: number) => `دەق لە ${num(max)} پیت درێژترە.`,
    copy: {
      headline: "سەردێڕەکە زۆر لە سەردێڕی سەرچاوەکە دەچێت. بە وشەی خۆت بینووسەوە.",
      body: "دەقەکە زۆر لە دەقی سەرچاوەکە دەچێت. بە وشەی خۆت بینووسەوە.",
      both: "سەردێڕ و دەقەکە زۆر لە سەرچاوەکە دەچن. بە وشەی خۆت بینووسەوە.",
    },
  },

  /** What the news and news-settings server actions answer with. */
  actions: {
    notNews: "ئەم بەشە تەنها بۆ پەیجی هەواڵە.",
    refreshFailed: "نوێکردنەوە سەرکەوتوو نەبوو. دووبارە هەوڵ بدەرەوە.",
    badStrength: "جۆری داواکراو دروست نییە.",
    notFound: "هەواڵەکە نەدۆزرایەوە.",
    /** The plan's monthly quota, as src/lib/billing/limits.ts words it. */
    limitDraft: (max: number) => `سنووری ئامادەکردنی هەواڵی ئەم مانگە (${num(max)}) تەواو بوو. بۆ زیاتر، پاکێجەکەت بەرز بکەرەوە.`,
    limitImprove: (max: number) => `سنووری باشترکردنی ئەم مانگە (${num(max)}) تەواو بوو. بۆ زیاتر، پاکێجەکەت بەرز بکەرەوە.`,
    limitPublish: (max: number) => `سنووری بڵاوکردنەوەی ئەم مانگە (${num(max)}) تەواو بوو. بۆ زیاتر، پاکێجەکەت بەرز بکەرەوە.`,
    frozen: "ماوەی تاقیکردنەوە تەواو بووە — بۆ بەردەوامبوون لە «پلان و پارەدان» پلانێک هەڵبژێرە.",
    aiDown: "نووسینی خۆکار ئێستا بەردەست نییە. دەتوانیت خۆت بینووسیت.",
    draftFailed: "ئامادەکردن سەرکەوتوو نەبوو. دووبارە هەوڵ بدەرەوە.",
    badKind: "جۆری کارت دروست نییە.",
    badPhoto: "وێنەکە ناناسرێتەوە.",
    saveFirst: "سەرەتا دەقەکە پاشەکەوت بکە.",
    badCard: "کارتەکە ناناسرێتەوە.",
    sourceUnavailable: "ئەم سەرچاوەیە بەردەست نییە.",
    sourceLimit: "سنووری ژمارەی سەرچاوەکانی پاکێجەکەت پڕ بووە.",
    badLink: "لینکەکە دروست نییە.",
    needName: "ناوی سەرچاوەکە بنووسە.",
    emptyFeed: "ئەم لینکە هیچ هەواڵێکی تێدا نییە.",
    notRss: "ئەم لینکە RSS نییە یان وەڵام ناداتەوە.",
    duplicate: "ئەم سەرچاوەیە پێشتر زیاد کراوە.",
    badColors: "ڕەنگەکان دروست نین.",
    badFont: "فۆنتەکە دروست نییە.",
    badLogo: "لۆگۆکە ناناسرێتەوە.",
    badAutopilot: "ڕێکخستنەکانی ئۆتۆپایلۆت دروست نین.",
    autoPlan: "بڵاوکردنەوەی خۆکار تەنها لە پلانی پرۆ و دامەزراوە بەردەستە.",
    autoTargets: "بۆ بڵاوکردنەوەی خۆکار، لانیکەم فەیسبووک یان ئینستاگرامێکی پەیوەستکراو هەڵبژێرە.",
  },

  /** News settings text that is not already in t.settings.news. */
  settings: {
    /** Source groups (GROUPS in src/lib/news/catalog.ts). */
    groups: {
      api: "گەڕان بە وشە سەرەکییەکان",
      world: "جیهانی",
      region: "ڕۆژهەڵاتی ناوەڕاست",
      kurdistan: "کوردستان",
      official: "فەرمی",
    },
    /** One line about each search API, by catalog id. */
    about: {
      gdelt: "هەواڵی جیهان بە +٦٥ زمان، بەپێی وشە سەرەکییەکانت. بەخۆڕایی.",
      newsdata: "هەواڵی عەرەبی و ئینگلیزی بەپێی وشە سەرەکییەکانت. ١٢ کاتژمێر دواکەوتوو.",
    },
  },
};

export type NrNewsText = typeof nrNewsCkb;
