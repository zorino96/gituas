import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { rulesDryRun, rulesEnabled } from "@/lib/shop/rules/enabled";

const DIR = "src/lib/shop/rules";
const all = readdirSync(DIR).filter((f) => f.endsWith(".ts"));
// The three files that connect the rules to the database and to the buyer pipeline are the only ones allowed to reach them.
// Everything else in the folder stays pure: it is what the preview, the lint and the tests run without a database.
const BRIDGE = ["db.ts", "log.ts", "pipeline-hook.ts"];
const files = all.filter((f) => !BRIDGE.includes(f));
const source = (f: string) => readFileSync(join(DIR, f), "utf8");

describe("the rules library is pure", () => {
  it("has the files the rest of the build relies on", () => {
    expect(files.sort()).toEqual(expect.arrayContaining(["enabled.ts", "engine.ts", "fold.ts", "lint.ts", "match.ts", "preview.ts", "render.ts", "spec.ts", "types.ts"]));
  });

  it("imports nothing that reaches the database, the network, a model or the framework", () => {
    const allowed = /^(\.\/|\.\.\/(classify-rules|money|policy)$|@\/lib\/i18n\/lang$|zod$|node:crypto$)/;
    for (const f of files) {
      const imports = [...source(f).matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
      for (const spec of imports) expect(allowed.test(spec) || spec.startsWith("./"), `${f} imports ${spec}`).toBe(true);
    }
  });

  it("never calls fetch or a model, and reads the environment only in enabled.ts", () => {
    for (const f of files) {
      const code = source(f).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(code, f).not.toMatch(/\bfetch\s*\(|completeJson|XMLHttpRequest|WebSocket/);
      if (f !== "enabled.ts") expect(code, f).not.toMatch(/process\.env/);
    }
  });

  it("keeps the bridge to the database in exactly three files, which never call a model or the network", () => {
    expect(all.filter((f) => BRIDGE.includes(f)).sort()).toEqual([...BRIDGE].sort());
    for (const f of BRIDGE) {
      const code = source(f).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(code, f).not.toMatch(/\bfetch\s*\(|completeJson|XMLHttpRequest|WebSocket|process\.env/);
    }
  });

  it("holds no invisible, bidi or control character: they are written as escapes", () => {
    for (const f of all) {
      source(f).split("\n").forEach((line, i) => {
        for (const ch of line) {
          if (/[\p{Cf}\p{Cc}\p{Zl}\p{Zp}]/u.test(ch) && ch !== "\t" && ch !== "\r") {
            throw new Error(`${f}:${i + 1} has the invisible character U+${ch.codePointAt(0)!.toString(16).toUpperCase()}`);
          }
        }
      });
    }
  });
});

describe("the two switches", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("rules run only when SHOP_RULES_ENABLED is exactly 1", () => {
    vi.stubEnv("SHOP_RULES_ENABLED", "");
    expect(rulesEnabled()).toBe(false);
    for (const v of ["0", "true", "yes", "on", " 1", "1 "]) {
      vi.stubEnv("SHOP_RULES_ENABLED", v);
      expect(rulesEnabled(), JSON.stringify(v)).toBe(false);
    }
    vi.stubEnv("SHOP_RULES_ENABLED", "1");
    expect(rulesEnabled()).toBe(true);
  });

  it("the dry run is on only when RULES_DRY_RUN is exactly 1, and is read each time", () => {
    vi.stubEnv("RULES_DRY_RUN", "");
    expect(rulesDryRun()).toBe(false);
    vi.stubEnv("RULES_DRY_RUN", "1");
    expect(rulesDryRun()).toBe(true);
    vi.stubEnv("RULES_DRY_RUN", "0");
    expect(rulesDryRun()).toBe(false);
  });

  it("is off when nothing is set", () => {
    vi.stubEnv("SHOP_RULES_ENABLED", undefined as unknown as string);
    vi.stubEnv("RULES_DRY_RUN", undefined as unknown as string);
    expect(rulesEnabled()).toBe(false);
    expect(rulesDryRun()).toBe(false);
  });
});
