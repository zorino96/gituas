// Made-up data for /dev/chat-first?kind=news: a news desk's chat in all three languages. Same shapes as the shop's words (fixtures.ts), so the
// one pretend server and the one set of scenarios serve both. Every link points into /newsroom: the desk's chat never links to /app.

import type { Words } from "./fixtures";
import type { Lang } from "@/lib/i18n/lang";

const ckb: Words = {
  shop: "ڕۆژنامەی ئاسۆ",
  title: "هەواڵەکانی ئەمڕۆ",
  userOrders: "ئەمڕۆ چ هەواڵێکی نوێ هەیە؟",
  replyOrders: "ئەمڕۆ ٨ هەواڵی نوێ هاتووە و ٢ ڕەشنووس ئامادەن بۆ بڵاوکردنەوە. ئەمە کورتەی ئەمڕۆیە:",
  stats: {
    kind: "stats",
    title: "کورتەی ئەمڕۆ",
    items: [
      { label: "هەواڵی نوێ", value: "٨" },
      { label: "ڕەشنووسی ئامادە", value: "٢" },
      { label: "بڵاوکراوە ئەمڕۆ", value: "١" },
      { label: "خشتەکراو", value: "٣" },
    ],
    href: "/newsroom/news",
  },
  table: {
    kind: "table",
    title: "نوێترین هەواڵەکان",
    columns: ["هەواڵ", "سەرچاوە", "تەمەن", "دۆخ"],
    rows: [
      ["شاندی هەرێم گەیشتە بەغدا بۆ گفتوگۆی بودجە", "Rudaw", "٢ کاتژمێر", "نوێ"],
      ["Sara Ahmed opens a new tech hub in Erbil with more than 200 workstations", "BBC Arabic", "٣ کاتژمێر", "ڕەشنووس"],
      ["نرخی دۆلار لە بازاڕەکانی سلێمانی", "Kurdistan24", "٥ کاتژمێر", "نوێ"],
    ],
    more: 5,
    href: "/newsroom/news",
  },
  list: {
    kind: "list",
    title: "کۆمێنتی بێ وەڵام",
    items: [
      { title: "ئەم هەواڵە ڕاستە؟ سەرچاوەکەی چییە؟", sub: "فەیسبووک · ٢ کاتژمێر لەمەوبەر", badge: "نوێ", href: "/newsroom/comments" },
      { title: "سوپاس بۆ هەواڵەکە، تکایە بەردەوام بن", sub: "ئینستاگرام · ٥ کاتژمێر لەمەوبەر", href: "/newsroom/comments" },
    ],
  },
  userPost: "ئەم هەواڵەی بودجە ئەمشەو کاتژمێر ٩ لە فەیسبووک و ئینستاگرام بڵاو بکەرەوە",
  replyPost: "ئەمە بڵاوکردنەوەکەیە. ئەگەر دروستە «پەسەندکردن» بکە:",
  cardLines: [
    { label: "لە کوێ", value: "فەیسبووک، ئینستاگرام" },
    { label: "کەی (کاتی بەغدا)", value: "ئەمشەو ٩:٠٠" },
    { label: "سەردێڕ", value: "شاندی هەرێم گەیشتە بەغدا بۆ گفتوگۆی بودجە" },
    { label: "دەق", value: "شاندێکی حکومەتی هەرێمی کوردستان ئەمڕۆ گەیشتە بەغدا بۆ گفتوگۆ لەسەر بودجەی ساڵی داهاتوو #بودجە #هەولێر #erbil" },
  ],
  titles: { schedule: "خشتەکردنی هەواڵ", picture: "نووسینی هەواڵ", setting: "بڵاوکردنەوەی خۆکار", reply: "وەڵامی کۆمێنت", price: "دیزاین و لۆگۆ", failed: "بڵاوکردنەوەی ئێستا", remove: "لابردنی هەواڵ" },
  results: { done: "هەواڵەکە خشتە کرا بۆ ئەمشەو ٩:٠٠.", auto: "بڵاوکردنەوەی خۆکار نوێ کرایەوە.", failed: "فەیسبووک پۆستەکەی وەرنەگرت: بەستنەوەکە بەسەرچووە.", cancelled: "هەڵوەشێنرایەوە" },
  warn: "ئەم هەواڵانە لە سەرچاوە دەرەکییەکانەوە هاتوون: بەهاکان بپشکنە.",
  long: "ئەمە نموونەیەکی زۆر درێژە بۆ تاقیکردنەوەی دابەشبوونی دێڕەکان: https://hawalnoos.com/newsroom/news?tab=ready&category=politics&region=erbil&sort=newest&page=2&utm_source=assistant ، و وشەیەکی بێ بۆشایی SuperCaliFragilisticExpialidociousAndAnEvenLongerWordThatHasNoSpacesAtAll_1234567890_abcdefghijklmnopqrstuvwxyz.\n\nپاراگرافی دووەم: ژمارە و ناوی لاتینی وەک Rudaw، BBC Arabic و 0750 123 4567 نابێت دیزاینەکە تێکبدەن.",
  status: ["سەیری هەواڵەکان دەکەم…", "نزیکترینەکان هەڵدەبژێرم…"],
  final: "ئەمڕۆ ٨ هەواڵی نوێ هاتووە. ئەمە نوێترینەکانن:",
  quick: "ئەمانە نوێترین هەواڵەکانن:",
  threads: ["هەواڵەکانی ئەمڕۆ", "بودجەی هەرێم", "کارتی هەواڵی ئابووری", "وەڵامی کۆمێنتەکان", "بڵاوکردنەوەی خۆکار", "ڤیدیۆی هەواڵ", "سەرچاوە نوێکان", "ئامارەکانی هەفتە", "Breaking news template", "خشتەکردنی هەواڵەکانی هەفتە", "لۆگۆ و ڕەنگەکان", "کۆمێنتی سپام", "فلتەری وشە سەرەکییەکان", "هەواڵی وەرزش", "نامەی بینەران", "شێوازی نووسین"],
};

const ar: Words = {
  shop: "صحيفة آسو",
  title: "أخبار اليوم",
  userOrders: "ما الأخبار الجديدة اليوم؟",
  replyOrders: "وصلت اليوم 8 أخبار جديدة، ومسودتان جاهزتان للنشر. هذا ملخص اليوم:",
  stats: {
    kind: "stats",
    title: "ملخص اليوم",
    items: [
      { label: "أخبار جديدة", value: "٨" },
      { label: "مسودات جاهزة", value: "٢" },
      { label: "نُشر اليوم", value: "١" },
      { label: "مجدول", value: "٣" },
    ],
    href: "/newsroom/news",
  },
  table: {
    kind: "table",
    title: "أحدث الأخبار",
    columns: ["الخبر", "المصدر", "العمر", "الحالة"],
    rows: [
      ["وفد الإقليم يصل إلى بغداد لمناقشة الموازنة", "Rudaw", "ساعتان", "جديد"],
      ["Sara Ahmed opens a new tech hub in Erbil with more than 200 workstations", "BBC Arabic", "3 ساعات", "مسودة"],
      ["سعر الدولار في أسواق السليمانية", "Kurdistan24", "5 ساعات", "جديد"],
    ],
    more: 5,
    href: "/newsroom/news",
  },
  list: {
    kind: "list",
    title: "تعليقات بلا رد",
    items: [
      { title: "هل هذا الخبر صحيح؟ ما مصدره؟", sub: "فيسبوك · قبل ساعتين", badge: "جديد", href: "/newsroom/comments" },
      { title: "شكرًا على الخبر، تابعوا من فضلكم", sub: "إنستغرام · قبل 5 ساعات", href: "/newsroom/comments" },
    ],
  },
  userPost: "انشر خبر الموازنة هذا الليلة الساعة 9 على فيسبوك وإنستغرام",
  replyPost: "هذا هو المنشور. إن كان صحيحًا اضغط «موافقة»:",
  cardLines: [
    { label: "أين", value: "فيسبوك، إنستغرام" },
    { label: "متى (بتوقيت بغداد)", value: "الليلة 9:00" },
    { label: "العنوان", value: "وفد الإقليم يصل إلى بغداد لمناقشة الموازنة" },
    { label: "النص", value: "وصل وفد من حكومة إقليم كردستان اليوم إلى بغداد لمناقشة موازنة العام المقبل #الموازنة #أربيل #erbil" },
  ],
  titles: { schedule: "جدولة خبر", picture: "كتابة خبر", setting: "النشر التلقائي", reply: "الرد على تعليق", price: "التصميم والشعار", failed: "النشر الآن", remove: "إزالة خبر" },
  results: { done: "تمت جدولة الخبر الليلة 9:00.", auto: "تم تحديث النشر التلقائي.", failed: "رفض فيسبوك المنشور: انتهت صلاحية الربط.", cancelled: "أُلغي" },
  warn: "جاءت هذه الأخبار من مصادر خارجية: تحقق من القيم.",
  long: "هذا مثال طويل جدًا لاختبار التفاف الأسطر: https://hawalnoos.com/newsroom/news?tab=ready&category=politics&region=erbil&sort=newest&page=2&utm_source=assistant ، وكلمة بلا فراغات SuperCaliFragilisticExpialidociousAndAnEvenLongerWordThatHasNoSpacesAtAll_1234567890_abcdefghijklmnopqrstuvwxyz.\n\nالفقرة الثانية: أسماء لاتينية وأرقام مثل Rudaw وBBC Arabic و0750 123 4567 يجب ألا تكسر التصميم.",
  status: ["أنظر في الأخبار…", "أختار أقربها…"],
  final: "وصلت اليوم 8 أخبار جديدة. هذه أحدثها:",
  quick: "هذه أحدث الأخبار:",
  threads: ["أخبار اليوم", "موازنة الإقليم", "بطاقة خبر اقتصادي", "الرد على التعليقات", "النشر التلقائي", "فيديو الخبر", "مصادر جديدة", "إحصاءات الأسبوع", "Breaking news template", "جدولة أخبار الأسبوع", "الشعار والألوان", "تعليقات مزعجة", "فلتر الكلمات المفتاحية", "أخبار الرياضة", "رسائل المتابعين", "أسلوب الكتابة"],
};

const en: Words = {
  shop: "Aso Gazette",
  title: "Today's stories",
  userOrders: "What new stories are there today?",
  replyOrders: "8 new stories came in today and 2 drafts are ready to publish. Here is today at a glance:",
  stats: {
    kind: "stats",
    title: "Today at a glance",
    items: [
      { label: "New stories", value: "8" },
      { label: "Drafts ready", value: "2" },
      { label: "Published today", value: "1" },
      { label: "Scheduled", value: "3" },
    ],
    href: "/newsroom/news",
  },
  table: {
    kind: "table",
    title: "Latest stories",
    columns: ["Story", "Source", "Age", "State"],
    rows: [
      ["Regional delegation arrives in Baghdad for budget talks", "Rudaw", "2 hours", "New"],
      ["Sara Ahmed opens a new tech hub in Erbil with more than 200 workstations", "BBC Arabic", "3 hours", "Draft"],
      ["Dollar rate in Sulaymaniyah markets", "Kurdistan24", "5 hours", "New"],
    ],
    more: 5,
    href: "/newsroom/news",
  },
  list: {
    kind: "list",
    title: "Comments without a reply",
    items: [
      { title: "Is this story true? What is the source?", sub: "Facebook · 2 hours ago", badge: "New", href: "/newsroom/comments" },
      { title: "Thanks for the story, please keep going", sub: "Instagram · 5 hours ago", href: "/newsroom/comments" },
    ],
  },
  userPost: "Publish this budget story tonight at 9 on Facebook and Instagram",
  replyPost: "Here is the post. If it is right, press Confirm:",
  cardLines: [
    { label: "Where", value: "Facebook, Instagram" },
    { label: "When (Baghdad time)", value: "Tonight 9:00 PM" },
    { label: "Headline", value: "Regional delegation arrives in Baghdad for budget talks" },
    { label: "Text", value: "A delegation from the Kurdistan Regional Government arrived in Baghdad today for talks on next year's budget #budget #erbil #iraq" },
  ],
  titles: { schedule: "Schedule a story", picture: "Write a story", setting: "Automatic publishing", reply: "Reply to a comment", price: "Design and logo", failed: "Publish now", remove: "Remove a story" },
  results: { done: "The story is scheduled for tonight at 9:00 PM.", auto: "Automatic publishing is updated.", failed: "Facebook did not take the post: the connection has expired.", cancelled: "Cancelled" },
  warn: "These stories came from outside sources: check the values.",
  long: "This is a very long example to test how lines wrap: https://hawalnoos.com/newsroom/news?tab=ready&category=politics&region=erbil&sort=newest&page=2&utm_source=assistant , and a word with no spaces SuperCaliFragilisticExpialidociousAndAnEvenLongerWordThatHasNoSpacesAtAll_1234567890_abcdefghijklmnopqrstuvwxyz.\n\nSecond paragraph: Kurdish names like ئارام and numbers like 0750 123 4567 must not break the layout.",
  status: ["Looking at the stories…", "Picking the closest ones…"],
  final: "8 new stories came in today. These are the latest:",
  quick: "These are the newest stories:",
  threads: ["Today's stories", "Regional budget", "Economy story card", "Replying to comments", "Automatic publishing", "Story video", "New sources", "This week's numbers", "Breaking news template", "Schedule the week's stories", "Logo and colours", "Spam comments", "Keyword filter", "Sports stories", "Viewer messages", "Writing style"],
};

export const NEWS_WORDS: Record<Lang, Words> = { ckb, ar, en };

/** A story card, drawn as a picture: what make_story_card hands back (a news-blue card with a headline and a red mark). */
export const NEWS_PICTURE = {
  url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a5bd7"/><stop offset="1" stop-color="#0c1a45"/></linearGradient></defs><rect width="600" height="600" fill="url(#g)"/><rect x="48" y="400" width="150" height="18" rx="4" fill="#e0262f"/><rect x="48" y="440" width="504" height="22" rx="11" fill="#ffffff" opacity="0.9"/><rect x="48" y="480" width="420" height="22" rx="11" fill="#ffffff" opacity="0.7"/><rect x="48" y="520" width="260" height="22" rx="11" fill="#ffffff" opacity="0.5"/></svg>`,
  )}`,
  pathname: "merchant/dev/chat/story-card.jpg",
  kind: "image" as const,
  name: "Story card",
};
