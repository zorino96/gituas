import { num } from "../num";
import { plural } from "../plural";
import type { nrNewsCkb } from "./news.ckb";

/** "مصدر واحد" / "مصدران" / "٥ مصادر" / "١٢ مصدراً". */
function sources(n: number): string {
  const forms = { one: "مصدر واحد", two: "مصدران", few: "مصادر", many: "مصدراً" };
  return n === 1 || n === 2 ? plural(n, forms) : `${num(n)} ${plural(n, forms)}`;
}

// The newsroom's news text in Arabic: exactly the keys of news.ckb.ts.
export const nrNewsAr: typeof nrNewsCkb = {
  list: {
    title: "الأخبار",
    tabs: { new: "جديد", ready: "جاهز", done: "منشور" },
    autoRefresh: (every: string) => `التحديث التلقائي: ${every}`,
    refreshing: "جارٍ التحديث…",
    statDrafts: "مسودات هذا الشهر",
    statSources: "مصادر",
    noSources: "لا يوجد لديك أي مصدر مفعّل.",
    noSourcesLink: "أضف مصادر من الإعدادات",
    noKeywords: "يحتاج GDELT وNewsData إلى كلمات مفتاحية.",
    noKeywordsLink: "حدّد كلماتك المفتاحية",
    noAnswer: (names: string) => `مصادر لم تستجب: ${names}`,
    empty: "لا توجد أخبار هنا.",
    auto: "تلقائي",
    sourceCount: sources,
    attribBefore: "تصل بعض الأخبار عبر",
    attribAnd: " و",
    attribAfter: ".",
  },

  filters: {
    topic: "الموضوع",
    allTopics: "كل المواضيع",
    region: "المنطقة",
    allRegions: "كل المناطق",
    source: "المصدر",
    allSources: "كل المصادر",
  },

  langs: { ckb: "الكردية", ku: "الكردية", ar: "العربية", en: "الإنجليزية", tr: "التركية" },

  topics: {
    politics: "السياسة",
    economy: "الاقتصاد",
    security: "الأمن",
    sports: "الرياضة",
    health: "الصحة",
    tech: "العلوم والتكنولوجيا",
    society: "المجتمع",
    culture: "الثقافة والفن",
    other: "أخرى",
  },
  subtopics: {
    politics: {
      government: "الحكومة والبرلمان",
      elections: "الانتخابات",
      diplomacy: "العلاقات الدولية",
      parties: "الأحزاب السياسية",
    },
    economy: {
      energy: "النفط والطاقة",
      salaries: "الرواتب والموازنة",
      markets: "الأسواق والعملة",
      trade: "التجارة والاستثمار",
    },
    security: {
      conflict: "الحرب والنزاعات",
      terrorism: "الإرهاب",
      crime: "الجريمة والشرطة",
      accidents: "الحوادث والكوارث",
    },
    sports: {
      football: "كرة القدم",
      local: "رياضة كردستان والعراق",
      other: "رياضات أخرى",
    },
    society: {
      education: "التربية والتعليم",
      environment: "البيئة والطقس",
      services: "الكهرباء والماء والخدمات",
      humanitarian: "الهجرة والأوضاع الإنسانية",
    },
  },
  regions: { kurdistan: "كردستان", iraq: "العراق", region: "المنطقة", world: "العالم" },

  checklist: {
    title: "الخطوات الأولى",
    done: "تم",
    guide: "اقرأ الدليل كاملاً",
    steps: {
      connect: "اربط صفحة فيسبوك أو إنستغرام أو تيك توك",
      brand: "أضف شعار قناتك",
      sources: "حدّد كلمات مفتاحية أو خلاصة RSS",
      card: "أنشئ بطاقتك الأولى",
      publish: "انشر خبرك الأول",
    },
  },

  editor: {
    videoSec: "فيديو هذا الخبر",
    videoHint: "ارفعوا حتى ٣ مقاطع من تصويركم (ما صوّره مراسلوكم). يحوّلها Hawalnoos إلى مقتطف ٩:١٦ بصوت وترجمة نصية. إن لم يكن لديكم فيديو، يُصنع فيديو بتصميم Hawalnoos. ارفعوا فقط فيديو تملكون حقوقه.",
    videoPick: "اختر فيديو",
    videoUploading: (n: number, of: number) => `جارٍ الرفع… ${num(n)}/${num(of)}`,
    videoClips: (n: number) => `${num(n)} مقطع جاهز`,
    videoMakeHighlight: "صنع المقتطف",
    videoMakeTemplate: "صنع فيديو بالتصميم",
    videoWorking: "يتم صنع الفيديو… نحو ٥ إلى ١٠ دقائق. يمكنك مغادرة هذه الصفحة.",
    videoFailed: "تعذّر صنع الفيديو. حاول مرة أخرى.",
    videoReady: "الفيديو جاهز.",
    videoPublish: "نشر الفيديو",
    videoTooMany: "٣ مقاطع كحد أقصى.",
    sourceSec: "المصدر",
    open: "فتح",
    summarySec: "الملخص الكردي",
    improve: "تحسين",
    dismiss: "استبعاد",
    improving: "جارٍ تحسين الصياغة… (حتى ١٠ ثوانٍ)",
    drafting: "جارٍ التجهيز… (حتى ٢٠ ثانية)",
    draftingShort: "جارٍ التجهيز…",
    headline: "العنوان",
    body: "النص",
    kindAria: "نوع البطاقة",
    kinds: { STANDARD: "عادية", BREAKING: "عاجل", STAT: "رقم", QUOTE: "اقتباس" },
    stat: "الرقم",
    quote: "الاقتباس",
    speaker: "قائل الاقتباس",
    changePhoto: "تغيير الصورة",
    ownPhoto: "صورتك الخاصة",
    photoNote: "صوركم الخاصة فقط — لا تؤخذ أي صورة من المصادر.",
    photoTypes: "صور JPG/PNG/WEBP فقط.",
    uploadFailed: (msg: string) => `فشل الرفع: ${msg}`,
    tooLong: "النص طويل على البطاقة. اختصره.",
    cardSec: "البطاقة",
    saving: "جارٍ الحفظ…",
    rendering: "جارٍ إنشاء البطاقة…",
    uploadingCard: "جارٍ رفع البطاقة…",
    prepare: "تجهيز للنشر",
    prepareHint: "بعد ذلك تُفتح صفحة النشر: تختار المنصات وتوافق على النشر. لا يُنشر شيء دون نقرتك.",
  },

  rules: {
    empty: "العنوان والنص مطلوبان كلاهما.",
    headlineLong: (max: number) => `العنوان يتجاوز الحد الأقصى (${num(max)} حرف).`,
    bodyLong: (max: number) => `النص يتجاوز الحد الأقصى (${num(max)} حرف).`,
    copy: {
      headline: "العنوان قريب جداً من عنوان المصدر. أعد كتابته بكلماتك.",
      body: "النص قريب جداً من نص المصدر. أعد كتابته بكلماتك.",
      both: "العنوان والنص قريبان جداً من المصدر. أعد كتابتهما بكلماتك.",
    },
  },

  actions: {
    notNews: "هذا القسم مخصص لصفحات الأخبار فقط.",
    refreshFailed: "فشل التحديث. حاول مرة أخرى.",
    badStrength: "نوع الطلب غير صالح.",
    notFound: "لم يُعثر على الخبر.",
    limitDraft: (max: number) => `انتهى حد تجهيز الأخبار لهذا الشهر (${num(max)}). للمزيد، قم بترقية باقتك.`,
    limitImprove: (max: number) => `انتهى حد التحسين لهذا الشهر (${num(max)}). للمزيد، قم بترقية باقتك.`,
    limitPublish: (max: number) => `انتهى حد النشر لهذا الشهر (${num(max)}). للمزيد، قم بترقية باقتك.`,
    limitVideo: (max: number) => `انتهى حد الفيديو لهذا الشهر (${num(max)}). للمزيد، قم بترقية باقتك.`,
    frozen: "انتهت الفترة التجريبية — للاستمرار اختر باقة من «الباقة والدفع».",
    aiDown: "الكتابة التلقائية غير متاحة الآن. يمكنك كتابته بنفسك.",
    draftFailed: "فشل التجهيز. حاول مرة أخرى.",
    badKind: "نوع البطاقة غير صالح.",
    badPhoto: "تعذّر التعرف على الصورة.",
    saveFirst: "احفظ النص أولاً.",
    badCard: "تعذّر التعرف على البطاقة.",
    sourceUnavailable: "هذا المصدر غير متاح.",
    sourceLimit: "وصلت إلى الحد الأقصى لعدد المصادر في باقتك.",
    badLink: "الرابط غير صالح.",
    needName: "اكتب اسم المصدر.",
    emptyFeed: "لا يحتوي هذا الرابط على أي خبر.",
    notRss: "هذا الرابط ليس RSS أو لا يستجيب.",
    duplicate: "هذا المصدر مضاف من قبل.",
    badColors: "الألوان غير صالحة.",
    badFont: "الخط غير صالح.",
    badLogo: "تعذّر التعرف على الشعار.",
    badAutopilot: "إعدادات الطيار الآلي غير صالحة.",
    autoPlan: "النشر التلقائي متاح فقط في الباقة الاحترافية وباقة المؤسسات.",
    autoTargets: "للنشر التلقائي، اختر صفحة فيسبوك أو إنستغرام مربوطة على الأقل.",
  },

  settings: {
    groups: {
      api: "البحث بالكلمات المفتاحية",
      world: "عالمية",
      region: "الشرق الأوسط",
      kurdistan: "كردستان",
      official: "رسمية",
    },
    about: {
      gdelt: "أخبار العالم بأكثر من ٦٥ لغة، حسب كلماتك المفتاحية. مجاني.",
      newsdata: "أخبار عربية وإنجليزية حسب كلماتك المفتاحية. بتأخير ١٢ ساعة.",
    },
  },
};
