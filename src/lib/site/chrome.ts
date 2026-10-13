// The words around the website's content: navigation, buttons, labels, the pricing page's own text. Hand-written
// in the three languages; the long-form copy is in content/*.json.

import type { SiteLang } from "./langs";

export interface Chrome {
  brand: string;
  nav: { features: string; guides: string; pricing: string; signIn: string; start: string; menu: string; skip: string };
  home: string;
  sections: { how: string; features: string; audience: string; faq: string; more: string };
  guides: { title: string; intro: string; read: string; keyFacts: string; steps: string; faq: string; related: string; updated: string };
  pricing: {
    metaTitle: string;
    metaDescription: string;
    title: string;
    intro: string;
    perMonth: string;
    free: string;
    forShop: string;
    compare: string;
    best: string;
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
    faq: { q: string; a: string }[];
    payTitle: string;
    payBody: string;
  };
  cta: { start: string; startFree: string; read: string };
  footer: { product: string; legal: string; privacy: string; terms: string; dataDeletion: string; newsroom: string; tagline: string; rights: string };
  langName: string;
}

const en: Chrome = {
  brand: "Gituas",
  nav: { features: "Features", guides: "Guides", pricing: "Pricing", signIn: "Sign in", start: "Start free", menu: "Menu", skip: "Skip to content" },
  home: "Home",
  sections: { how: "How it works", features: "What Gituas does", audience: "Who it is for", faq: "Frequently asked questions", more: "More on pricing" },
  guides: {
    title: "Guides",
    intro: "Practical guides for shops that sell on Facebook and Instagram in Kurdistan and Iraq.",
    read: "Read the guide",
    keyFacts: "Key facts",
    steps: "Steps",
    faq: "Questions and answers",
    related: "Related guides",
    updated: "Updated",
  },
  pricing: {
    metaTitle: "Gituas pricing in Iraqi dinar: Free, Merchant and Pro plans",
    metaDescription: "Gituas costs 0 IQD on the Free plan, 15,000 IQD a month for Merchant and 25,000 IQD for Pro, per shop. Pay with FIB, ZainCash, QiCard, FastPay or card.",
    title: "Gituas pricing in Iraqi dinar",
    intro: "Gituas is priced per shop per month in Iraqi dinar (IQD). A shop is one connected Facebook Page or Instagram account. The Free plan has no time limit.",
    perMonth: "per shop per month",
    free: "Free",
    forShop: "per shop",
    compare: "Compare the plans",
    best: "Suited to a small shop",
    rows: {
      price: "Price",
      posts: "Automatic replies on",
      allPosts: "all posts",
      replies: "Automatic replies per day, up to",
      ai: "AI-written replies per month",
      voice: "Buyer voice notes read per day",
      boost: "Boost analyses per day",
      video: "AI video ads per month",
      pictures: "AI pictures per month",
      accounts: "Connected accounts",
      model: "AI model",
      fast: "Fast model",
      opus: "Strongest model (Claude Opus)",
      none: "Not included",
    },
    units: { perDay: "a day", perMonth: "a month", newest: (n) => `the newest ${n} posts`, ads: "videos", pics: "pictures" },
    plans: {
      FREE: { name: "Free", blurb: "Try automatic replies on your newest posts." },
      MERCHANT: { name: "Merchant", blurb: "Replies on 25 posts, voice notes, AI videos and pictures." },
      PRO: { name: "Pro", blurb: "Replies on every post, with more room for videos and pictures." },
      MAX: { name: "Max", blurb: "The most room, and the strongest AI model for replies and scripts." },
    },
    faq: [
      { q: "How much does Gituas cost?", a: "The Free plan costs nothing and has no time limit. Merchant is 15,000 Iraqi dinar a month and Pro is 25,000 Iraqi dinar a month, per shop. A Max plan at 59,000 Iraqi dinar is offered when it is open." },
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
    newsroom: "Hawalnoos, for news channels",
    tagline: "AI replies, orders and video ads for shops in Kurdistan and Iraq.",
    rights: "Gituas",
  },
  langName: "English",
};

const ku: Chrome = {
  brand: "گیتواس",
  nav: { features: "تایبەتمەندییەکان", guides: "ڕێنماییەکان", pricing: "نرخەکان", signIn: "چوونەژوورەوە", start: "بەخۆڕایی دەست پێبکە", menu: "لیست", skip: "بڕۆ بۆ ناوەڕۆک" },
  home: "سەرەکی",
  sections: { how: "چۆن کار دەکات", features: "گیتواس چی دەکات", audience: "بۆ کێیە", faq: "پرسیارە باوەکان", more: "زیاتر لەسەر نرخەکان" },
  guides: {
    title: "ڕێنماییەکان",
    intro: "ڕێنمایی کرداری بۆ ئەو دوکانانەی لە کوردستان و عێراق لە فەیسبووک و ئینستاگرام دەفرۆشن.",
    read: "ڕێنماییەکە بخوێنەوە",
    keyFacts: "خاڵە سەرەکییەکان",
    steps: "هەنگاوەکان",
    faq: "پرسیار و وەڵام",
    related: "ڕێنمایی پەیوەندیدار",
    updated: "نوێکراوەتەوە",
  },
  pricing: {
    metaTitle: "نرخی گیتواس بە دینار: پلانی بەخۆڕایی، بازرگان و پرۆ",
    metaDescription: "گیتواس لە پلانی بەخۆڕایی ٠ دینارە، بازرگان مانگانە ١٥٬٠٠٠ دینار و پرۆ ٢٥٬٠٠٠ دینار بۆ هەر دوکانێک. پارەدان بە FIB، زەین کاش، کی کارد، فاست پەی یان کارت.",
    title: "نرخی گیتواس بە دیناری عێراقی",
    intro: "نرخی گیتواس بۆ هەر دوکانێک و مانگانەیە، بە دیناری عێراقی. دوکان یانی یەک پەیجی فەیسبووک یان ئەکاونتی ئینستاگرامی بەستراو. پلانی بەخۆڕایی کاتی دیاریکراوی نییە.",
    perMonth: "بۆ هەر دوکانێک مانگانە",
    free: "بەخۆڕایی",
    forShop: "بۆ هەر دوکانێک",
    compare: "پلانەکان بەراورد بکە",
    best: "گونجاو بۆ دوکانی بچووک",
    rows: {
      price: "نرخ",
      posts: "وەڵامی خۆکار لەسەر",
      allPosts: "هەموو پۆستەکان",
      replies: "وەڵامی خۆکار لە ڕۆژێکدا، تا",
      ai: "وەڵامی بە AI نووسراو لە مانگێکدا",
      voice: "نامەی دەنگی کڕیار کە لە ڕۆژێکدا دەخوێندرێتەوە",
      boost: "شیکردنەوەی بووست لە ڕۆژێکدا",
      video: "ڤیدیۆی ڕیکلامی AI لە مانگێکدا",
      pictures: "وێنەی AI لە مانگێکدا",
      accounts: "ئەکاونتی بەستراو",
      model: "مۆدێلی AI",
      fast: "مۆدێلی خێرا",
      opus: "بەهێزترین مۆدێل (Claude Opus)",
      none: "تێیدا نییە",
    },
    units: { perDay: "لە ڕۆژێکدا", perMonth: "لە مانگێکدا", newest: (n) => `نوێترین ${n} پۆست`, ads: "ڤیدیۆ", pics: "وێنە" },
    plans: {
      FREE: { name: "بەخۆڕایی", blurb: "وەڵامی خۆکار لەسەر نوێترین پۆستەکانت تاقی بکەرەوە." },
      MERCHANT: { name: "بازرگان", blurb: "وەڵام لەسەر ٢٥ پۆست، نامەی دەنگی، ڤیدیۆ و وێنەی AI." },
      PRO: { name: "پرۆ", blurb: "وەڵام لەسەر هەموو پۆستەکان، و جێگای زیاتر بۆ ڤیدیۆ و وێنە." },
      MAX: { name: "ماکس", blurb: "زۆرترین جێگا، و بەهێزترین مۆدێلی AI بۆ وەڵام و سکریپت." },
    },
    faq: [
      { q: "گیتواس بە چەند دەبێت؟", a: "پلانی بەخۆڕایی هیچ نییە و کاتی دیاریکراوی نییە. بازرگان مانگانە ١٥٬٠٠٠ دیناری عێراقییە و پرۆ مانگانە ٢٥٬٠٠٠ دیناری عێراقییە، بۆ هەر دوکانێک. پلانی ماکس بە ٥٩٬٠٠٠ دینار کاتێک کراوە بێت دەبەخشرێت." },
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
    newsroom: "هەواڵنووس، بۆ کەناڵە هەواڵییەکان",
    tagline: "وەڵامی خۆکار، داواکاری و ڤیدیۆی ڕیکلام بە AI بۆ دوکانەکانی کوردستان و عێراق.",
    rights: "گیتواس",
  },
  langName: "کوردی",
};

const ar: Chrome = {
  brand: "Gituas",
  nav: { features: "المزايا", guides: "الأدلة", pricing: "الأسعار", signIn: "تسجيل الدخول", start: "ابدأ مجاناً", menu: "القائمة", skip: "انتقل إلى المحتوى" },
  home: "الرئيسية",
  sections: { how: "كيف يعمل", features: "ماذا يفعل Gituas", audience: "لمن هو", faq: "الأسئلة الشائعة", more: "المزيد عن الأسعار" },
  guides: {
    title: "الأدلة",
    intro: "أدلة عملية للمتاجر التي تبيع عبر فيسبوك وإنستغرام في كردستان والعراق.",
    read: "اقرأ الدليل",
    keyFacts: "أهم النقاط",
    steps: "الخطوات",
    faq: "أسئلة وأجوبة",
    related: "أدلة ذات صلة",
    updated: "آخر تحديث",
  },
  pricing: {
    metaTitle: "أسعار Gituas بالدينار العراقي: الخطط المجانية والتاجر والاحترافية",
    metaDescription: "Gituas مجاني في الخطة المجانية، و١٥٬٠٠٠ دينار شهرياً لخطة التاجر و٢٥٬٠٠٠ دينار للاحترافية لكل متجر. الدفع عبر FIB وزين كاش وكي كارد وفاست باي أو البطاقة.",
    title: "أسعار Gituas بالدينار العراقي",
    intro: "يُحتسب سعر Gituas لكل متجر شهرياً بالدينار العراقي. المتجر هو صفحة فيسبوك أو حساب إنستغرام مربوط واحد. الخطة المجانية بلا مدة محددة.",
    perMonth: "لكل متجر شهرياً",
    free: "مجاني",
    forShop: "لكل متجر",
    compare: "قارن الخطط",
    best: "مناسبة للمتجر الصغير",
    rows: {
      price: "السعر",
      posts: "الردود التلقائية على",
      allPosts: "كل المنشورات",
      replies: "الردود التلقائية يومياً، حتى",
      ai: "ردود مكتوبة بالذكاء الاصطناعي شهرياً",
      voice: "رسائل صوتية للمشترين تُقرأ يومياً",
      boost: "تحليلات الترويج يومياً",
      video: "إعلانات فيديو بالذكاء الاصطناعي شهرياً",
      pictures: "صور بالذكاء الاصطناعي شهرياً",
      accounts: "الحسابات المربوطة",
      model: "نموذج الذكاء الاصطناعي",
      fast: "النموذج السريع",
      opus: "أقوى نموذج (Claude Opus)",
      none: "غير مشمول",
    },
    units: { perDay: "يومياً", perMonth: "شهرياً", newest: (n) => `أحدث ${n} منشورات`, ads: "فيديو", pics: "صورة" },
    plans: {
      FREE: { name: "مجاني", blurb: "جرّب الردود التلقائية على أحدث منشوراتك." },
      MERCHANT: { name: "التاجر", blurb: "ردود على ٢٥ منشوراً، ورسائل صوتية، وفيديو وصور بالذكاء الاصطناعي." },
      PRO: { name: "احترافي", blurb: "ردود على كل المنشورات، ومساحة أكبر للفيديو والصور." },
      MAX: { name: "ماكس", blurb: "أكبر مساحة وأقوى نموذج ذكاء اصطناعي للردود والنصوص." },
    },
    faq: [
      { q: "كم تبلغ تكلفة Gituas؟", a: "الخطة المجانية بلا مقابل وبلا مدة محددة. خطة التاجر ١٥٬٠٠٠ دينار عراقي شهرياً والاحترافية ٢٥٬٠٠٠ دينار شهرياً لكل متجر. وتُعرض خطة ماكس بسعر ٥٩٬٠٠٠ دينار عندما تكون متاحة." },
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
    newsroom: "Hawalnoos، للقنوات الإخبارية",
    tagline: "ردود تلقائية وطلبات وإعلانات فيديو بالذكاء الاصطناعي لمتاجر كردستان والعراق.",
    rights: "Gituas",
  },
  langName: "العربية",
};

export const CHROME: Record<SiteLang, Chrome> = { en, ku, ar };
