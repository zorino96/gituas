import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs the real renderer (adfilm/render.py, through tests/advideo/render_probe.py) on job files and checks what it
// draws: where the logo mark sits against a two-line title, where the closing card of a Sorani ad stands, and which
// letters an English video puts on screen. It needs python with the renderer's libraries (skia and friends, see
// adfilm/requirements.txt); on a machine without them every test below is skipped, and the source checks in
// render-contract.test.ts still run. No ffmpeg: the voice clips are only measured.

const PROBE = path.join(process.cwd(), "tests", "advideo", "render_probe.py");

/** The first python that has the renderer's libraries; null = skip. */
function findPython(): string | null {
  for (const py of [process.env.PYTHON, "python3", "python"].filter((p): p is string => !!p)) {
    const r = spawnSync(py, ["-c", "import skia, numpy, scipy, PIL, uharfbuzz, regex, segno"], { stdio: "ignore", timeout: 60_000 });
    if (r.status === 0) return py;
  }
  return null;
}
const PYTHON = findPython();

interface Scene {
  type: string;
  text: string;
  sub?: string | null;
  voice?: string;
  icon?: string | null;
  clip?: number | null;
  photo?: number | null;
}
interface JobOptions {
  lang?: "ckb" | "ar" | "en";
  kind?: "story";
  layout?: "center" | "start" | "bottom";
  brand?: { name: string; handle?: string | null; phone?: string | null; latin?: string };
  /** Picture files to put in the job's folder as photo-0.jpg, photo-1.jpg ...; "white" is a snow-white one, "broken" is a file that is not a picture. */
  photos?: ("photo" | "white" | "broken")[];
  /** "wide" = a 16:9 story (1920x1080); it is written into the job as the app writes it, whatever the kind. */
  format?: "wide";
  /** The photo credit lines of the closing scene. */
  credits?: string[];
  scenes: Scene[];
}
interface Drawn {
  i: number;
  type: string;
  marks: number[][];
  headlines: [string, number, number, number, number, number | null, string | null][];
  /** (wide stories) [text, x the lines start from, top y, max width, size, lines, widest line, colour] of every headline of a text column. */
  wheads: [string, number, number, number, number, number, number, string | null][];
  /** [bottom y, max width, font size, lines, edge x or null, runs] of the credit block; runs = per line the [kind, text] runs it is drawn in. */
  credits: [number, number, number, number, number | null, [string, string][][]][];
  texts: string[];
  /** [text, x] of every string the scene drew (x is the centre of a centred one): where the runs of a credit line stand. */
  textAt: [string, number][];
  md5: string;
  ink?: [number, number] | null;
  /** [top row, bottom row, relative luminance of the brightest 5 % of the pixels] behind the first headline, text left out. */
  bg?: [number, number, number];
  bright?: number;
}
interface Probe {
  W: number;
  H: number;
  capTop: number;
  safe: number[];
  rtl: boolean;
  wide: boolean;
  scenes: Drawn[];
}

/** A silent mono WAV: the renderer only needs its length. */
function silence(seconds: number): Buffer {
  const rate = 24000;
  const data = Buffer.alloc(rate * seconds * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "adfilm-run-"));
/** A picture for a hook or a beat to sit over (the renderer reads JPEGs from the job's folder). */
let PHOTO: Buffer;
let WHITE: Buffer;
/** The same two for a wide frame. */
let PHOTO_W: Buffer;
let WHITE_W: Buffer;

function writeJob(name: string, o: JobOptions): string {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  const scenes = o.scenes.map((s, i) => {
    fs.writeFileSync(path.join(dir, `vo-${i}.wav`), silence(6));
    return { type: s.type, text: s.text, sub: s.sub ?? null, voice: s.voice ?? s.text, icon: s.icon ?? null, photo: s.photo ?? null, clip: s.clip ?? null, audio: `vo-${i}.wav` };
  });
  const photos = (o.photos ?? []).map((kind, i) => {
    const [blue, white] = o.format === "wide" ? [PHOTO_W, WHITE_W] : [PHOTO, WHITE];
    fs.writeFileSync(path.join(dir, `photo-${i}.jpg`), kind === "photo" ? blue : kind === "white" ? white : Buffer.from("this is not a picture"));
    return `photo-${i}.jpg`;
  });
  const job = {
    version: 1,
    size: o.format === "wide" ? [1920, 1080] : [1080, 1920],
    style: "elegant",
    look: { layout: o.layout ?? "center", photo: "card", icon: "ring", background: "glow", palette: "midnight", motion: "calm", transition: "crossfade", shape: "rounded" },
    plan: null,
    brand: { primary: "#0B2545", accent: "#E0A526", logoUrl: null, tagline: null, handle: null, phone: null, ...(o.brand ?? { name: "The Secret File" }) },
    product: null,
    photos,
    clips: [],
    scenes,
    music: { style: "ambient", bpm: 84, key: "D", mode: "minor" },
    ...(o.lang ? { lang: o.lang } : {}),
    ...(o.kind ? { kind: o.kind } : {}),
    ...(o.format ? { format: o.format } : {}),
    ...(o.credits ? { credits: o.credits } : {}),
  };
  const file = path.join(dir, "job.json");
  fs.writeFileSync(file, JSON.stringify(job), "utf8");
  return file;
}

function probe(job: string): Promise<Probe> {
  return new Promise((resolve, reject) => {
    const p = spawn(PYTHON!, [PROBE, job], { env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`render probe failed (${code}): ${err.slice(-1500)}`));
      resolve(JSON.parse(out.split("\n").filter(Boolean).at(-1)!) as Probe);
    });
  });
}

const ARABIC = /\p{Script=Arabic}/u;
/** The lower edge of a monogram tile (the tile is 0.9 of the mark's size tall, centred on the mark). */
const tileBottom = (m: number[]) => m[1] + m[2] * 0.45;
const tileTop = (m: number[]) => m[1] - m[2] * 0.45;

// ---- the jobs ---------------------------------------------------------------------------------------------

const KU = {
  hook: "نامەکە لە دەرگاکە",
  beat: "شەو",
  voice: "لە نیوەشەودا ڕووناکییەکانی باڵی ڕۆژهەڵات کوژانەوە و خزمەتکارەکە سوێندی خوارد",
  cta: "شوێنمان بکەوە بۆ فایلی داهاتوو",
};
const AR = { hook: "الرسالة التي وجدها المحقق في الدرج", beat: "الليل", voice: "في منتصف الليل انطفأت الأضواء في الجناح الشرقي", cta: "تابعنا للملف القادم" };
const EN = { hook: "The Letter in the Drawer", beat: "Night one", voice: "At midnight the lights in the east wing went out", cta: "Follow for the next file" };

const story = (t: { hook: string; beat: string; voice: string; cta: string }): Scene[] => [
  { type: "hook", text: t.hook, voice: t.voice },
  { type: "story", text: t.beat, voice: t.voice },
  { type: "footage", text: t.beat, voice: t.voice, clip: 0 },
  { type: "cta", text: t.cta, voice: t.voice },
];

/** A story whose hook and beat are both over photograph 0. */
const overPhoto = (t: { hook: string; beat: string; voice: string; cta: string }): Scene[] => [
  { type: "hook", text: t.hook, voice: t.voice, photo: 0 },
  { type: "story", text: t.beat, voice: t.voice, photo: 0 },
  { type: "cta", text: t.cta, voice: t.voice },
];

const AD = [
  { type: "hook", text: "دووکانی گوڵ", sub: "بۆ هەموو کات", voice: "بەخێربێیت" },
  { type: "value", text: "گەیاندنی خێرا", sub: "بۆ هەموو شارەکان", voice: "گەیاندنی خێرامان هەیە", icon: "truck" },
  { type: "offer", text: "خەڵاتی تایبەت", sub: "تەنها ئەم هەفتەیە", voice: "خەڵاتی تایبەتمان هەیە" },
  { type: "cta", text: "پەیوەندیمان پێوە بکە", voice: "پەیوەندیمان پێوە بکە" },
];
const AD_BRAND = { name: "دووکانی گوڵ", handle: null, phone: null };

/** The credit lines the app draws on the closing scene of a story (credits.ts): the label in the language, then the authors. */
const CREDITS = {
  en: ["Photos: Wikimedia Commons", "Andreas Biegleder, CC BY-SA 4.0 · Jane Doe, CC BY 2.0"],
  ar: ["الصور: ويكيميديا كومنز", "Andreas Biegleder, CC BY-SA 4.0 · Jane Doe, CC BY 2.0"],
  ckb: ["وێنەکان: ویکیمیدیا کۆمۆنز", "Andreas Biegleder, CC BY-SA 4.0 · Jane Doe, CC BY 2.0"],
};

/**
 * Credit lines with authors in several scripts (round 3: a line with any Arabic letter was drawn as ONE right-to-left run, which put the
 * licences next to the wrong authors, and a Chinese name drew as empty boxes). The entries of a line are joined by " · ".
 */
const MIXED = {
  // a vertical line holds about 44 characters, a wide one about 78 (credits.ts: creditScreen)
  vertical: ["Müller, CC BY 4.0 · Петров, CC BY 3.0", "أحمد الراشد, CC BY 4.0 · Jane Doe, CC BY 2.0"],
  wide: ["Fritz Müller-Lüdenscheid, CC BY-SA 4.0 · Иван Петров, CC BY 3.0", "Ahmad Al-Rashid أحمد الراشد, CC BY 4.0 · Jean-Baptiste Poquelin, CC BY 2.0"],
};
const CREDITS_MIXED = {
  en: [CREDITS.en[0], ...MIXED.vertical],
  ar: [CREDITS.ar[0], ...MIXED.vertical],
  ckb: [CREDITS.ckb[0], ...MIXED.vertical],
  wideEn: [CREDITS.en[0], ...MIXED.wide],
  wideCkb: [CREDITS.ckb[0], ...MIXED.wide],
};
/** A Chinese and Japanese pair of names: no font on the card has their letters, so the entry must not be drawn at all (never as empty boxes). */
const CJK_ENTRY = "山田太郎 佐藤花子, CC BY-SA 4.0";
const CREDITS_CJK = {
  mixed: ["Photos: Wikimedia Commons", `${CJK_ENTRY} · Jane Doe, CC BY 2.0`, "Иван Петров, CC BY 3.0"],
  only: [CREDITS.ckb[0], `${CJK_ENTRY} · 田中一郎, CC BY 4.0`],
};

/** A story with the hook over a photograph (photo 0) or not; the beat is over a photograph in both. */
const photoStory = (hookPhoto: number | null): Scene[] => [
  { type: "hook", text: EN.hook, voice: EN.voice, photo: hookPhoto },
  { type: "story", text: EN.beat, voice: EN.voice, photo: 0 },
  { type: "cta", text: EN.cta, voice: EN.voice },
];

describe.skipIf(!PYTHON)("adfilm/render.py, run on job files", () => {
  const r: Record<string, Probe> = {};
  const jobs: Record<string, JobOptions> = {
    kuStory: { kind: "story", scenes: story(KU) },
    arStory: { lang: "ar", kind: "story", scenes: story(AR) },
    enStory: { lang: "en", kind: "story", scenes: story(EN) },
    // an English channel whose page is named in Arabic letters
    enArabicName: { lang: "en", kind: "story", layout: "start", brand: { name: "فایلی نهێنی", handle: "@thefile" }, scenes: story(EN) },
    enLatinName: { lang: "en", kind: "story", layout: "start", brand: { name: "فایلی نهێنی", handle: "@thefile", latin: "The File" }, scenes: story(EN) },
    // the same Sorani ad: no language in the job (what every old job is), the language named, and in Arabic
    adNoLang: { brand: AD_BRAND, scenes: AD },
    adCkb: { lang: "ckb", brand: AD_BRAND, scenes: AD },
    adArabic: { lang: "ar", brand: AD_BRAND, scenes: AD },
    adRows: { brand: { ...AD_BRAND, handle: "@gul", phone: "+964 750 123 4567" }, scenes: AD },
    // a story whose hook sits over a photograph, the same without it, and with a photograph that cannot be read
    enHookPhoto: { lang: "en", kind: "story", photos: ["photo"], scenes: photoStory(0) },
    enHookNoPhoto: { lang: "en", kind: "story", photos: ["photo"], scenes: photoStory(null) },
    enHookBrokenPhoto: { lang: "en", kind: "story", photos: ["broken"], scenes: photoStory(0) },
    enHookBrokenNone: { lang: "en", kind: "story", photos: ["broken"], scenes: photoStory(null) },
    kuHookPhoto: { kind: "story", photos: ["photo"], scenes: story(KU).map((s, i) => (i === 0 ? { ...s, photo: 0 } : s)) },
    // the same story in each language over a snow-white photograph and over an ordinary one: hook and beat both sit over it
    kuOverWhite: { kind: "story", photos: ["white"], scenes: overPhoto(KU) },
    arOverWhite: { lang: "ar", kind: "story", photos: ["white"], scenes: overPhoto(AR) },
    enOverWhite: { lang: "en", kind: "story", photos: ["white"], scenes: overPhoto(EN) },
    kuOverBlue: { kind: "story", photos: ["photo"], scenes: overPhoto(KU) },
    arOverBlue: { lang: "ar", kind: "story", photos: ["photo"], scenes: overPhoto(AR) },
    // an ad: a hook never draws a photograph, whatever the job says
    adHookPhoto: { brand: AD_BRAND, photos: ["photo"], scenes: AD.map((s, i) => (i === 0 ? { ...s, photo: 0 } : s)) },
    // a story asked wide (16:9): in each language, over an ordinary and over a snow-white photograph, without a photograph, with credits
    wideEn: { lang: "en", kind: "story", format: "wide", scenes: story(EN) },
    wideAr: { lang: "ar", kind: "story", format: "wide", scenes: story(AR) },
    wideKu: { kind: "story", format: "wide", scenes: story(KU) },
    wideKuLang: { lang: "ckb", kind: "story", format: "wide", scenes: story(KU) },
    wideEnBlue: { lang: "en", kind: "story", format: "wide", photos: ["photo"], scenes: overPhoto(EN) },
    wideArBlue: { lang: "ar", kind: "story", format: "wide", photos: ["photo"], scenes: overPhoto(AR) },
    wideKuBlue: { kind: "story", format: "wide", photos: ["photo"], scenes: overPhoto(KU) },
    wideEnWhite: { lang: "en", kind: "story", format: "wide", photos: ["white"], scenes: overPhoto(EN) },
    wideArWhite: { lang: "ar", kind: "story", format: "wide", photos: ["white"], scenes: overPhoto(AR) },
    wideKuWhite: { kind: "story", format: "wide", photos: ["white"], scenes: overPhoto(KU) },
    wideEnBroken: { lang: "en", kind: "story", format: "wide", photos: ["broken"], scenes: overPhoto(EN) },
    wideEnHandle: { lang: "en", kind: "story", format: "wide", brand: { name: "The Secret File", handle: "@thesecretfile" }, scenes: story(EN) },
    wideEnCredits: { lang: "en", kind: "story", format: "wide", photos: ["photo"], credits: CREDITS.en, scenes: overPhoto(EN) },
    wideArCredits: { lang: "ar", kind: "story", format: "wide", photos: ["photo"], credits: CREDITS.ar, scenes: overPhoto(AR) },
    wideKuCredits: { kind: "story", format: "wide", photos: ["photo"], credits: CREDITS.ckb, scenes: overPhoto(KU) },
    // the same vertical stories with and without credits on their closing scene
    kuCredits: { kind: "story", photos: ["photo"], credits: CREDITS.ckb, scenes: overPhoto(KU) },
    enCredits: { lang: "en", kind: "story", photos: ["photo"], credits: CREDITS.en, scenes: overPhoto(EN) },
    arCredits: { lang: "ar", kind: "story", photos: ["photo"], credits: CREDITS.ar, scenes: overPhoto(AR) },
    enNoCredits: { lang: "en", kind: "story", photos: ["photo"], scenes: overPhoto(EN) },
    arNoCredits: { lang: "ar", kind: "story", photos: ["photo"], scenes: overPhoto(AR) },
    kuNoCredits: { kind: "story", photos: ["photo"], scenes: overPhoto(KU) },
    // an ad that was (wrongly) given a wide format and credits: it is still the vertical ad it always was
    adWideCredits: { brand: AD_BRAND, format: "wide", credits: CREDITS.ckb, scenes: AD },
    // credit lines with authors in several scripts, vertical and wide, in each reading direction
    kuCreditsMixed: { kind: "story", photos: ["photo"], credits: CREDITS_MIXED.ckb, scenes: overPhoto(KU) },
    arCreditsMixed: { lang: "ar", kind: "story", photos: ["photo"], credits: CREDITS_MIXED.ar, scenes: overPhoto(AR) },
    enCreditsMixed: { lang: "en", kind: "story", photos: ["photo"], credits: CREDITS_MIXED.en, scenes: overPhoto(EN) },
    wideKuCreditsMixed: { kind: "story", format: "wide", photos: ["photo"], credits: CREDITS_MIXED.wideCkb, scenes: overPhoto(KU) },
    wideEnCreditsMixed: { lang: "en", kind: "story", format: "wide", photos: ["photo"], credits: CREDITS_MIXED.wideEn, scenes: overPhoto(EN) },
    // an author the card has no font for: Chinese and Japanese letters
    wideEnCreditsCjk: { lang: "en", kind: "story", format: "wide", photos: ["photo"], credits: CREDITS_CJK.mixed, scenes: overPhoto(EN) },
    kuCreditsCjk: { kind: "story", photos: ["photo"], credits: CREDITS_CJK.mixed, scenes: overPhoto(KU) },
    kuCreditsCjkOnly: { kind: "story", photos: ["photo"], credits: CREDITS_CJK.only, scenes: overPhoto(KU) },
  };

  beforeAll(async () => {
    PHOTO = await sharp({ create: { width: 1350, height: 2400, channels: 3, background: { r: 40, g: 120, b: 160 } } }).jpeg().toBuffer();
    WHITE = await sharp({ create: { width: 1350, height: 2400, channels: 3, background: { r: 252, g: 252, b: 252 } } }).jpeg().toBuffer();
    PHOTO_W = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: { r: 40, g: 120, b: 160 } } }).jpeg().toBuffer();
    WHITE_W = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: { r: 252, g: 252, b: 252 } } }).jpeg().toBuffer();
    // a few probes at a time (each is a python process that loads the drawing library and the fonts): forty at once starve a busy machine
    const todo = Object.entries(jobs);
    const worker = async () => {
      for (let next = todo.shift(); next; next = todo.shift()) r[next[0]] = await probe(writeJob(next[0], next[1]));
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  }, 600_000);
  afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

  it("draws every scene of a story (hook, beats, footage on the look's own background, call to action) in all three languages", () => {
    for (const k of ["kuStory", "arStory", "enStory"]) {
      expect(r[k].scenes.map((s) => s.type), k).toEqual(["hook", "story", "footage", "cta"]);
      for (const s of r[k].scenes) expect(s.md5, `${k} scene ${s.i}`).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  describe("the logo mark of a story's hook", () => {
    for (const k of ["kuStory", "arStory", "enStory"]) {
      it(`stays clear of a two-line title (${k})`, () => {
        const hook = r[k].scenes[0];
        expect(hook.headlines[0][5], "the title must wrap to two lines for this to mean anything").toBe(2);
        expect(hook.ink).toBeTruthy();
        expect(hook.marks).toHaveLength(1);
        // the mark ends above the first letter of the title, and stays inside the safe area
        expect(tileBottom(hook.marks[0])).toBeLessThanOrEqual(hook.ink![0]);
        expect(tileTop(hook.marks[0])).toBeGreaterThanOrEqual(r[k].safe[1]);
      });
    }
  });

  describe("the closing card of a Sorani ad", () => {
    it("is where it always was when the page has no phone and no handle (no rows)", () => {
      for (const k of ["adNoLang", "adCkb"]) {
        const cta = r[k].scenes.at(-1)!;
        expect(cta.marks, k).toHaveLength(1);
        expect(cta.marks[0][0], k).toBeCloseTo(540, 6);
        expect(cta.marks[0][1], k).toBeCloseTo(1920 * 0.135, 6);
        expect(cta.marks[0][2], k).toBeCloseTo(190, 6);
        expect(cta.headlines.map((h) => h[1]), k).toEqual([expect.closeTo(1920 * 0.29, 6), expect.closeTo(1920 * 0.42, 6)]);
      }
    });

    it("is drawn the same whether or not the job names the language (ckb)", () => {
      expect(r.adCkb.scenes.map((s) => s.md5)).toEqual(r.adNoLang.scenes.map((s) => s.md5));
    });

    it("is re-centred only in the other languages", () => {
      const ar = r.adArabic.scenes.at(-1)!;
      expect(ar.marks[0][1]).toBeGreaterThan(1920 * 0.135 + 10);
      expect(ar.md5).not.toBe(r.adNoLang.scenes.at(-1)!.md5);
    });

    it("keeps its card and rows where they were when the page has a phone and a handle", () => {
      const cta = r.adRows.scenes.at(-1)!;
      expect(cta.marks[0][1]).toBeCloseTo(1920 * 0.135, 6);
      expect(cta.headlines[0][1]).toBeCloseTo(1920 * 0.29, 6);
      // the name sits under the card: 0.36 + the card (two rows) + 60 + 110
      expect(cta.headlines[1][1]).toBeCloseTo(1920 * 0.36 + (120 + 130) + 60 + 110, 6);
      expect(cta.texts).toContain("+964 750 123 4567");
    });

    it("still takes the first letter of an Arabic-script name for its monogram", () => {
      expect(r.adNoLang.scenes[0].texts).toContain("د");
    });
  });

  describe("the hook of a story over a photograph", () => {
    const hook = (k: string) => r[k].scenes[0];

    it("draws a different frame than the same hook without the photograph, and still draws its headline, once", () => {
      expect(hook("enHookPhoto").md5).not.toBe(hook("enHookNoPhoto").md5);
      expect(hook("enHookPhoto").headlines.map((h) => h[0])).toEqual([EN.hook]);
      expect(hook("enHookNoPhoto").headlines.map((h) => h[0])).toEqual([EN.hook]);
      expect(hook("enHookPhoto").headlines[0][1]).toBeCloseTo(hook("enHookNoPhoto").headlines[0][1], 6);
    });

    it("writes the headline in white over the photograph, and in the look's own ink without it", () => {
      expect(hook("enHookPhoto").headlines[0][6]).toBe("#FFFFFF");
      expect(hook("enHookNoPhoto").headlines[0][6]).not.toBe("#FFFFFF");
    });

    it("keeps a smaller brand mark inside the safe area and above the headline", () => {
      const h = hook("enHookPhoto");
      expect(h.marks).toHaveLength(1);
      expect(h.marks[0][2]).toBeLessThanOrEqual(200);
      expect(h.ink).toBeTruthy();
      expect(tileBottom(h.marks[0])).toBeLessThanOrEqual(h.ink![0]);
      expect(tileTop(h.marks[0])).toBeGreaterThanOrEqual(r.enHookPhoto.safe[1]);
    });

    it("falls back to exactly the hook it always drew when the photograph cannot be read", () => {
      expect(hook("enHookBrokenPhoto").md5).toBe(hook("enHookBrokenNone").md5);
      expect(hook("enHookBrokenPhoto").marks).toEqual(hook("enHookBrokenNone").marks);
      expect(hook("enHookBrokenPhoto").headlines).toEqual(hook("enHookBrokenNone").headlines);
    });

    it("does not touch the other scenes, the beat's own photograph included", () => {
      for (const i of [1, 2]) expect(r.enHookPhoto.scenes[i].md5, `scene ${i}`).toBe(r.enHookNoPhoto.scenes[i].md5);
    });

    it("is drawn for a Sorani story as well (the mode only decides whether the app puts a photograph there)", () => {
      expect(r.kuHookPhoto.scenes[0].md5).not.toBe(r.kuStory.scenes[0].md5);
    });

    it("is never drawn for an ad: the hook of an ad is what it always was", () => {
      expect(r.adHookPhoto.scenes.map((s) => s.md5)).toEqual(r.adNoLang.scenes.map((s) => s.md5));
    });
  });

  describe("a story over a photograph, in any language", () => {
    /** WCAG contrast of white text over a background of the given relative luminance. */
    const contrast = (lum: number) => 1.05 / (lum + 0.05);

    for (const [lang, white, blue] of [
      ["Sorani", "kuOverWhite", "kuOverBlue"],
      ["Arabic", "arOverWhite", "arOverBlue"],
      ["English", "enOverWhite", null],
    ] as const) {
      it(`keeps the headline readable (contrast of at least 4.5 to 1) over a snow-white photograph: ${lang}`, () => {
        for (const i of [0, 1]) {
          const s = r[white].scenes[i];
          expect(s.bg, `${white} scene ${i}`).toBeTruthy();
          expect(s.bright, `${white} scene ${i}`).toBeGreaterThan(0.95);
          expect(contrast(s.bg![2]), `${white} scene ${i}`).toBeGreaterThanOrEqual(4.5);
          // the headline is drawn, once, in white, from the right text
          expect(s.headlines).toHaveLength(1);
          expect(s.headlines[0][6]).toBe("#FFFFFF");
        }
        if (blue) {
          for (const i of [0, 1]) {
            expect(r[blue].scenes[i].bright, `${blue} scene ${i}`).toBeLessThan(0.62); // an ordinary photograph keeps the veil it always had
            expect(contrast(r[blue].scenes[i].bg![2]), `${blue} scene ${i}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      });
    }

    it("draws the Sorani and Arabic headlines right to left from their own letters, and the beat from the same text as without the photograph", () => {
      expect(r.kuOverWhite.scenes[0].headlines[0][0]).toBe(KU.hook);
      expect(r.kuOverWhite.scenes[1].headlines[0][0]).toBe(KU.beat);
      expect(r.arOverWhite.scenes[0].headlines[0][0]).toBe(AR.hook);
      expect(r.kuOverWhite.scenes[0].texts.filter((t) => ARABIC.test(t)).length).toBeGreaterThan(0);
    });

    it("gives a bright photograph a darker veil than an ordinary one gets, and leaves an ordinary one alone", () => {
      // the same text over the same place: only the photograph differs
      expect(r.kuOverWhite.scenes[1].md5).not.toBe(r.kuOverBlue.scenes[1].md5);
      // the ordinary photograph's frame does not depend on how the veil is chosen: it is the one of a story with a mid-dark picture
      expect(r.kuOverBlue.scenes[1].bg![2]).toBeLessThan(0.2);
    });

    it("leaves the scenes with no photograph, and the closing card, exactly as they were drawn without one", () => {
      expect(r.kuOverWhite.scenes[2].md5).toBe(r.kuOverBlue.scenes[2].md5);
      expect(r.kuOverWhite.scenes[2].md5).not.toBe("");
    });
  });

  describe("a story's closing card", () => {
    it("is centred inside the safe area, above the caption (no phone number to call)", () => {
      for (const k of ["kuStory", "arStory", "enStory"]) {
        const cta = r[k].scenes.at(-1)!;
        expect(tileTop(cta.marks[0]), k).toBeGreaterThanOrEqual(r[k].safe[1]);
        expect(cta.headlines.at(-1)![1] + 35, k).toBeLessThanOrEqual(r[k].capTop);
      }
    });

    it("draws a Latin page name as it is, in any language", () => {
      for (const k of ["kuStory", "arStory", "enStory"]) expect(r[k].scenes.at(-1)!.headlines.at(-1)![0], k).toBe("The Secret File");
    });
  });

  describe("an English video for a page named in Arabic letters", () => {
    it("draws no Arabic-script letter anywhere: not in the monogram, not under the call to action", () => {
      for (const s of r.enArabicName.scenes) {
        expect(s.texts.filter((t) => ARABIC.test(t)), `scene ${s.i}`).toEqual([]);
        expect(s.headlines.filter((h) => ARABIC.test(h[0])), `scene ${s.i}`).toEqual([]);
      }
    });

    it("leaves the name out (the monogram becomes an icon) when no Latin form was sent", () => {
      expect(r.enArabicName.scenes.at(-1)!.headlines.at(-1)![0]).toBe("");
      expect(r.enArabicName.scenes[0].texts).not.toContain("?");
    });

    it("draws the Latin form when the job carries one (brand.latin)", () => {
      expect(r.enLatinName.scenes.at(-1)!.headlines.at(-1)![0]).toBe("The File");
      expect(r.enLatinName.scenes[0].texts).toContain("T");
      for (const s of r.enLatinName.scenes) expect(s.texts.filter((t) => ARABIC.test(t)), `scene ${s.i}`).toEqual([]);
    });
  });

  describe("a story asked wide (16:9, for YouTube)", () => {
    const wideJobs = ["wideEn", "wideAr", "wideKu", "wideKuLang"] as const;
    const columns = (k: string) => r[k].scenes.flatMap((s) => s.wheads.map((h) => ({ scene: s, h })));

    it("is drawn on a 1920x1080 frame, with the same scenes as the vertical story, and every scene draws", () => {
      for (const k of wideJobs) {
        expect(r[k].W, k).toBe(1920);
        expect(r[k].H, k).toBe(1080);
        expect(r[k].wide, k).toBe(true);
        expect(r[k].scenes.map((s) => s.type), k).toEqual(["hook", "story", "footage", "cta"]);
        for (const s of r[k].scenes) expect(s.md5, `${k} scene ${s.i}`).toMatch(/^[0-9a-f]{32}$/);
      }
      for (const k of ["kuStory", "arStory", "enStory"]) {
        expect(r[k].W, k).toBe(1080);
        expect(r[k].H, k).toBe(1920);
        expect(r[k].wide, k).toBe(false);
      }
    });

    it("reads Sorani, Arabic and English text from the same job as a vertical story does, from the job's own words", () => {
      expect(r.wideEn.scenes[0].wheads.map((h) => h[0])).toEqual([EN.hook]);
      expect(r.wideAr.scenes[0].wheads.map((h) => h[0])).toEqual([AR.hook]);
      expect(r.wideKu.scenes[0].wheads.map((h) => h[0])).toEqual([KU.hook]);
      expect(r.wideEn.scenes[1].wheads.map((h) => h[0])).toEqual([EN.beat]);
      expect(r.wideEn.scenes.at(-1)!.wheads.map((h) => h[0])).toEqual([EN.cta, "The Secret File"]);
    });

    it("sets every text column on the side the language is read from: the left for English, the right for Arabic and Sorani", () => {
      for (const k of wideJobs) {
        expect(r[k].rtl, k).toBe(k !== "wideEn");
        for (const { scene, h } of columns(k)) {
          const [, edge, , maxW, , , widest] = h;
          if (r[k].rtl) {
            expect(edge, `${k} scene ${scene.i}`).toBeGreaterThan(960);
            expect(edge, `${k} scene ${scene.i}`).toBeLessThanOrEqual(r[k].safe[2]);
            expect(edge - widest, `${k} scene ${scene.i}`).toBeGreaterThanOrEqual(r[k].safe[0]);
          } else {
            expect(edge, `${k} scene ${scene.i}`).toBeLessThan(960);
            expect(edge, `${k} scene ${scene.i}`).toBeGreaterThanOrEqual(r[k].safe[0]);
            expect(edge + widest, `${k} scene ${scene.i}`).toBeLessThanOrEqual(r[k].safe[2]);
          }
          // no headline is wider than its column, and the column is no wider than about half of the frame
          expect(widest, `${k} scene ${scene.i}`).toBeLessThanOrEqual(maxW + 1);
          expect(maxW, `${k} scene ${scene.i}`).toBeLessThanOrEqual(1920 * 0.55);
        }
      }
    });

    it("keeps every text column inside the title-safe area and above the caption", () => {
      for (const k of wideJobs) {
        for (const { scene, h } of columns(k)) {
          const [, , top, , size, lines] = h;
          expect(top, `${k} scene ${scene.i}`).toBeGreaterThanOrEqual(r[k].safe[1]);
          expect(top + size * 1.22 * lines, `${k} scene ${scene.i}`).toBeLessThanOrEqual(r[k].capTop);
        }
      }
    });

    it("draws a title card (no photograph) with the large mark on the other side of the text, clear of it", () => {
      for (const k of wideJobs) {
        for (const i of [0, 3]) {
          const scene = r[k].scenes[i];
          expect(scene.marks, `${k} scene ${i}`).toHaveLength(1);
          const [cx, cy, size] = scene.marks[0];
          expect(size, `${k} scene ${i}`).toBeGreaterThanOrEqual(280);
          // inside the title-safe area
          expect(cy - size * 0.45, `${k} scene ${i}`).toBeGreaterThanOrEqual(r[k].safe[1]);
          expect(cy + size * 0.45, `${k} scene ${i}`).toBeLessThanOrEqual(r[k].capTop);
          // on the half the text does not start from, and clear of every column of the scene
          expect(cx > 960, `${k} scene ${i}`).toBe(!r[k].rtl);
          for (const h of scene.wheads) {
            const [, edge, , , , , widest] = h;
            const [x0, x1] = r[k].rtl ? [edge - widest, edge] : [edge, edge + widest];
            expect(cx - size * 0.45 >= x1 || cx + size * 0.45 <= x0, `${k} scene ${i}: the mark meets the text`).toBe(true);
          }
        }
      }
    });

    it("keeps a small brand stamp in the top corner, above the text, over a photograph", () => {
      for (const [k, rtl] of [["wideEnBlue", false], ["wideEnWhite", false], ["wideArWhite", true], ["wideKuWhite", true]] as const) {
        const hook = r[k].scenes[0];
        expect(hook.marks, k).toHaveLength(1);
        const [cx, cy, size] = hook.marks[0];
        expect(size, k).toBeLessThanOrEqual(160);
        expect(cy - size * 0.45, k).toBeGreaterThanOrEqual(r[k].safe[1]);
        expect(cy + size * 0.45, k).toBeLessThanOrEqual(hook.wheads[0][2]);
        expect(cx < 960, k).toBe(!rtl);
      }
    });

    it("keeps the headline readable (contrast of at least 4.5 to 1) over a snow-white photograph, in every language", () => {
      const contrast = (lum: number) => 1.05 / (lum + 0.05);
      for (const k of ["wideEnWhite", "wideArWhite", "wideKuWhite"]) {
        for (const i of [0, 1]) {
          const s = r[k].scenes[i];
          expect(s.bg, `${k} scene ${i}`).toBeTruthy();
          expect(s.bright, `${k} scene ${i}`).toBeGreaterThan(0.95);
          expect(contrast(s.bg![2]), `${k} scene ${i}`).toBeGreaterThanOrEqual(4.5);
          expect(s.wheads[0][7], `${k} scene ${i}`).toBe("#FFFFFF");
        }
      }
      // an ordinary photograph keeps the veil it has, and is readable too
      for (const i of [0, 1]) {
        expect(r.wideEnBlue.scenes[i].bright, `scene ${i}`).toBeLessThan(0.62);
        expect(contrast(r.wideEnBlue.scenes[i].bg![2]), `scene ${i}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("falls back to the background of the look when the photograph cannot be read", () => {
      expect(r.wideEnBroken.scenes[0].md5).toBe(r.wideEn.scenes[0].md5);
      expect(r.wideEnBroken.scenes[0].wheads[0][7]).not.toBe("#FFFFFF");
    });

    it("draws a different frame over a photograph than without, and the closing card does not depend on a photograph", () => {
      expect(r.wideEnBlue.scenes[0].md5).not.toBe(r.wideEn.scenes[0].md5);
      expect(r.wideEnBlue.scenes[1].md5).not.toBe(r.wideEnBroken.scenes[1].md5);
      expect(r.wideEnBlue.scenes.at(-1)!.md5).toBe(r.wideEnBroken.scenes.at(-1)!.md5);
    });

    it("sets the handle of the page under the call to action, on the text's side, clear of the name and the caption", () => {
      const cta = r.wideEnHandle.scenes.at(-1)!;
      expect(cta.texts).toContain("@thesecretfile");
      const [, , , , size, lines] = cta.wheads[0];
      const [, , nameTop, , nameSize] = cta.wheads[1];
      expect(nameTop).toBeGreaterThan(cta.wheads[0][2] + size * 1.22 * lines);
      expect(nameTop + nameSize * 1.22).toBeLessThanOrEqual(r.wideEnHandle.capTop);
    });

    it("is never drawn for an ad: a wide format and credits on an ad's job change nothing", () => {
      expect(r.adWideCredits.W).toBe(1080);
      expect(r.adWideCredits.H).toBe(1920);
      expect(r.adWideCredits.wide).toBe(false);
      expect(r.adWideCredits.scenes.map((s) => s.md5)).toEqual(r.adNoLang.scenes.map((s) => s.md5));
      expect(r.adWideCredits.scenes.flatMap((s) => s.credits)).toEqual([]);
    });
  });

  describe("the photo credits on the closing scene of a story", () => {
    const cases = [
      ["kuCredits", "kuNoCredits", "ckb", false],
      ["arCredits", "arNoCredits", "ar", false],
      ["enCredits", "enNoCredits", "en", false],
      ["wideKuCredits", "wideKuBlue", "ckb", true],
      ["wideArCredits", "wideArBlue", "ar", true],
      ["wideEnCredits", "wideEnBlue", "en", true],
    ] as const;

    it("draws each credit line on the last scene, and on no other", () => {
      for (const [k, , lang] of cases) {
        const lines = CREDITS[lang];
        const last = r[k].scenes.at(-1)!;
        for (const line of lines) expect(last.texts, `${k}: ${line}`).toContain(line);
        for (const s of r[k].scenes.slice(0, -1)) {
          expect(s.credits, `${k} scene ${s.i}`).toEqual([]);
          for (const line of lines) expect(s.texts.includes(line), `${k} scene ${s.i}`).toBe(false);
        }
        expect(last.credits, k).toHaveLength(1);
        expect(last.credits[0][3], k).toBe(lines.length);
      }
    });

    it("keeps the block small and readable: at least 23 px, never larger than 32, and above the caption", () => {
      for (const [k] of cases) {
        const [bottom, maxW, size, n] = r[k].scenes.at(-1)!.credits[0];
        expect(size, k).toBeGreaterThanOrEqual(23);
        expect(size, k).toBeLessThanOrEqual(32);
        expect(bottom, k).toBeLessThanOrEqual(r[k].capTop);
        // it fits in the width it was given, which is inside the safe area
        expect(maxW, k).toBeLessThanOrEqual(r[k].safe[2] - r[k].safe[0]);
        expect(n, k).toBeLessThanOrEqual(3);
      }
    });

    it("sits below everything else of the closing scene, which makes room for it", () => {
      for (const [k, , , wide] of cases) {
        const cta = r[k].scenes.at(-1)!;
        const [bottom, , size, n] = cta.credits[0];
        const top = bottom - size * 1.42 * n;
        if (wide) {
          for (const [, , t, , sz, lines] of cta.wheads) expect(t + sz * 1.22 * lines, k).toBeLessThanOrEqual(top);
          // the large mark does not touch it either
          const [, cy, ms] = cta.marks[0];
          expect(cy + ms * 0.45, k).toBeLessThanOrEqual(top + 1);
        } else {
          // the vertical card's lowest headline (the page's name) is centred on its y
          expect(cta.headlines.at(-1)![1] + 35, k).toBeLessThanOrEqual(top);
          expect(tileTop(cta.marks[0]), k).toBeGreaterThanOrEqual(r[k].safe[1]);
        }
      }
    });

    it("draws the wide credits against the side the text starts from", () => {
      expect(r.wideEnCredits.scenes.at(-1)!.credits[0][4]).toBeCloseTo(r.wideEnCredits.scenes.at(-1)!.wheads[0][1], 6);
      expect(r.wideKuCredits.scenes.at(-1)!.credits[0][4]).toBeCloseTo(r.wideKuCredits.scenes.at(-1)!.wheads[0][1], 6);
      // a vertical card is centred: no edge
      expect(r.kuCredits.scenes.at(-1)!.credits[0][4]).toBeNull();
    });

    it("changes nothing but the closing scene: a story without credits is drawn as it always was", () => {
      for (const [k, plain] of cases) {
        for (const s of r[k].scenes.slice(0, -1)) expect(s.md5, `${k} scene ${s.i}`).toBe(r[plain].scenes[s.i].md5);
        expect(r[k].scenes.at(-1)!.md5, k).not.toBe(r[plain].scenes.at(-1)!.md5);
      }
      for (const k of ["kuNoCredits", "arNoCredits", "enNoCredits", "wideEn", "wideAr", "wideKu", "wideEnBlue"]) expect(r[k].scenes.flatMap((s) => s.credits), k).toEqual([]);
    });
  });

  describe("credit lines with authors in several scripts (Arabic letters among Latin ones, Chinese letters)", () => {
    const lastOf = (k: string) => r[k].scenes.at(-1)!;
    const centreOf = (k: string, text: string) => lastOf(k).textAt.find(([t]) => t === text)![1];
    const EAST_ASIAN = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u;
    const vertical = ["kuCreditsMixed", "arCreditsMixed", "enCreditsMixed"];
    const wide = ["wideKuCreditsMixed", "wideEnCreditsMixed"];
    /** The Arabic-script entry and the Latin one of the third line, and how many pieces the renderer sets the Arabic-script entry in (the name, the Arabic words, the licence). */
    const entries = (k: string) =>
      vertical.includes(k)
        ? { ar: "أحمد الراشد, CC BY 4.0", la: "Jane Doe, CC BY 2.0", pieces: 2, latin: MIXED.vertical[0] }
        : { ar: "Ahmad Al-Rashid أحمد الراشد, CC BY 4.0", la: "Jean-Baptiste Poquelin, CC BY 2.0", pieces: 3, latin: MIXED.wide[0] };
    /**
     * Where the pieces of the Arabic-script entry were drawn: the Latin name, the Arabic name, and the licence. The licence is a run of its own
     * (in a video read left to right it carries the comma that follows the name: ", CC BY 4.0"), so the comma never lands on the wrong side.
     */
    const isLicence = (t: string) => t.replace(/^, /, "") === "CC BY 4.0";
    const arabicEntryX = (k: string) => lastOf(k).textAt.filter(([t]) => t.trim() === "Ahmad Al-Rashid" || isLicence(t) || /أحمد/.test(t)).map(([, x]) => x);

    it("draws a line that holds Arabic script entry by entry, each entry its own run, so every licence stays beside its own author", () => {
      for (const k of [...vertical, ...wide]) {
        const e = entries(k);
        const [, , , n, , runs] = lastOf(k).credits[0];
        expect(n, k).toBe(3);
        // the label and the line of Latin and Cyrillic names are one piece each (as they always were)
        expect(runs[0], k).toHaveLength(1);
        expect(runs[1], k).toEqual([["ltr", e.latin]]);
        // the line with the Arabic-script author is three runs in the order the entries were written: the entry, the separator, the entry
        expect(runs[2], k).toEqual([["ar", e.ar], ["sep", " · "], ["ltr", e.la]]);
        const texts = lastOf(k).texts;
        expect(texts, k).toContain(e.la);
        expect(texts.some(isLicence), k).toBe(true);
        expect(arabicEntryX(k), k).toHaveLength(e.pieces);
        // no drawn string holds an entry of the line together with a piece of the other one
        for (const t of texts) expect(/CC BY 2\.0/.test(t) && /أحمد/.test(t), `${k}: ${t}`).toBe(false);
      }
    });

    it("puts the comma after an Arabic-script name on the right side: with the name in a video read right to left, with the licence in one read left to right", () => {
      for (const k of ["kuCreditsMixed", "arCreditsMixed", "wideKuCreditsMixed"]) {
        expect(lastOf(k).texts.some((t) => /أحمد الراشد,$/.test(t)), k).toBe(true);
        expect(lastOf(k).texts.filter(isLicence), k).toEqual(["CC BY 4.0"]);
      }
      for (const k of ["enCreditsMixed", "wideEnCreditsMixed"]) {
        expect(lastOf(k).texts.some((t) => /أحمد الراشد$/.test(t)), k).toBe(true);
        expect(lastOf(k).texts.filter(isLicence), k).toEqual([", CC BY 4.0"]);
      }
    });

    it("sets the entries in the order the video is read in: from the right in Sorani and Arabic, from the left in English", () => {
      for (const k of ["kuCreditsMixed", "arCreditsMixed", "wideKuCreditsMixed"]) expect(Math.min(...arabicEntryX(k)), k).toBeGreaterThan(centreOf(k, entries(k).la));
      for (const k of ["enCreditsMixed", "wideEnCreditsMixed"]) expect(Math.max(...arabicEntryX(k)), k).toBeLessThan(centreOf(k, entries(k).la));
    });

    it("keeps the line centred on the frame (vertical) or against the side the text starts from (wide)", () => {
      for (const k of vertical) {
        const xs = [...arabicEntryX(k), centreOf(k, entries(k).la)];
        // every piece stands inside the 1080 px frame, around its middle
        for (const x of xs) {
          expect(x, k).toBeGreaterThan(0);
          expect(x, k).toBeLessThan(1080);
        }
        expect((Math.min(...xs) + Math.max(...xs)) / 2, k).toBeGreaterThan(540 - 250);
        expect((Math.min(...xs) + Math.max(...xs)) / 2, k).toBeLessThan(540 + 250);
        expect(lastOf(k).credits[0][2], k).toBeGreaterThanOrEqual(23);
      }
      // wide: Sorani lines end at the edge the text starts from (the right one), English lines start at it (the left one)
      const [, , , , edge] = lastOf("wideKuCreditsMixed").credits[0];
      expect(edge).not.toBeNull();
      expect(Math.max(...arabicEntryX("wideKuCreditsMixed"))).toBeLessThanOrEqual(edge! + 1);
      const [, , , , edgeEn] = lastOf("wideEnCreditsMixed").credits[0];
      expect(Math.min(...arabicEntryX("wideEnCreditsMixed"))).toBeGreaterThanOrEqual(edgeEn! - 1);
      for (const k of wide) expect(lastOf(k).credits[0][2], k).toBeGreaterThanOrEqual(23);
    });

    it("never draws an author in letters the card has no font for (Chinese and Japanese would be empty boxes): the entry is left out, the others stay", () => {
      for (const k of ["wideEnCreditsCjk", "kuCreditsCjk"]) {
        const [, , , n, , runs] = lastOf(k).credits[0];
        expect(n, k).toBe(3);
        expect(lastOf(k).texts.join(" "), k).not.toMatch(EAST_ASIAN);
        // "Name, CC BY-SA 4.0 · Jane Doe, CC BY 2.0": only the second entry is left, as a line of its own
        expect(runs[1], k).toEqual([["ltr", "Jane Doe, CC BY 2.0"]]);
        expect(lastOf(k).texts, k).toContain("Jane Doe, CC BY 2.0");
        expect(lastOf(k).texts, k).toContain("Иван Петров, CC BY 3.0");
      }
    });

    it("leaves a line out whose every entry has no font: the block has only the lines that remain", () => {
      const only = lastOf("kuCreditsCjkOnly");
      expect(only.credits[0][3]).toBe(1);
      expect(only.texts.join(" ")).not.toMatch(EAST_ASIAN);
      expect(only.texts).toContain(CREDITS.ckb[0]);
    });

    it("draws Cyrillic and Greek names in the card's Latin font: one piece, as before", () => {
      for (const k of ["kuCreditsMixed", "enCreditsMixed"]) expect(lastOf(k).texts, k).toContain(MIXED.vertical[0]);
    });

    it("changes nothing but the closing scene", () => {
      for (const [k, plain] of [["kuCreditsMixed", "kuNoCredits"], ["arCreditsMixed", "arNoCredits"], ["enCreditsMixed", "enNoCredits"]] as const) {
        for (const s of r[k].scenes.slice(0, -1)) expect(s.md5, `${k} scene ${s.i}`).toBe(r[plain].scenes[s.i].md5);
      }
    });
  });
});
