// A story idea is the owner's own words. Born from a real chat: the owner asked for "one of the historical mystery stories, crime" and the
// model proposed a story whose idea said "Egyptian": a country the owner never said, which then steered the whole video. The prompt forbids it;
// this is the code that checks, on the card, so the words of the model never reach a story the owner did not ask for.
//
// What is checked is small and curated on purpose: the countries, peoples and eras a model most often adds, and years. A word counts as
// added when the idea has it (in any of the three languages) and the owner's own messages have no word for the same thing: an owner who
// wrote "Egypt" in Sorani may well have an idea that says "Egyptian". Nothing here judges meaning; it only compares the two texts.

/** One thing a model may add: its name (as the model is told about it) and how it is written in each script. */
interface Concept {
  /** The name used in the refusal. */
  name: string;
  /** Whole words in Latin letters, in lower case. */
  latin: RegExp;
  /** Stems in Arabic and Sorani letters (folded below); a word matches when it is the stem, with a short ending or a clitic. */
  stems: string[];
}

const CONCEPTS: Concept[] = [
  { name: "Egypt", latin: /\b(?:egypt|egyptians?|pharaohs?|pharaonic|cleopatra|tutankhamun|pyramids?|nile)\b/, stems: ["مصر", "فرعون", "فراعن", "اهرام", "أهرام", "النيل", "كليوباترا", "توت عنخ", "میسر", "فیرعەون", "ئەهرام", "ئیجیپت", "کلیۆپاترا"] },
  { name: "Rome", latin: /\b(?:rome|romans?|caesar|gladiators?|pompeii|colosseum)\b/, stems: ["روما", "رومان", "قيصر", "ڕۆما", "ڕۆمان", "قەیسەر", "بومبي"] },
  { name: "Greece", latin: /\b(?:greece|greeks?|athens|athenians?|spartans?|sparta|trojans?|troy)\b/, stems: ["يونان", "اثينا", "أثينا", "اسبرطة", "إسبرطة", "طروادة", "یۆنان", "ئەسینا", "سپارتا"] },
  { name: "the Middle Ages", latin: /\b(?:medieval|middle ages|knights?|crusad(?:e|es|ers?)|templars?|vikings?|feudal)\b/, stems: ["فايكنج", "فايكنغ", "صليبي", "العصور الوسطى", "القرون الوسطى", "ڤایکینگ", "خاچپەرست", "سەدەکانی ناوەڕاست"] },
  { name: "the Victorian era", latin: /\b(?:victorian|edwardian)\b/, stems: ["فيكتوري", "ڤیکتۆری"] },
  { name: "the Ottoman era", latin: /\b(?:ottomans?)\b/, stems: ["عثماني", "عوسمانی", "عوسمانلی"] },
  { name: "Mesopotamia", latin: /\b(?:babylon(?:ian)?s?|mesopotamia(?:n)?|sumer(?:ian)?s?|assyrian?s?|akkad(?:ian)?)\b/, stems: ["بابل", "ميزوبوتاميا", "الرافدين", "سومر", "اشور", "آشور", "مێزۆپۆتامیا", "سۆمەر", "ئاشوور"] },
  { name: "Persia", latin: /\b(?:persia(?:n)?s?|iran(?:ian)?s?)\b/, stems: ["فارس", "ايران", "إيران", "ئێران"] },
  { name: "Germany", latin: /\b(?:germany|germans?|prussia(?:n)?|nazis?|third reich)\b/, stems: ["المانيا", "ألمانيا", "الماني", "ألماني", "نازي", "ئەڵمانیا", "ئەڵمانی"] },
  { name: "France", latin: /\b(?:france|french|paris|napoleon(?:ic)?)\b/, stems: ["فرنسا", "فرنسي", "باريس", "نابليون", "فەڕەنسا", "فەرەنسا", "پاریس", "نەپۆلیۆن"] },
  { name: "Britain", latin: /\b(?:britain|british|england|scotland|london|ireland|irish)\b/, stems: ["بريطانيا", "بريطاني", "انجلترا", "إنجلترا", "لندن", "بەریتانیا", "ئینگلتەرا", "لەندەن"] },
  { name: "Russia", latin: /\b(?:russia(?:n)?s?|soviet|siberia(?:n)?|ussr)\b/, stems: ["روسيا", "روسي", "سوفيت", "سيبيريا", "ڕووسیا", "ڕووسی", "سۆڤیەت"] },
  { name: "America", latin: /\b(?:america(?:n)?s?|usa|united states|wild west)\b/, stems: ["امريكا", "أمريكا", "امريكي", "أمريكي", "ئەمریکا", "ئەمریکی"] },
  { name: "Japan", latin: /\b(?:japan(?:ese)?)\b/, stems: ["اليابان", "ياباني", "یابان", "ژاپۆن"] },
  { name: "China", latin: /\b(?:china|chinese)\b/, stems: ["الصين", "صيني", "چین", "چینی"] },
  { name: "India", latin: /\b(?:india(?:n)?s?)\b/, stems: ["الهند", "هندي", "هیندستان", "هیندی"] },
  { name: "ancient times", latin: /\b(?:ancient|antiquity|bronze age|stone age|iron age|prehistoric)\b/, stems: ["العصور القديمة", "ما قبل التاريخ", "سەردەمی کۆن", "پێش مێژوو"] },
  { name: "colonial times", latin: /\b(?:colonial)\b/, stems: ["استعماري", "ئیستیعماری"] },
  { name: "a war", latin: /\b(?:world war|wwi|wwii|ww1|ww2|cold war|first world war|second world war)\b/, stems: ["الحرب العالمية", "الحرب الباردة", "جەنگی جیهانی", "جەنگی سارد"] },
];

const MARKS = /\p{Mn}/gu;
const TATWEEL = String.fromCharCode(0x0640);

/** Arabic and Sorani letters in one spelling, for comparing only: yeh and alef maksura to Persian yeh, Arabic kaf to the Kurdish one, the Sorani ە dropped, ڵ read as ل, ڕ as ر, ۆ as و, ێ as ی, ڤ as ف, and every hamza form as a bare alef. */
function fold(text: string): string {
  return text
    .normalize("NFKC")
    .replace(MARKS, "")
    .split(TATWEEL)
    .join("")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/ە/g, "")
    .replace(/ڵ/g, "ل")
    .replace(/ڕ/g, "ر")
    .replace(/[ۆؤ]/g, "و")
    .replace(/ێ/g, "ی")
    .replace(/ڤ/g, "ف")
    .replace(/[أإآئ]/g, "ا");
}

/** Digits of any script as ASCII ("١٩٢٢" and "1922" are the same year). */
function asciiDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
}

/** The endings a stem may carry in Arabic or Sorani (folded): -i, -iyya, -in, -un, -an, -a, -at, and the Sorani definite endings. */
const ENDINGS = new Set(["", "ی", "یة", "یه", "ین", "ون", "ان", "ة", "ه", "ات", "یات", "ک", "کان", "یک", "یکان", "یش", "ها", "ن"]);
/** The clitics Arabic puts in front of a word: the article, "and", "with", "to", "so". */
const PREFIXES = ["", "ال", "وال", "بال", "فال", "لل", "و", "ب", "ل", "ف"];

const STEMS: { name: string; stem: string }[] = CONCEPTS.flatMap((c) => c.stems.map((stem) => ({ name: c.name, stem: fold(stem) })));

/** The words an Arabic-script text is made of (folded). */
function arabicWords(text: string): string[] {
  return fold(text).match(/[\p{L}\p{M}]+/gu) ?? [];
}

/** Whether one folded word is a stem with an ending and/or a clitic ("المصرية" is "مصر"; "رومانسي" is not "روما"). */
function isStem(word: string, stem: string): boolean {
  for (const prefix of PREFIXES) {
    if (!word.startsWith(prefix)) continue;
    const rest = word.slice(prefix.length);
    if (rest.startsWith(stem) && ENDINGS.has(rest.slice(stem.length))) return true;
  }
  return false;
}

/** The things (by name) a text speaks of, in any of the three languages. */
function conceptsIn(text: string): Set<string> {
  const found = new Set<string>();
  const lower = text.toLowerCase();
  for (const c of CONCEPTS) if (c.latin.test(lower)) found.add(c.name);
  const words = arabicWords(text);
  const phrase = fold(text);
  for (const { name, stem } of STEMS) {
    if (found.has(name)) continue;
    // A stem of several words ("العصور القديمة") is looked for in the text; a one-word stem must be a whole word, with its endings.
    if (/\s/.test(stem) ? phrase.includes(stem) : words.some((w) => isStem(w, stem))) found.add(name);
  }
  return found;
}

/** The four-digit years a text mentions (1000 to 2099), as "1922". */
function yearsIn(text: string): Set<string> {
  return new Set(asciiDigits(text).match(/(?<!\d)(?:1\d{3}|20\d{2})(?!\d)/g) ?? []);
}

/**
 * What the idea says that the owner's own words do not: the countries, peoples and eras a model adds (named, in English), and years (as
 * "1922"). Empty when nothing is added, or when the owner's words are not known (then nothing can be judged).
 */
export function addedWords(idea: string, owner: string): string[] {
  if (!idea.trim() || !owner.trim()) return [];
  const own = conceptsIn(owner);
  const ownYears = yearsIn(owner);
  const out: string[] = [];
  for (const name of conceptsIn(idea)) if (!own.has(name)) out.push(name);
  for (const year of yearsIn(idea)) if (!ownYears.has(year)) out.push(year);
  return out;
}
