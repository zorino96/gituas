import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
}
interface JobOptions {
  lang?: "ckb" | "ar" | "en";
  kind?: "story";
  layout?: "center" | "start" | "bottom";
  brand?: { name: string; handle?: string | null; phone?: string | null; latin?: string };
  scenes: Scene[];
}
interface Drawn {
  i: number;
  type: string;
  marks: number[][];
  headlines: [string, number, number, number, number, number | null][];
  texts: string[];
  md5: string;
  ink?: [number, number] | null;
}
interface Probe {
  W: number;
  H: number;
  capTop: number;
  safe: number[];
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

function writeJob(name: string, o: JobOptions): string {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  const scenes = o.scenes.map((s, i) => {
    fs.writeFileSync(path.join(dir, `vo-${i}.wav`), silence(6));
    return { type: s.type, text: s.text, sub: s.sub ?? null, voice: s.voice ?? s.text, icon: s.icon ?? null, photo: null, clip: s.clip ?? null, audio: `vo-${i}.wav` };
  });
  const job = {
    version: 1,
    size: [1080, 1920],
    style: "elegant",
    look: { layout: o.layout ?? "center", photo: "card", icon: "ring", background: "glow", palette: "midnight", motion: "calm", transition: "crossfade", shape: "rounded" },
    plan: null,
    brand: { primary: "#0B2545", accent: "#E0A526", logoUrl: null, tagline: null, handle: null, phone: null, ...(o.brand ?? { name: "The Secret File" }) },
    product: null,
    photos: [],
    clips: [],
    scenes,
    music: { style: "ambient", bpm: 84, key: "D", mode: "minor" },
    ...(o.lang ? { lang: o.lang } : {}),
    ...(o.kind ? { kind: o.kind } : {}),
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

const AD = [
  { type: "hook", text: "دووکانی گوڵ", sub: "بۆ هەموو کات", voice: "بەخێربێیت" },
  { type: "value", text: "گەیاندنی خێرا", sub: "بۆ هەموو شارەکان", voice: "گەیاندنی خێرامان هەیە", icon: "truck" },
  { type: "offer", text: "خەڵاتی تایبەت", sub: "تەنها ئەم هەفتەیە", voice: "خەڵاتی تایبەتمان هەیە" },
  { type: "cta", text: "پەیوەندیمان پێوە بکە", voice: "پەیوەندیمان پێوە بکە" },
];
const AD_BRAND = { name: "دووکانی گوڵ", handle: null, phone: null };

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
  };

  beforeAll(async () => {
    const done = await Promise.all(Object.entries(jobs).map(async ([k, o]) => [k, await probe(writeJob(k, o))] as const));
    for (const [k, p] of done) r[k] = p;
  }, 300_000);
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
});
