import { describe, expect, it, vi } from "vitest";

import { ar } from "@/lib/i18n/ar";
import { ckb } from "@/lib/i18n/ckb";

const cookieJar = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "gm_lang" && cookieJar.value !== undefined ? { name, value: cookieJar.value } : undefined) }),
}));

import { dict, getLang, isLang, LANG_COOKIE } from "@/lib/i18n";

/** Every leaf of a dictionary as "group.key" → value; arrays contribute "group.key.0", "group.key.1"… */
function leaves(node: unknown, path = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (typeof node === "function" || typeof node === "string") {
    out.set(path, node);
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => leaves(v, `${path}.${i}`).forEach((x, k) => out.set(k, x)));
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) leaves(v, path ? `${path}.${k}` : k).forEach((x, key) => out.set(key, x));
  } else {
    out.set(path, node);
  }
  return out;
}

// Letters Sorani has and Arabic does not (Persian/Kurdish kaf and yeh, ە ێ ۆ ڕ ڵ ڤ پ چ ژ گ). They only show up in
// Arabic text when a Kurdish string was left behind.
const KURDISH_ONLY = /[کیەێۆڕڵڤپچژگ]/;

describe("dictionaries", () => {
  const k = leaves(ckb);
  const a = leaves(ar);

  it("ckb and ar have identical key sets", () => {
    expect([...a.keys()].sort()).toEqual([...k.keys()].sort());
  });

  it("has no empty value in either language", () => {
    for (const [name, d] of [["ckb", k], ["ar", a]] as const) {
      for (const [key, v] of d) {
        if (typeof v === "function") {
          const s = (v as (...x: unknown[]) => unknown)(2, 3, 2026);
          expect(typeof s, `${name}.${key}() returns a string`).toBe("string");
          expect((s as string).trim(), `${name}.${key}() is empty`).not.toBe("");
        } else {
          expect(typeof v, `${name}.${key} is a string`).toBe("string");
          expect((v as string).trim(), `${name}.${key} is empty`).not.toBe("");
        }
      }
    }
  });

  it("keeps the same kind of value (string / function) under every key", () => {
    for (const [key, v] of k) expect(typeof a.get(key), key).toBe(typeof v);
  });

  it("leaves no Kurdish-only letters in the Arabic", () => {
    for (const [key, v] of a) {
      const s = typeof v === "function" ? (v as (...x: unknown[]) => string)("x", 3, 2026) : (v as string);
      expect(KURDISH_ONLY.test(s), `ar.${key} still has Kurdish letters: ${s}`).toBe(false);
    }
  });

  it("uses Arabic plural forms for times", () => {
    expect(ar.time.minutes(1)).toBe("منذ دقيقة");
    expect(ar.time.minutes(2)).toBe("منذ دقيقتين");
    expect(ar.time.minutes(5)).toContain("دقائق");
    expect(ar.time.minutes(15)).toContain("دقيقة");
    expect(ar.time.days(3)).toContain("أيام");
  });
});

describe("getLang / dict", () => {
  it("reads the gm_lang cookie and defaults to Sorani", async () => {
    expect(LANG_COOKIE).toBe("gm_lang");
    cookieJar.value = undefined;
    expect(await getLang()).toBe("ckb");
    cookieJar.value = "ar";
    expect(await getLang()).toBe("ar");
    cookieJar.value = "ckb";
    expect(await getLang()).toBe("ckb");
    cookieJar.value = "fr";
    expect(await getLang()).toBe("ckb");
  });

  it("returns the matching dictionary", () => {
    expect(dict("ar")).toBe(ar);
    expect(dict("ckb")).toBe(ckb);
    expect(isLang("ar") && isLang("ckb") && !isLang("en")).toBe(true);
  });
});
