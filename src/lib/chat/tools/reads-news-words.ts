// The words the news desk's read tools show the PERSON that the app's dictionary (src/lib/i18n) does not already have. Sorani, Arabic and
// English: a new key must be written in all three, and the type checker refuses an object that lacks one. Wherever the desk's screens
// already have the word (section names, topics, regions, plan features, the settings labels) the tools take it from dict(lang), so the
// chat says exactly what the screen says; only the rest is here.

import type { Lang } from "@/lib/i18n/lang";

export interface NewsWords {
  /** What the person sees while a tool works. */
  working: Record<string, string>;
  // the desk
  deskTitle: string;
  frozenShort: string;
  openPlan: string;
  newStories: string;
  readyStories: string;
  publishedToday: string;
  scheduledPosts: string;
  failedPosts: string;
  lastRefresh: string;
  neverRefreshed: string;
  // a story
  stateNew: string;
  stateDrafted: string;
  stateCard: string;
  statePublished: string;
  stateDismissed: string;
  language: string;
  sourceText: string;
  draftTitle: string;
  cardRow: string;
  cardMade: string;
  cardMissing: string;
  noDraft: string;
  whereTitle: string;
  posted: string;
  videoRow: string;
  photoRow: string;
  yes: string;
  no: string;
  none: string;
  /** NewsVideo.status in words. */
  videoStatus: Record<string, string>;
  // insights
  storiesReceived: string;
  draftsMade: string;
  madeByAuto: string;
  storiesPublished: string;
  videosMade: string;
  failedPostsLabel: string;
  // plan and usage (the "today / this month" counters)
  framesAi: string;
  focusChanges: string;
  voicePreviews: string;
  chatTurns: string;
  changesLeft: string;
  postsLeft: string;
  // settings
  areas: Record<"sources" | "filter" | "autopilot" | "video" | "brand" | "accounts" | "library", string>;
  ownFeeds: string;
  keywordFilterRow: string;
  photoCardsOnlyRow: string;
  planAllows: string;
  levelNone: string;
  levelFocus: string;
  levelFull: string;
  matchingRow: string;
  modeRow: string;
  styleRow: string;
  targetsRow: string;
  quietNone: string;
  colours: string;
  aiFramesRow: string;
}

const ckb: NewsWords = {
  working: {
    get_desk_state: "تەماشای باری مێزی هەواڵەکەت دەکەم…",
    list_stories: "هەواڵەکان دەپشکنم…",
    get_story: "هەواڵەکە دەکەمەوە…",
    list_news_videos: "ڤیدیۆکان دەپشکنم…",
    get_desk_insights: "ئامارەکان کۆدەکەمەوە…",
    get_desk_settings: "ڕێکخستنەکان دەخوێنمەوە…",
    get_desk_usage: "بەکارهێنانی پلانەکەت دەپشکنم…",
  },
  deskTitle: "مێزی هەواڵەکەت",
  frozenShort: "تەنها خوێندنەوە (تاقیکردنەوە تەواو بووە)",
  openPlan: "بێ بەرواری کۆتایی",
  newStories: "هەواڵی نوێ",
  readyStories: "ڕەشنووسی ئامادە",
  publishedToday: "ئەمڕۆ بڵاوکراوەتەوە",
  scheduledPosts: "پۆستی خشتەکراو",
  failedPosts: "پۆستی سەرنەکەوتوو (دوو هەفتەی ڕابردوو)",
  lastRefresh: "دوایین نوێکردنەوە",
  neverRefreshed: "هێشتا نا",
  stateNew: "نوێ",
  stateDrafted: "ڕەشنووس نووسراوە",
  stateCard: "کارت ئامادەیە",
  statePublished: "بڵاوکراوەتەوە",
  stateDismissed: "لابراوە",
  language: "زمان",
  sourceText: "دەقی سەرچاوە",
  draftTitle: "ڕەشنووس",
  cardRow: "کارت",
  cardMade: "دروستکراوە",
  cardMissing: "هێشتا دروست نەکراوە",
  noDraft: "هێشتا ڕەشنووس نییە.",
  whereTitle: "بۆ کوێ بڵاوکرایەوە",
  posted: "بڵاوکرایەوە",
  videoRow: "ڤیدیۆ",
  photoRow: "وێنە",
  yes: "بەڵێ",
  no: "نەخێر",
  none: "هیچ",
  videoStatus: {
    QUEUED: "چاوەڕێی دەستپێکردنە",
    VOICED: "دەنگ تۆمارکراوە",
    RENDERING: "ڤیدیۆ دروست دەکرێت",
    RENDERED: "ئامادەیە",
    POSTING: "بڵاو دەکرێتەوە",
    POSTED: "بڵاوکرایەوە",
    FAILED: "سەرنەکەوت",
    CARD: "لە جیاتی ڤیدیۆ کارت بڵاوکرایەوە",
  },
  storiesReceived: "هەواڵی وەرگیراو",
  draftsMade: "ڕەشنووسی نووسراو",
  madeByAuto: "نووسراو لەلایەن بڵاوکردنەوەی خۆکارەوە",
  storiesPublished: "هەواڵی بڵاوکراو",
  videosMade: "ڤیدیۆی دروستکراو",
  failedPostsLabel: "پۆستی سەرنەکەوتوو",
  framesAi: "چوارچێوەی AI · ئەمڕۆ / ئەم مانگە",
  focusChanges: "گۆڕینی پڕۆمپتی هەواڵ · ئەمڕۆ / ئەم مانگە",
  voicePreviews: "گوێگرتن لە دەنگ · ئەمڕۆ / ئەم مانگە",
  chatTurns: "گفتوگۆی ماوە لەگەڵ یاریدەدەر · ئەمڕۆ / ئەم مانگە",
  changesLeft: "گۆڕانکاری ماوە بۆ یاریدەدەر (ئەمڕۆ)",
  postsLeft: "بڵاوکردنەوەی ماوە بۆ یاریدەدەر (ئەمڕۆ)",
  areas: {
    sources: "سەرچاوەکان",
    filter: "کام هەواڵ بهێنرێت",
    autopilot: "بڵاوکردنەوەی خۆکار",
    video: "ڤیدیۆ",
    brand: "دیزاین و لۆگۆ",
    accounts: "پەیج و هەژمارەکان",
    library: "وێنە و ڤیدیۆی خۆت",
  },
  ownFeeds: "RSSی خۆت",
  keywordFilterRow: "وشە سەرەکییەکان RSSیش فلتەر دەکەن",
  photoCardsOnlyRow: "تەنها کارتی وێنەدار",
  planAllows: "پلانەکەت ڕێگە دەدات بە",
  levelNone: "تەنها وشە سەرەکی",
  levelFocus: "یەک پڕۆمپت",
  levelFull: "پڕۆمپتی ویستن و نەویستن، توند یان فراوان",
  matchingRow: "هاوتاکردن",
  modeRow: "دۆخ",
  styleRow: "جۆری ڤیدیۆ",
  targetsRow: "بڵاو دەکاتەوە بۆ",
  quietNone: "نییە",
  colours: "ڕەنگەکان",
  aiFramesRow: "دیزاینی چوارچێوە بە AI",
};

const ar: NewsWords = {
  working: {
    get_desk_state: "أطّلع على حالة مكتب الأخبار…",
    list_stories: "أراجع الأخبار…",
    get_story: "أفتح الخبر…",
    list_news_videos: "أراجع الفيديوهات…",
    get_desk_insights: "أجمع الإحصاءات…",
    get_desk_settings: "أقرأ الإعدادات…",
    get_desk_usage: "أتحقق من استخدام باقتك…",
  },
  deskTitle: "مكتب أخبارك",
  frozenShort: "للقراءة فقط (انتهت التجربة)",
  openPlan: "بلا تاريخ انتهاء",
  newStories: "أخبار جديدة",
  readyStories: "مسودات جاهزة",
  publishedToday: "نُشرت اليوم",
  scheduledPosts: "منشورات مجدولة",
  failedPosts: "منشورات فاشلة (آخر أسبوعين)",
  lastRefresh: "آخر تحديث",
  neverRefreshed: "لم يحدث بعد",
  stateNew: "جديد",
  stateDrafted: "كُتبت مسودة",
  stateCard: "البطاقة جاهزة",
  statePublished: "نُشر",
  stateDismissed: "مستبعد",
  language: "اللغة",
  sourceText: "نص المصدر",
  draftTitle: "المسودة",
  cardRow: "البطاقة",
  cardMade: "جاهزة",
  cardMissing: "لم تُصنع بعد",
  noDraft: "لا توجد مسودة بعد.",
  whereTitle: "أين نُشر",
  posted: "نُشر",
  videoRow: "الفيديو",
  photoRow: "الصورة",
  yes: "نعم",
  no: "لا",
  none: "لا شيء",
  videoStatus: {
    QUEUED: "بانتظار البدء",
    VOICED: "سُجّل الصوت",
    RENDERING: "يجري إنتاج الفيديو",
    RENDERED: "جاهز",
    POSTING: "قيد النشر",
    POSTED: "نُشر",
    FAILED: "فشل",
    CARD: "نُشرت البطاقة بدل الفيديو",
  },
  storiesReceived: "أخبار وردت",
  draftsMade: "مسودات مكتوبة",
  madeByAuto: "كتبها النشر التلقائي",
  storiesPublished: "أخبار منشورة",
  videosMade: "فيديوهات منتَجة",
  failedPostsLabel: "منشورات فاشلة",
  framesAi: "إطارات الذكاء الاصطناعي · اليوم / هذا الشهر",
  focusChanges: "تغييرات توجيه الأخبار · اليوم / هذا الشهر",
  voicePreviews: "معاينات الصوت · اليوم / هذا الشهر",
  chatTurns: "محادثات متبقية مع المساعد · اليوم / هذا الشهر",
  changesLeft: "تغييرات متبقية للمساعد (اليوم)",
  postsLeft: "منشورات متبقية للمساعد (اليوم)",
  areas: {
    sources: "المصادر",
    filter: "أي أخبار تُجلب",
    autopilot: "النشر التلقائي",
    video: "الفيديو",
    brand: "التصميم والشعار",
    accounts: "الصفحات والحسابات",
    library: "صورك ولقطاتك",
  },
  ownFeeds: "تغذيات RSS الخاصة بك",
  keywordFilterRow: "الكلمات المفتاحية تُصفّي RSS أيضًا",
  photoCardsOnlyRow: "بطاقات الصور فقط",
  planAllows: "ما تتيحه باقتك",
  levelNone: "الكلمات المفتاحية فقط",
  levelFocus: "توجيه واحد",
  levelFull: "توجيه للمطلوب والمستبعد، صارم أو موسّع",
  matchingRow: "المطابقة",
  modeRow: "الوضع",
  styleRow: "نمط الفيديو",
  targetsRow: "ينشر إلى",
  quietNone: "لا يوجد",
  colours: "الألوان",
  aiFramesRow: "تصميم الإطار بالذكاء الاصطناعي",
};

const en: NewsWords = {
  working: {
    get_desk_state: "Looking at your desk…",
    list_stories: "Looking at the stories…",
    get_story: "Opening the story…",
    list_news_videos: "Checking the videos…",
    get_desk_insights: "Gathering the insights…",
    get_desk_settings: "Reading the settings…",
    get_desk_usage: "Checking your plan usage…",
  },
  deskTitle: "Your news desk",
  frozenShort: "Read only (trial ended)",
  openPlan: "No end date",
  newStories: "New stories",
  readyStories: "Drafts ready",
  publishedToday: "Published today",
  scheduledPosts: "Scheduled posts",
  failedPosts: "Failed posts (last two weeks)",
  lastRefresh: "Last refresh",
  neverRefreshed: "Not yet",
  stateNew: "New",
  stateDrafted: "Draft written",
  stateCard: "Card ready",
  statePublished: "Published",
  stateDismissed: "Dismissed",
  language: "Language",
  sourceText: "Source text",
  draftTitle: "Draft",
  cardRow: "Card",
  cardMade: "Made",
  cardMissing: "Not made yet",
  noDraft: "No draft yet.",
  whereTitle: "Where it went",
  posted: "Posted",
  videoRow: "Video",
  photoRow: "Photo",
  yes: "Yes",
  no: "No",
  none: "None",
  videoStatus: {
    QUEUED: "Waiting to start",
    VOICED: "Voice recorded",
    RENDERING: "Making the video",
    RENDERED: "Ready",
    POSTING: "Posting",
    POSTED: "Posted",
    FAILED: "Failed",
    CARD: "The card went out instead",
  },
  storiesReceived: "Stories received",
  draftsMade: "Drafts written",
  madeByAuto: "Written by the autopilot",
  storiesPublished: "Stories published",
  videosMade: "Videos made",
  failedPostsLabel: "Failed posts",
  framesAi: "AI frames · today / this month",
  focusChanges: "News prompt changes · today / this month",
  voicePreviews: "Voice previews · today / this month",
  chatTurns: "Assistant chats left · today / this month",
  changesLeft: "Changes the assistant may still make today",
  postsLeft: "Posts the assistant may still make today",
  areas: {
    sources: "Sources",
    filter: "Which news to bring",
    autopilot: "Automatic publishing",
    video: "Video",
    brand: "Design and logo",
    accounts: "Pages and accounts",
    library: "Your photos and footage",
  },
  ownFeeds: "Your own RSS feeds",
  keywordFilterRow: "Keywords also filter RSS",
  photoCardsOnlyRow: "Photo cards only",
  planAllows: "Your plan allows",
  levelNone: "Keywords only",
  levelFocus: "One prompt",
  levelFull: "Bring and exclude prompts, strict or broad",
  matchingRow: "Matching",
  modeRow: "Mode",
  styleRow: "Video style",
  targetsRow: "Posts to",
  quietNone: "None",
  colours: "Colours",
  aiFramesRow: "AI frame design",
};

/** The words for a language. */
export function newsWords(lang: Lang): NewsWords {
  return lang === "ar" ? ar : lang === "en" ? en : ckb;
}
