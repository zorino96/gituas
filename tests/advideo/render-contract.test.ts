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

  it("draws the brand's name through NAME, which an English video keeps free of Arabic-script letters", () => {
    expect(SOURCE).toMatch(/NAME = BR\.get\('name', ''\)\s+if EN and is_arabic\(NAME or ''\):/);
    expect(SOURCE).not.toMatch(/headline\(c, BR\.get\('name'/);
  });
});
