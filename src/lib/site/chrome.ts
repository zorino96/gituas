// The words around the website's content: navigation, buttons, labels, the pricing and About pages' own text.
// Hand-written in the three languages; the long-form copy is in content/*.json.

import type { SiteLang } from "./langs";

export interface Chrome {
  brand: string;
  nav: { features: string; guides: string; pricing: string; about: string; signIn: string; start: string; menu: string; skip: string };
  home: string;
  sections: { how: string; features: string; audience: string; faq: string; more: string; plans: string; read: string };
  guides: { title: string; metaTitle: string; intro: string; read: string; keyFacts: string; steps: string; faq: string; related: string; updated: string };
  about: { metaTitle: string; metaDescription: string; title: string; paragraphs: string[]; contactTitle: string; contact: string };
  pricing: {
    metaTitle: string;
    metaDescription: string;
    title: string;
    intro: string;
    perMonth: string;
    free: string;
    forShop: string;
    compare: string;
    checked: (date: string) => string;
    rows: {
      price: string;
      posts: string;
      allPosts: string;
      replies: string;
      ai: string;
      voice: string;
      boost: string;
      video: string;
      pictures: string;
      accounts: string;
      model: string;
      fast: string;
      opus: string;
      none: string;
    };
    units: { perDay: string; perMonth: string; newest: (n: number) => string; ads: string; pics: string };
    plans: Record<"FREE" | "MERCHANT" | "PRO" | "MAX", { name: string; blurb: string }>;
    /** What the numbers in the table are: ceilings on one shared allowance. */
    notes: string[];
    faq: (maxOpen: boolean) => { q: string; a: string }[];
    payTitle: string;
    payBody: string;
  };
  cta: { start: string; startFree: string; read: string };
  footer: { product: string; legal: string; privacy: string; terms: string; dataDeletion: string; newsroom: string; tagline: string; rights: string };
  langName: string;
}

const en: Chrome = {
  brand: "Gituas",
  nav: { features: "Features", guides: "Guides", pricing: "Pricing", about: "About", signIn: "Sign in", start: "Start free", menu: "Menu", skip: "Skip to content" },
  home: "Home",
  sections: { how: "How it works", features: "What Gituas does", audience: "Who it is for", faq: "Frequently asked questions", more: "See all plans and limits", plans: "Plans", read: "Read the guide" },
  guides: {
    title: "Guides",
    metaTitle: "Guides: automatic replies, orders and video ads for shops in Kurdistan and Iraq | Gituas",
    intro: "Practical guides for shops that sell on Facebook and Instagram in Kurdistan and Iraq.",
    read: "Read the guide",
    keyFacts: "Key facts",
    steps: "Steps",
    faq: "Questions and answers",
    related: "Related guides",
    updated: "Updated",
  },
  about: {
    metaTitle: "About Gituas: an AI assistant for shops in Kurdistan and Iraq",
    metaDescription: "Who Gituas is for, how it works in Kurdistan and Iraq, how to contact the team, and what Gituas is not affiliated with.",
    title: "About Gituas",
    paragraphs: [
      "Gituas (Kurdish: گیتواس) is an AI assistant for shops and businesses that sell on Facebook and Instagram in Kurdistan and Iraq. It answers comments and messages in Kurdish and Arabic, collects orders, and makes video ads and pictures with AI.",
      "It is built for how selling works in Kurdistan and Iraq: a comment under a post, a direct message, then cash on delivery. The interface is in Kurdish (Sorani), Arabic and English, and plans are priced in Iraqi dinar and paid through Wayl.",
      "The same team makes Hawalnoos (هەواڵنووس) at hawalnoos.com, a newsroom tool for news agencies and news pages.",
      "Gituas is an independent product. It is not made, endorsed or sponsored by Meta, TikTok or Google. Facebook, Instagram, WhatsApp, TikTok and YouTube are trademarks of their owners.",
    ],
    contactTitle: "Contact",
    contact: "Email hello@gituas.com, or write to support on WhatsApp at +964 771 010 6009, in Kurdish, Arabic or English.",
  },
  pricing: {
    metaTitle: "Gituas pricing in Iraqi dinar: Free, Merchant and Pro plans",
    metaDescription: "Gituas costs 0 IQD on the Free plan, 15,000 IQD a month for Merchant and 25,000 IQD for Pro, per shop. Pay with FIB, ZainCash, QiCard, FastPay or card.",
    title: "Gituas pricing in Iraqi dinar",
    intro:
      "Gituas, an AI assistant for shops that sell on Facebook and Instagram in Kurdistan and Iraq, costs 0 IQD on the Free plan, 15,000 IQD a month on Merchant and 25,000 IQD a month on Pro, per shop, paid in Iraqi dinar through Wayl. A shop is one connected Facebook Page or Instagram account. The Free plan has no time limit.",
    perMonth: "per shop per month",
    free: "Free",
    forShop: "per shop",
    compare: "Compare the plans",
    checked: (d) => `Prices and limits checked on ${d}.`,
    rows: {
      price: "Price",
      posts: "Automatic replies on",
      allPosts: "all posts",
      replies: "Automatic replies per day, up to",
      ai: "AI-written replies per month, up to",
      voice: "Buyer voice notes read per day, up to",
      boost: "Boost analyses per day, up to",
      video: "AI video ads per month, up to",
      pictures: "AI pictures per month, up to",
      accounts: "Accounts you can connect, per platform",
      model: "AI model",
      fast: "Standard AI model",
      opus: "Strongest model (Claude Opus), within a monthly share",
      none: "Not included",
    },
    units: { perDay: "a day", perMonth: "a month", newest: (n) => `the newest ${n} posts`, ads: "videos", pics: "pictures" },
    plans: {
      FREE: { name: "Free", blurb: "Try automatic replies on your newest posts." },
      MERCHANT: { name: "Merchant", blurb: "Replies on 25 posts, voice notes, AI videos and pictures." },
      PRO: { name: "Pro", blurb: "Replies on every post, with more room for videos and pictures." },
      MAX: { name: "Max", blurb: "The most room, and the strongest AI model for replies and scripts." },
    },
    notes: [
      "Automatic replies are the answers Gituas sends by itself from your product data, templates and rules; the daily number is their cap. AI-written replies are the ones the AI composes in your own words and are counted separately each month.",
      "AI features of a workspace share one monthly AI allowance, and every paid shop adds its plan's share. The numbers above are ceilings: when the allowance is used up, AI features pause until next month while fixed replies and rules keep answering.",
      "Plans are bought per shop. The number of accounts you may connect is per platform (Facebook, Instagram, TikTok, YouTube) and follows the best plan in the workspace.",
    ],
    faq: (maxOpen) => [
      {
        q: "How much does Gituas cost?",
        a: `The Free plan costs nothing and has no time limit. Merchant is 15,000 Iraqi dinar a month and Pro is 25,000 Iraqi dinar a month, per shop.${maxOpen ? " Max is 59,000 Iraqi dinar a month." : ""}`,
      },
      { q: "What counts as a shop?", a: "One connected Facebook Page or Instagram account is one shop. A plan is bought per shop and also covers publishing to TikTok and YouTube for it." },
      { q: "How do I pay?", a: "In Iraqi dinar through Wayl: FIB, ZainCash, QiCard, FastPay or a card. Each paid plan lasts 30 days." },
      { q: "What happens if I do not renew?", a: "The shop goes back to the Free plan: automatic replies on the newest 3 posts and up to 100 replies a day." },
    ],
    payTitle: "Paying in Iraq",
    payBody: "Payment is in Iraqi dinar through Wayl, which accepts FIB, ZainCash, QiCard, FastPay and cards. There is nothing to pay to start on the Free plan.",
  },
  cta: { start: "Start free", startFree: "Start free, no card needed", read: "Read more" },
  footer: {
    product: "Product",
    legal: "Legal",
    privacy: "Privacy policy",
    terms: "Terms",
    dataDeletion: "Data deletion",
    newsroom: "Hawalnoos, for news agencies and news pages",
    tagline: "Gituas (گیتواس): AI replies, orders and video ads for shops in Kurdistan and Iraq.",
    rights: "Gituas",
  },
  langName: "English",
};

const ku: Chrome = {
  brand: "گیتواس",
  nav: { features: "تایبەتمەندییەکان", guides: "ڕێنماییەکان", pricing: "نرخەکان", about: "دەربارە", signIn: "چوونەژوورەوە", start: "بەخۆڕایی دەست پێبکە", menu: "لیست", skip: "بڕۆ بۆ ناوەڕۆک" },
  home: "سەرەکی",
  sections: { how: "چۆن کار دەکات", features: "گیتواس چی دەکات", audience: "بۆ کێیە", faq: "پرسیارە باوەکان", more: "هەموو پلانەکان و سنوورەکان ببینە", plans: "پلانەکان", read: "ڕێنماییەکە بخوێنەوە" },
  guides: {
    title: "ڕێنماییەکان",
    metaTitle: "ڕێنمایی: وەڵامی خۆکار، داواکاری و ڤیدیۆی ڕیکلام بۆ دوکانەکانی کوردستان و عێراق | گیتواس",
    intro: "ڕێنمایی کرداری بۆ ئەو دوکانانەی لە کوردستان و عێراق لە فەیسبووک و ئینستاگرام دەفرۆشن.",
    read: "ڕێنماییەکە بخوێنەوە",
    keyFacts: "خاڵە سەرەکییەکان",
    steps: "هەنگاوەکان",
    faq: "پرسیار و وەڵام",
    related: "ڕێنمایی پەیوەندیدار",
    updated: "نوێکراوەتەوە",
  },
  about: {
    metaTitle: "دەربارەی گیتواس: یاریدەدەری AI بۆ دوکانەکانی کوردستان و عێراق",
    metaDescription: "گیتواس بۆ کێیە، لە کوردستان و عێراق چۆن کار دەکات، چۆن پەیوەندی بە تیمەکەوە بکەیت، و بە کێوە پەیوەست نییە.",
    title: "دەربارەی گیتواس",
    paragraphs: [
      "گیتواس (Gituas) یاریدەدەرێکی زیرەکیی دەستکردە بۆ ئەو دوکان و کارەکانەی لە کوردستان و عێراق لە فەیسبووک و ئینستاگرام دەفرۆشن. بە کوردی و عەرەبی وەڵامی کۆمێنت و نامەکان دەداتەوە، داواکاری کۆدەکاتەوە، و بە AI ڤیدیۆ و وێنەی ڕیکلام دروست دەکات.",
      "بۆ شێوازی فرۆشتنی کوردستان و عێراق دروست کراوە: کۆمێنتێک لە ژێر پۆستێک، نامەیەکی تایبەت، دواتر پارە لە کاتی گەیاندن. ڕووکارەکەی بە کوردی (سۆرانی)، عەرەبی و ئینگلیزییە، و نرخی پلانەکان بە دیناری عێراقییە و لە ڕێگای Wayl دەدرێن.",
      "هەمان تیم هەواڵنووس (Hawalnoos) دروست دەکات لە hawalnoos.com، ئامرازی ژووری هەواڵ بۆ ئاژانس و پەیجە هەواڵییەکان.",
      "گیتواس بەرهەمێکی سەربەخۆیە. لەلایەن میتا، تیکتۆک یان گووگڵەوە دروست نەکراوە و پشتگیری ناکرێت. فەیسبووک، ئینستاگرام، واتساپ، تیکتۆک و یوتیوب نیشانەی بازرگانی خاوەنەکانیانن.",
    ],
    contactTitle: "پەیوەندی",
    contact: "ئیمەیڵ بنێرە بۆ hello@gituas.com، یان لە واتساپ بنووسە بۆ پشتگیری لە +964 771 010 6009، بە کوردی، عەرەبی یان ئینگلیزی.",
  },
  pricing: {
    metaTitle: "نرخی گیتواس بە دینار: پلانی بەخۆڕایی، بازرگان و پرۆ",
    metaDescription: "گیتواس لە پلانی بەخۆڕایی ٠ دینارە، بازرگان مانگانە ١٥٬٠٠٠ دینار و پرۆ ٢٥٬٠٠٠ دینار بۆ هەر دوکانێک. پارەدان بە FIB، زەین کاش، کی کارد، فاست پەی یان کارت.",
    title: "نرخی گیتواس بە دیناری عێراقی",
    intro:
      "گیتواس، یاریدەدەری AI بۆ ئەو دوکانانەی لە کوردستان و عێراق لە فەیسبووک و ئینستاگرام دەفرۆشن، لە پلانی بەخۆڕایی ٠ دینارە، لە بازرگان مانگانە ١٥٬٠٠٠ دینار و لە پرۆ مانگانە ٢٥٬٠٠٠ دینار، بۆ هەر دوکانێک، بە دیناری عێراقی و لە ڕێگای Wayl. دوکان یانی یەک پەیجی فەیسبووک یان ئەکاونتی ئینستاگرامی بەستراو. پلانی بەخۆڕایی کاتی دیاریکراوی نییە.",
    perMonth: "بۆ هەر دوکانێک مانگانە",
    free: "بەخۆڕایی",
    forShop: "بۆ هەر دوکانێک",
    compare: "پلانەکان بەراورد بکە",
    checked: (d) => `نرخ و سنوورەکان لە ${d} پشکنراون.`,
    rows: {
      price: "نرخ",
      posts: "وەڵامی خۆکار لەسەر",
      allPosts: "هەموو پۆستەکان",
      replies: "وەڵامی خۆکار لە ڕۆژێکدا، تا",
      ai: "وەڵامی بە AI نووسراو لە مانگێکدا، تا",
      voice: "نامەی دەنگی کڕیار کە لە ڕۆژێکدا دەخوێندرێتەوە، تا",
      boost: "شیکردنەوەی بووست لە ڕۆژێکدا، تا",
      video: "ڤیدیۆی ڕیکلامی AI لە مانگێکدا، تا",
      pictures: "وێنەی AI لە مانگێکدا، تا",
      accounts: "ئەکاونتی بەستراو بۆ هەر پلاتفۆرمێک",
      model: "مۆدێلی AI",
      fast: "مۆدێلی ئاسایی AI",
      opus: "بەهێزترین مۆدێل (Claude Opus)، لەناو بەشێکی مانگانەدا",
      none: "تێیدا نییە",
    },
    units: { perDay: "لە ڕۆژێکدا", perMonth: "لە مانگێکدا", newest: (n) => `نوێترین ${n} پۆست`, ads: "ڤیدیۆ", pics: "وێنە" },
    plans: {
      FREE: { name: "بەخۆڕایی", blurb: "وەڵامی خۆکار لەسەر نوێترین پۆستەکانت تاقی بکەرەوە." },
      MERCHANT: { name: "بازرگان", blurb: "وەڵام لەسەر ٢٥ پۆست، نامەی دەنگی، ڤیدیۆ و وێنەی AI." },
      PRO: { name: "پرۆ", blurb: "وەڵام لەسەر هەموو پۆستەکان، و جێگای زیاتر بۆ ڤیدیۆ و وێنە." },
      MAX: { name: "ماکس", blurb: "زۆرترین جێگا، و بەهێزترین مۆدێلی AI بۆ وەڵام و سکریپت." },
    },
    notes: [
      "وەڵامی خۆکار ئەو وەڵامانەیە کە گیتواس خۆی لە زانیاری بەرهەم و نموونە و یاساکانتەوە دەینێرێت؛ ژمارەی ڕۆژانە سنووری ئەوانە. وەڵامی بە AI نووسراو ئەوانەیە کە AI بە وشەی خۆت دەینووسێت و جیا لە مانگێکدا دەژمێردرێن.",
      "تایبەتمەندییەکانی AI لە یەک شوێنی کار یەک بڕی مانگانەی AI هاوبەش دەکەن، و هەر دوکانێکی پارەدراو بەشی پلانەکەی زیاد دەکات. ژمارەکانی سەرەوە سنوورن: کاتێک بڕەکە تەواو دەبێت، تایبەتمەندییەکانی AI تا مانگی داهاتوو ڕادەوەستن و وەڵامە جێگیرەکان و یاساکان هەر وەڵام دەدەنەوە.",
      "پلان بۆ هەر دوکانێک دەکڕدرێت. ژمارەی ئەو ئەکاونتانەی دەتوانیت ببەستیتەوە بۆ هەر پلاتفۆرمێکە (فەیسبووک، ئینستاگرام، تیکتۆک، یوتیوب) و بەپێی باشترین پلانی شوێنی کارەکەتە.",
    ],
    faq: (maxOpen) => [
      {
        q: "گیتواس بە چەند دەبێت؟",
        a: `پلانی بەخۆڕایی هیچ نرخێکی نییە و کاتی دیاریکراوی نییە. بازرگان مانگانە ١٥٬٠٠٠ دیناری عێراقییە و پرۆ مانگانە ٢٥٬٠٠٠ دیناری عێراقییە، بۆ هەر دوکانێک.${maxOpen ? " ماکس مانگانە ٥٩٬٠٠٠ دیناری عێراقییە." : ""}`,
      },
      { q: "دوکان بە چی دەژمێردرێت؟", a: "یەک پەیجی فەیسبووک یان ئەکاونتی ئینستاگرامی بەستراو یەک دوکانە. پلان بۆ هەر دوکانێک دەکڕدرێت و بڵاوکردنەوە بۆ تیکتۆک و یوتیوبیشی بۆ دەگرێتەوە." },
      { q: "چۆن پارە دەدەم؟", a: "بە دیناری عێراقی لە ڕێگای Wayl: FIB، زەین کاش، کی کارد، فاست پەی یان کارت. هەر پلانێکی پارەدراو ٣٠ ڕۆژ دەخایەنێت." },
      { q: "ئەگەر نوێی نەکەمەوە چی ڕوودەدات؟", a: "دوکانەکە دەگەڕێتەوە بۆ پلانی بەخۆڕایی: وەڵامی خۆکار لەسەر نوێترین ٣ پۆست و تا ١٠٠ وەڵام لە ڕۆژێکدا." },
    ],
    payTitle: "پارەدان لە عێراق",
    payBody: "پارەدان بە دیناری عێراقییە لە ڕێگای Wayl، کە FIB، زەین کاش، کی کارد، فاست پەی و کارت وەردەگرێت. بۆ دەستپێکردن لەسەر پلانی بەخۆڕایی هیچ پارەیەک نادرێت.",
  },
  cta: { start: "بەخۆڕایی دەست پێبکە", startFree: "بەخۆڕایی دەست پێبکە، بێ کارت", read: "زیاتر بخوێنەوە" },
  footer: {
    product: "بەرهەم",
    legal: "یاسایی",
    privacy: "سیاسەتی تایبەتمەندی",
    terms: "مەرجەکان",
    dataDeletion: "سڕینەوەی زانیاری",
    newsroom: "هەواڵنووس، بۆ ئاژانس و پەیجە هەواڵییەکان",
    tagline: "گیتواس (Gituas): وەڵامی خۆکار، داواکاری و ڤیدیۆی ڕیکلام بە AI بۆ دوکانەکانی کوردستان و عێراق.",
    rights: "گیتواس",
  },
  langName: "کوردی",
};

const ar: Chrome = {
  brand: "Gituas",
  nav: { features: "المزايا", guides: "الأدلة", pricing: "الأسعار", about: "حول", signIn: "تسجيل الدخول", start: "ابدأ مجاناً", menu: "القائمة", skip: "انتقل إلى المحتوى" },
  home: "الرئيسية",
  sections: { how: "كيف يعمل", features: "ماذا يفعل Gituas", audience: "لمن هو", faq: "الأسئلة الشائعة", more: "كل الخطط والحدود", plans: "الخطط", read: "اقرأ الدليل" },
  guides: {
    title: "الأدلة",
    metaTitle: "الأدلة: الردود التلقائية والطلبات وإعلانات الفيديو لمتاجر كردستان والعراق | Gituas",
    intro: "أدلة عملية للمتاجر التي تبيع عبر فيسبوك وإنستغرام في كردستان والعراق.",
    read: "اقرأ الدليل",
    keyFacts: "أهم النقاط",
    steps: "الخطوات",
    faq: "أسئلة وأجوبة",
    related: "أدلة ذات صلة",
    updated: "آخر تحديث",
  },
  about: {
    metaTitle: "حول Gituas: مساعد بالذكاء الاصطناعي لمتاجر كردستان والعراق",
    metaDescription: "لمن يُستخدم Gituas، وكيف يعمل في كردستان والعراق، وكيف تتواصل مع الفريق، وما الذي لا يرتبط به.",
    title: "حول Gituas",
    paragraphs: [
      "Gituas (بالكردية: گیتواس) مساعد بالذكاء الاصطناعي للمتاجر والأعمال التي تبيع عبر فيسبوك وإنستغرام في كردستان والعراق. يردّ على التعليقات والرسائل بالكردية والعربية، ويجمع الطلبات، وينتج إعلانات فيديو وصوراً بالذكاء الاصطناعي.",
      "صُمم لطريقة البيع في كردستان والعراق: تعليق تحت منشور، ثم رسالة خاصة، ثم الدفع عند الاستلام. الواجهة بالكردية (السورانية) والعربية والإنجليزية، والخطط مسعّرة بالدينار العراقي وتُدفع عبر Wayl.",
      "الفريق نفسه يصنع Hawalnoos (هەواڵنووس) على hawalnoos.com، وهو أداة غرفة أخبار لوكالات الأنباء وصفحات الأخبار.",
      "Gituas منتج مستقل. لا تصنعه Meta أو TikTok أو Google ولا ترعاه ولا تؤيده. فيسبوك وإنستغرام وواتساب وتيك توك ويوتيوب علامات تجارية لأصحابها.",
    ],
    contactTitle: "التواصل",
    contact: "راسل hello@gituas.com، أو اكتب إلى الدعم على واتساب على الرقم +964 771 010 6009 بالكردية أو العربية أو الإنجليزية.",
  },
  pricing: {
    metaTitle: "أسعار Gituas بالدينار العراقي: الخطط المجانية والتاجر والاحترافية",
    metaDescription: "Gituas مجاني في الخطة المجانية، و١٥٬٠٠٠ دينار شهرياً لخطة التاجر و٢٥٬٠٠٠ دينار للاحترافية لكل متجر. الدفع عبر FIB وزين كاش وكي كارد وفاست باي أو البطاقة.",
    title: "أسعار Gituas بالدينار العراقي",
    intro:
      "Gituas، مساعد بالذكاء الاصطناعي للمتاجر التي تبيع عبر فيسبوك وإنستغرام في كردستان والعراق، يكلّف ٠ دينار في الخطة المجانية، و١٥٬٠٠٠ دينار شهرياً في خطة التاجر، و٢٥٬٠٠٠ دينار شهرياً في الاحترافية، لكل متجر، بالدينار العراقي عبر Wayl. المتجر هو صفحة فيسبوك أو حساب إنستغرام مربوط واحد. والخطة المجانية بلا مدة محددة.",
    perMonth: "لكل متجر شهرياً",
    free: "مجاني",
    forShop: "لكل متجر",
    compare: "قارن الخطط",
    checked: (d) => `روجعت الأسعار والحدود بتاريخ ${d}.`,
    rows: {
      price: "السعر",
      posts: "الردود التلقائية على",
      allPosts: "كل المنشورات",
      replies: "الردود التلقائية يومياً، حتى",
      ai: "ردود مكتوبة بالذكاء الاصطناعي شهرياً، حتى",
      voice: "رسائل صوتية للمشترين تُقرأ يومياً، حتى",
      boost: "تحليلات الترويج يومياً، حتى",
      video: "إعلانات فيديو بالذكاء الاصطناعي شهرياً، حتى",
      pictures: "صور بالذكاء الاصطناعي شهرياً، حتى",
      accounts: "الحسابات التي يمكن ربطها لكل منصة",
      model: "نموذج الذكاء الاصطناعي",
      fast: "النموذج القياسي",
      opus: "أقوى نموذج (Claude Opus) ضمن حصة شهرية",
      none: "غير مشمول",
    },
    units: { perDay: "يومياً", perMonth: "شهرياً", newest: (n) => (n <= 10 ? `أحدث ${n} منشورات` : `أحدث ${n} منشوراً`), ads: "فيديو", pics: "صورة" },
    plans: {
      FREE: { name: "المجانية", blurb: "جرّب الردود التلقائية على أحدث منشوراتك." },
      MERCHANT: { name: "التاجر", blurb: "ردود على ٢٥ منشوراً، ورسائل صوتية، وفيديو وصور بالذكاء الاصطناعي." },
      PRO: { name: "الاحترافية", blurb: "ردود على كل المنشورات، ومساحة أكبر للفيديو والصور." },
      MAX: { name: "ماكس", blurb: "أكبر مساحة وأقوى نموذج ذكاء اصطناعي للردود والنصوص." },
    },
    notes: [
      "الردود التلقائية هي الإجابات التي يرسلها Gituas بنفسه من بيانات منتجاتك وقوالبك وقواعدك؛ والرقم اليومي هو سقفها. أما الردود المكتوبة بالذكاء الاصطناعي فهي التي يؤلفها بكلماتك أنت، وتُحتسب منفصلة كل شهر.",
      "تتشارك ميزات الذكاء الاصطناعي في مساحة العمل رصيداً شهرياً واحداً، ويضيف كل متجر مدفوع حصة خطته. الأرقام أعلاه سقوف: عندما ينفد الرصيد تتوقف ميزات الذكاء الاصطناعي حتى الشهر القادم بينما تواصل الردود الثابتة والقواعد الإجابة.",
      "تُشترى الخطط لكل متجر. وعدد الحسابات التي يمكن ربطها هو لكل منصة (فيسبوك وإنستغرام وتيك توك ويوتيوب) ويتبع أفضل خطة في مساحة العمل.",
    ],
    faq: (maxOpen) => [
      {
        q: "كم تبلغ تكلفة Gituas؟",
        a: `الخطة المجانية بلا مقابل وبلا مدة محددة. خطة التاجر ١٥٬٠٠٠ دينار عراقي شهرياً والاحترافية ٢٥٬٠٠٠ دينار شهرياً لكل متجر.${maxOpen ? " وخطة ماكس ٥٩٬٠٠٠ دينار شهرياً." : ""}`,
      },
      { q: "ما الذي يُعدّ متجراً؟", a: "صفحة فيسبوك أو حساب إنستغرام مربوط واحد يُعدّ متجراً واحداً. تُشترى الخطة لكل متجر وتشمل النشر على تيك توك ويوتيوب له." },
      { q: "كيف أدفع؟", a: "بالدينار العراقي عبر Wayl: FIB أو زين كاش أو كي كارد أو فاست باي أو البطاقة. كل خطة مدفوعة تدوم ٣٠ يوماً." },
      { q: "ماذا يحدث إن لم أجدّد؟", a: "يعود المتجر إلى الخطة المجانية: ردود تلقائية على أحدث ٣ منشورات وحتى ١٠٠ رد يومياً." },
    ],
    payTitle: "الدفع في العراق",
    payBody: "الدفع بالدينار العراقي عبر Wayl الذي يقبل FIB وزين كاش وكي كارد وفاست باي والبطاقات. لا شيء يُدفع للبدء بالخطة المجانية.",
  },
  cta: { start: "ابدأ مجاناً", startFree: "ابدأ مجاناً بلا بطاقة", read: "اقرأ المزيد" },
  footer: {
    product: "المنتج",
    legal: "قانوني",
    privacy: "سياسة الخصوصية",
    terms: "الشروط",
    dataDeletion: "حذف البيانات",
    newsroom: "Hawalnoos، لوكالات الأنباء وصفحات الأخبار",
    tagline: "Gituas (گیتواس): ردود تلقائية وطلبات وإعلانات فيديو بالذكاء الاصطناعي لمتاجر كردستان والعراق.",
    rights: "Gituas",
  },
  langName: "العربية",
};

export const CHROME: Record<SiteLang, Chrome> = { en, ku, ar };
