import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SCENE_TYPES } from "@/lib/advideo/spec";

// The renderer is Python (adfilm/render.py) and cannot be imported here, so this reads its source and checks the
// contract the TypeScript side depends on: every scene type the script can contain has a drawing branch of its own
// (a type the renderer does not know used to be drawn silently as a call-to-action card), and the language and
// kind of the job are read from job.json (the render step has no other way to learn them). These are checks of the
// text of the file; what the renderer actually draws is run and measured in render-run.test.ts (needs python).
const SOURCE = fs.readFileSync(path.join(process.cwd(), "adfilm", "render.py"), "utf8");
const WORKER = fs.readFileSync(path.join(process.cwd(), "adfilm", "worker.mjs"), "utf8");

/** The text of one class of render.py: from its line to the next top-level def or class. */
function classBody(name: string): string {
  const start = SOURCE.indexOf(`\nclass ${name}(`);
  expect(start, `class ${name}`).toBeGreaterThan(-1);
  const rest = SOURCE.slice(start + 1);
  const next = rest.slice(1).search(/\n(?:def|class) /);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/** The text of one top-level function of render.py: from its def to the next top-level def or class. */
function functionBody(name: string): string {
  const start = SOURCE.indexOf(`\ndef ${name}(`);
  expect(start, `def ${name}`).toBeGreaterThan(-1);
  const rest = SOURCE.slice(start + 1);
  const next = rest.slice(1).search(/\n(?:def|class) /);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/** The text of build(): from its def to the next top-level def. */
function buildBody(): string {
  const start = SOURCE.indexOf("\ndef build():");
  expect(start).toBeGreaterThan(-1);
  const rest = SOURCE.slice(start + 1);
  const next = rest.slice(1).search(/\n(?:def|class) /);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("adfilm/render.py contract", () => {
  const body = buildBody();

  it("draws every scene type of the script with a branch of its own", () => {
    for (const type of SCENE_TYPES) {
      expect(body, `no \`t == '${type}'\` branch in build()`).toMatch(new RegExp(`\\bt == '${type}'`));
    }
  });

  it("draws nothing the script cannot contain", () => {
    const drawn = [...body.matchAll(/\bt == '([a-z_]+)'/g)].map((m) => m[1]);
    expect(drawn.length).toBeGreaterThan(0);
    for (const type of drawn) expect(SCENE_TYPES as readonly string[]).toContain(type);
  });

  it("stops on an unknown scene type instead of drawing a call-to-action card", () => {
    // no bare `else:` that appends a CTA ...
    expect(body).not.toMatch(/else:\s*\n\s*scenes\.append\(CTA\(/);
    // ... the call-to-action has its own branch, and whatever is left is an error
    expect(body).toMatch(/elif t == 'cta':\s*\n\s*scenes\.append\(CTA\(i\)\)/);
    expect(body).toMatch(/else:[^\n]*\n(?:\s*#[^\n]*\n)*\s*raise ValueError/);
  });

  it("reads the video's language and kind from the job", () => {
    expect(SOURCE).toMatch(/JOB\.get\('lang'\)/);
    expect(SOURCE).toMatch(/JOB\.get\('kind'\)/);
  });

  it("never reads 'version' (old jobs and new jobs are the same to the renderer)", () => {
    expect(SOURCE).not.toMatch(/JOB(?:\.get\(|\[)\s*['"]version['"]/);
  });

  it("reads the reading direction from the language, and falls back to the letters only when the job has none", () => {
    expect(SOURCE).toMatch(/RTL = LANG in \('ckb', 'ar'\)/);
    expect(SOURCE).toMatch(/RTL = is_arabic\(/);
  });

  it("re-centres the closing card only for a story, or for an Arabic or English card without rows (a Sorani ad keeps its layout)", () => {
    expect(SOURCE).toMatch(/if STORY or \(LANG in \('ar', 'en'\) and not rows\):/);
    expect(SOURCE).not.toMatch(/if STORY or not rows:/);
  });

  describe("the photograph behind a story's hook", () => {
    const hook = classBody("Hook");
    const story = classBody("Story");

    it("is drawn by one function that the hook and the beats share (the same slow push-in)", () => {
      expect(SOURCE).toMatch(/\ndef story_picture\(c, u, sc, prog, k\):/);
      expect(hook).toMatch(/story_picture\(c, u, sc,/);
      expect(story).toMatch(/story_picture\(c, u, sc, prog, self\.k\)/);
    });

    it("is asked for only by a story, and only when the scene's photo is an index", () => {
      expect(hook).toMatch(/if STORY and isinstance\(sc\.get\('photo'\), int\):/);
      expect(hook).not.toMatch(/if isinstance\(sc\.get\('photo'\), int\)/);
    });

    it("keeps the look's own stage for every hook without a picture, and the call to action plain", () => {
      expect(hook).toMatch(/else:\s*\n\s*stage\(c, u, gy=0\.32, seed=1\)/);
      expect(classBody("CTA")).not.toMatch(/story_picture/);
    });

    it("sits the text on a dark veil in white, and shrinks the brand mark, over a picture", () => {
      expect(hook).toMatch(/picture_veil\(c, sc\.get\('photo'\)\)/);
      expect(hook).toMatch(/\('#FFFFFF', '#FFFFFF'\) if pic else \(T\['ink'\], T\['soft'\]\)/);
      expect(hook).toMatch(/if pic:\s*\n\s*msize = L\.u\(200\)/);
    });

    it("shares the veil with the beats: the veil it always had, plus a darker band only for a bright photograph, never for a clip", () => {
      expect(story).toMatch(/picture_veil\(c, None if isinstance\(sc\.get\('clip'\), int\) else sc\.get\('photo'\)\)/);
      const veil = functionBody("picture_veil");
      // the old veil first, in the old order (so an ordinary photograph is drawn exactly as before) ...
      const old = veil.indexOf("paint('#000000', 0.34)");
      const band = veil.indexOf("if extra > 0:");
      const tint = veil.indexOf("tint_bottom(c, H * 0.3, 0.9)");
      expect(old).toBeGreaterThan(-1);
      expect(band).toBeGreaterThan(old);
      expect(tint).toBeGreaterThan(band);
      // ... and the band only from a measured brightness above 0.62
      expect(veil).toMatch(/photo_brightness\(photo\) - 0\.62/);
      expect(veil).toMatch(/if photo is not None else 0\.0/);
    });

    it("measures a photograph once, from a small copy, and takes an unreadable one for dark", () => {
      const m = functionBody("photo_brightness");
      expect(m).toMatch(/\.resize\(16, 28\)/);
      expect(m).toMatch(/if key not in _bright:/);
      expect(m).toMatch(/except Exception:\s*\n\s*value = 0\.0/);
    });

    it("has no Sorani-only branch for a story's photograph, in the renderer, the worker or the scene rule", () => {
      const lines = SOURCE.split("\n").filter((l) => /ckb/.test(l));
      // the language list, the reading direction and a comment about the old Sorani ad layout: nothing that decides about a photograph
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) expect(l, l).toMatch(/LANG = JOB\.get|RTL = LANG in|#/);
      expect(lines.join("\n")).not.toMatch(/photo/i);
      expect(WORKER).not.toMatch(/ckb/);
      expect(fs.readFileSync(path.join(process.cwd(), "adfilm", "scenes.mjs"), "utf8")).not.toMatch(/ckb/);
    });
  });

  it("downloads up to 16 photos (6 of the owner's and 10 from Wikimedia Commons, re-hosted in our storage) but only 3 clips", () => {
    expect(WORKER).toMatch(/\(props\.photos \?\? \[\]\)\.slice\(0, 16\)/);
    expect(WORKER).not.toMatch(/\(props\.photos \?\? \[\]\)\.slice\(0, 6\)/);
    expect(WORKER).toMatch(/\.slice\(0, 3\)\.entries\(\)/);
  });

  it("decides the frame of a job, and cleans its credit lines, in one small module the tests can run (scenes.mjs)", () => {
    expect(WORKER).toMatch(/import \{ cleanCredits, frameOf, settleScenes \} from "\.\/scenes\.mjs"/);
    expect(WORKER).toMatch(/const frame = frameOf\(props\);/);
    expect(WORKER).toMatch(/cleanCredits\(props\.credits, props\.kind === "story"\)/);
    // the render step learns the format from job.json alone, and says in its status which frame it drew
    expect(WORKER).toMatch(/wide = frameOf\(props\)\.wide/);
    expect(WORKER).toMatch(/format: wide \? "wide" : "vertical"/);
  });

  it("downloads only from our own storage and our own domain (a Commons photograph is never fetched by the renderer)", () => {
    expect(WORKER).toMatch(/u\.origin === BASE/);
    expect(WORKER).toMatch(/\.public\.blob\.vercel-storage\.com/);
    expect(WORKER).not.toMatch(/wikimedia\.org/i);
    expect(SOURCE).not.toMatch(/wikimedia\.org/i);
  });

  describe("the wide (16:9) format of a story", () => {
    it("is read from the job, and only a story can have it: an ad stays the vertical reel", () => {
      expect(SOURCE).toMatch(/WIDE = JOB\.get\('kind'\) == 'story' and JOB\.get\('format'\) == 'wide'/);
      expect(SOURCE).toMatch(/W, H = mv\.env_size\(\(1920, 1080\) if WIDE else \(1080, 1920\)\)/);
      // there is no second, plain vertical default beside it
      expect(SOURCE.match(/mv\.env_size\(/g)).toHaveLength(1);
    });

    it("has its own layout for the hook, the beats, the footage beat and the closing card, behind `if WIDE:`", () => {
      expect(classBody("Hook")).toMatch(/def draw_wide\(self, c, u\):/);
      expect(classBody("Hook")).toMatch(/def draw\(self, c, u\):\s*\n\s*if WIDE:\s*\n\s*return self\.draw_wide\(c, u\)/);
      expect(classBody("CTA")).toMatch(/def draw\(self, c, u\):\s*\n\s*if WIDE:\s*\n\s*return self\.draw_wide\(c, u\)/);
      expect(classBody("Story")).toMatch(/if WIDE:[\s\S]*?w_block\([\s\S]*?return/);
      expect(classBody("Clip")).toMatch(/if WIDE:[\s\S]*?w_block\([\s\S]*?return/);
    });

    it("mirrors the whole layout for the languages read from the right (the side comes from the same RTL as everything else)", () => {
      expect(SOURCE).toMatch(/DIRN = -1 if RTL else 1/);
      const edge = functionBody("w_edge");
      expect(edge).toMatch(/SAFE\[2\] - L\.u\(60\) if RTL else SAFE\[0\] \+ L\.u\(60\)/);
      expect(functionBody("w_line")).toMatch(/align='right' if RTL else 'left'/);
      expect(functionBody("wide_veil")).toMatch(/\(W, W \* 0\.14\) if RTL else \(0\.0, W \* 0\.86\)/);
    });

    it("keeps what it draws above the caption, and gives the caption its own wide size", () => {
      expect(SOURCE).toMatch(/if WIDE:\s*\n\s*#[^\n]*\n\s*CAP_SIZES = \[L\.u\(52\), L\.u\(46\), L\.u\(42\), L\.u\(38\)\]/);
      expect(functionBody("_caption_box")).toMatch(/max_w = CAP_MAX_W/);
      expect(classBody("Hook")).toMatch(/w_block\(c, u, text, sub, CAP_TOP - L\.u\(40\)/);
    });

    it("draws a photograph full-frame (the app composed it for the wide frame) under the wide veil, and the hook only in a story", () => {
      expect(classBody("Hook")).toMatch(/if STORY and isinstance\(sc\.get\('photo'\), int\):\s*\n\s*pic = story_picture\(/);
      expect(classBody("Hook")).toMatch(/wide_veil\(c, sc\.get\('photo'\)\)/);
      expect(classBody("Story")).toMatch(/wide_veil\(c, None if isinstance\(sc\.get\('clip'\), int\) else sc\.get\('photo'\)\)/);
      // a bright photograph is measured where the text column sits, from a small copy, once
      const m = functionBody("wide_brightness");
      expect(m).toMatch(/\.resize\(32, 18\)/);
      expect(m).toMatch(/if key not in _wbright:/);
    });

    it("reads nothing about the format from anywhere but the job (no environment, no file name), and leaves the vertical code alone", () => {
      expect(SOURCE).not.toMatch(/MV_SIZE/);
      // the vertical drawing of a hook, a beat and a closing card is below the wide branch, as it was
      expect(classBody("Hook")).toMatch(/hp = head_plan\(text, W \* 0\.8, L\.u\(190\)\)/);
      expect(classBody("Story")).toMatch(/hp = head_plan\(text, W \* 0\.84, L\.u\(112\)\)/);
      expect(classBody("CTA")).toMatch(/hp = head_plan\(sc\.get\('text', ''\), W \* 0\.86, L\.u\(130\)\)/);
    });

    it("leaves the stage as it was for every video that does not move its glow", () => {
      expect(functionBody("stage")).toMatch(/def stage\(c, u, gy=0\.34, seed=1, gx=0\.5\):/);
      expect(functionBody("stage")).toMatch(/radial\(W \* gx, H \* gy, L\.u\(1150\)/);
    });
  });

  describe("the photo credits of a story", () => {
    it("are read from the job's `credits` for a story only, at most three lines of at most 200 characters", () => {
      expect(SOURCE).toMatch(/_CREDITS_RAW = \[' '\.join\(s\.split\(\)\)\[:200\] for s in \(JOB\.get\('credits'\) or \[\]\) if isinstance\(s, str\) and s\.strip\(\)\]\[:3\] if STORY else \[\]/);
      // an entry written in letters neither font of the card has is left out (never drawn as empty boxes); what is left is what the closing scene draws
      expect(SOURCE).toMatch(/CREDITS = _drawable_credit_lines\(_CREDITS_RAW\)/);
      expect(functionBody("credit_drawable")).toMatch(/_covered\(ch\)/);
    });

    it("are drawn on the closing card of a vertical story and of a wide one, and by no other scene", () => {
      expect(classBody("CTA")).toMatch(/credits_block\(c, u, CAP_TOP - L\.u\(8\), credit_w\)/);
      expect(classBody("CTA")).toMatch(/credits_block\(c, u, CAP_TOP - L\.u\(8\), credit_w, edge=tx\)/);
      for (const name of ["Hook", "Story", "Value", "Product", "Clip", "Offer"]) expect(classBody(name), name).not.toMatch(/credits_block/);
    });

    it("leave the card of a video without credits exactly where it was (the room they take is 0.0 then)", () => {
      expect(functionBody("credits_height")).toMatch(/if CREDITS else 0\.0/);
      expect(classBody("CTA")).toMatch(/cap_top = CAP_TOP - credits_height\(credit_w\)/);
      expect(functionBody("credits_block")).toMatch(/if not CREDITS:\s*\n\s*return/);
    });

    it("keep the closing scene on screen a little longer, so that they can be read, only when there are some", () => {
      expect(SOURCE).toMatch(/TAIL\.append\(\(3\.6 if CREDITS else 2\.4\) if last else _tail\)/);
    });
  });

  it("draws the brand's name through NAME, which an English video keeps free of Arabic-script letters", () => {
    expect(SOURCE).toMatch(/NAME = BR\.get\('name', ''\)\s+if EN and is_arabic\(NAME or ''\):/);
    expect(SOURCE).not.toMatch(/headline\(c, BR\.get\('name'/);
  });
});
