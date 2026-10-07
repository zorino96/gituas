// Pawan.krd's Kurdish voices (pkrd/tts-ku), with the names a desk sees. Safe for the browser.

export const PAWAN_VOICES = [
  "male", "female", "aram", "rebin", "shwan", "karwan", "hemin", "soran", "bakhtiyar", "kamaran", "dilshad",
  "rostam", "shilan", "lana", "rozhin", "shno", "hawnaz", "nazanin", "kazhal", "sozan", "gulala", "shirin",
] as const;

export type PawanVoice = (typeof PAWAN_VOICES)[number];

/** The voice's name in Arabic script (Sorani and Arabic pages) and in Latin script (English pages). */
export const VOICE_NAMES: Record<PawanVoice, { ku: string; en: string }> = {
  male: { ku: "پیاو", en: "Male" },
  female: { ku: "ئافرەت", en: "Female" },
  aram: { ku: "ئارام", en: "Aram" },
  rebin: { ku: "ڕێبین", en: "Rebin" },
  shwan: { ku: "شوان", en: "Shwan" },
  karwan: { ku: "کاروان", en: "Karwan" },
  hemin: { ku: "هێمن", en: "Hemin" },
  soran: { ku: "سۆران", en: "Soran" },
  bakhtiyar: { ku: "بەختیار", en: "Bakhtiyar" },
  kamaran: { ku: "کامەران", en: "Kamaran" },
  dilshad: { ku: "دڵشاد", en: "Dilshad" },
  rostam: { ku: "ڕۆستەم", en: "Rostam" },
  shilan: { ku: "شیلان", en: "Shilan" },
  lana: { ku: "لانا", en: "Lana" },
  rozhin: { ku: "ڕۆژین", en: "Rozhin" },
  shno: { ku: "شنۆ", en: "Shno" },
  hawnaz: { ku: "هاوناز", en: "Hawnaz" },
  nazanin: { ku: "نازەنین", en: "Nazanin" },
  kazhal: { ku: "کەژاڵ", en: "Kazhal" },
  sozan: { ku: "سۆزان", en: "Sozan" },
  gulala: { ku: "گوڵاڵە", en: "Gulala" },
  shirin: { ku: "شیرین", en: "Shirin" },
};

export const SPEECH_SPEED = { min: 0.8, max: 1.3, fallback: 1 } as const;

export function isPawanVoice(v: unknown): v is PawanVoice {
  return typeof v === "string" && (PAWAN_VOICES as readonly string[]).includes(v);
}

export function cleanSpeed(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return SPEECH_SPEED.fallback;
  return Math.round(Math.min(SPEECH_SPEED.max, Math.max(SPEECH_SPEED.min, n)) * 20) / 20;
}
