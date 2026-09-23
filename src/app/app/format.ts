// Display helpers for the merchant app. Numbers are shown in Arabic-Indic digits,
// the way Kurdish merchants write them.

const nf = new Intl.NumberFormat("ar-IQ");

export function num(n: number | null | undefined): string {
  return n == null || Number.isNaN(n) ? "—" : nf.format(n);
}

export function ago(iso?: string, now: number = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "ئێستا";
  const m = Math.round(s / 60);
  if (m < 60) return `${num(m)} خولەک`;
  const h = Math.round(m / 60);
  if (h < 24) return `${num(h)} کاتژمێر`;
  const d = Math.round(h / 24);
  if (d < 30) return `${num(d)} ڕۆژ`;
  const date = new Date(t);
  return `${num(date.getDate())}ی ${KU_MONTHS[date.getMonth()]}`;
}

/** The month names used in Iraqi Kurdistan. */
const KU_MONTHS = [
  "کانوونی دووەم", "شوبات", "ئازار", "نیسان", "ئایار", "حوزەیران",
  "تەممووز", "ئاب", "ئەیلوول", "تشرینی یەکەم", "تشرینی دووەم", "کانوونی یەکەم",
];

export const PLATFORM_NAME = { FB: "فەیسبووک", IG: "ئینستاگرام", TT: "تیکتۆک" } as const;

export const PRIVACY_LABEL: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "هەموو کەس",
  MUTUAL_FOLLOW_FRIENDS: "هاوڕێکان (شوێنکەوتووی دوولایەنە)",
  FOLLOWER_OF_CREATOR: "شوێنکەوتووەکان",
  SELF_ONLY: "تەنیا خۆم",
};

/** Turn a raw platform error into one line a merchant can act on. */
export function friendlyError(raw: string | undefined): string {
  if (!raw) return "کارەکە نەکرا. دووبارە هەوڵ بدەرەوە.";
  if (/not connected|expired|reconnect|190/i.test(raw)) return "پەیوەندییەکە بەسەرچووە. لە ڕێکخستن دووبارە پەیوەستی بکەوە.";
  if (/rate|limit|613|\(#4\)/i.test(raw)) return "مێتا بۆ ماوەیەکی کورت ڕێگری دەکات. چەند خولەکێکی تر هەوڵ بدەرەوە.";
  if (/outside|24.?h|window|2018278|10\b/i.test(raw)) return "ماوەی ٢٤ کاتژمێرەکە تەواو بووە — ناتوانیت لێرەوە وەڵام بدەیتەوە.";
  if (/does not exist|cannot be loaded|\(#100\)|Unsupported/i.test(raw)) return "ئەم شتە چیتر بوونی نییە — لەوانەیە سڕابێتەوە.";
  return raw.length > 180 ? raw.slice(0, 180) + "…" : raw;
}
