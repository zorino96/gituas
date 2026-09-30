import type { Dict } from "./ckb";
import { num } from "./num";

/** Arabic counts: 1 and 2 have their own forms, 3–10 the plural, 11 and up the singular again. */
function plural(n: number, forms: { one: string; two: string; few: string; many: string }): string {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  const r = n % 100;
  return r >= 3 && r <= 10 ? forms.few : forms.many;
}

/** "منذ ساعة" / "منذ ساعتين" / "منذ ٥ ساعات" / "منذ ١٢ ساعة". */
function since(n: number, forms: { one: string; two: string; few: string; many: string }): string {
  return n === 1 || n === 2 ? `منذ ${plural(n, forms)}` : `منذ ${num(n)} ${plural(n, forms)}`;
}

/**
 * The Arabic dictionary: Modern Standard Arabic as Iraqi merchants read it. Same keys as
 * ckb.ts — the `Dict` type makes a missing key a compile error. Brand names stay in Latin
 * ("Gituas"); platforms are فيسبوك، إنستغرام، تيك توك، يوتيوب.
 */
export const ar: Dict = {
  brand: "Gituas",

  platform: { FB: "فيسبوك", IG: "إنستغرام", TT: "تيك توك", YT: "يوتيوب" },

  common: {
    refresh: "تحديث",
    refreshLabel: "تحديث",
    wait: "يرجى الانتظار",
    you: "أنت",
    user: "مستخدم",
    noText: "(بدون نص)",
    mediaOrFile: "(صورة أو ملف)",
    error: "خطأ",
    writing: "جارٍ الكتابة…",
    connectIt: "اربطه",
    noneConnected: "لم يتم ربط أي صفحة.",
    notConnected: (name: string) => `${name} غير مرتبط.`,
    open: "فتح",
    view: "عرض",
    views: "مشاهدة",
  },

  time: {
    now: "الآن",
    minutes: (n: number) => since(n, { one: "دقيقة", two: "دقيقتين", few: "دقائق", many: "دقيقة" }),
    hours: (n: number) => since(n, { one: "ساعة", two: "ساعتين", few: "ساعات", many: "ساعة" }),
    days: (n: number) => since(n, { one: "يوم", two: "يومين", few: "أيام", many: "يوماً" }),
    dayMonth: (day: number, month: string) => `${num(day)} ${month}`,
    date: (day: number, month: string, year: number) => `${num(day)} ${month} ${num(year).replace(/[٬,]/g, "")}`,
    months: [
      "كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران",
      "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول",
    ],
  },

  errors: {
    generic: "تعذّر تنفيذ العملية. حاول مرة أخرى.",
    expired: "انتهت صلاحية الربط. أعد الربط من الإعدادات.",
    rateLimit: "تمنع ميتا العملية مؤقتاً. حاول بعد بضع دقائق.",
    window24h: "انتهت مهلة الـ٢٤ ساعة — لا يمكنك الرد من هنا.",
    gone: "هذا العنصر لم يعد موجوداً — ربما تم حذفه.",
  },

  privacy: {
    PUBLIC_TO_EVERYONE: "الجميع",
    MUTUAL_FOLLOW_FRIENDS: "الأصدقاء (متابعة متبادلة)",
    FOLLOWER_OF_CREATOR: "المتابعون",
    SELF_ONLY: "أنا فقط",
  },
};
