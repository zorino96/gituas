import { describe, expect, it } from "vitest";
import { parseClassification } from "@/lib/shop/classify";
import { MAX_REPLY, varySample, type Completer } from "@/lib/shop/vary";

describe("parseClassification", () => {
  it("accepts a well-formed answer and clamps confidence", () => {
    expect(parseClassification({ type: "QUESTION", intent: "price", language: "ckb", confidence: 1.4 })).toEqual({ type: "QUESTION", intent: "price", language: "ckb", confidence: 1 });
    expect(parseClassification({ type: "PRAISE", language: "ar", confidence: 0.8 })).toEqual({ type: "PRAISE", intent: "none", language: "ar", confidence: 0.8 });
  });
  it("rejects anything outside the labels", () => {
    expect(parseClassification({ type: "BUY", intent: "price", language: "ckb", confidence: 0.9 })).toBeNull();
    expect(parseClassification({ type: "QUESTION", intent: "colour", language: "ckb", confidence: 0.9 })).toBeNull();
    expect(parseClassification({ type: "QUESTION", intent: "price", language: "fa", confidence: 0.9 })).toBeNull();
    expect(parseClassification({ type: "QUESTION", intent: "price", language: "ckb", confidence: "high" })).toBeNull();
    expect(parseClassification("QUESTION")).toBeNull();
  });
});

describe("varySample", () => {
  const says = (data: unknown): Completer => async () => data;
  it("uses the AI's rewrite when it passes the guard", async () => {
    expect(await varySample("نامەمان بۆت نارد 🌷", "ckb", says({ text: "لە نامەدا وەڵامت دەدەینەوە 🌷" }))).toEqual({ text: "لە نامەدا وەڵامت دەدەینەوە 🌷", ai: true });
  });
  it("falls back to the merchant's words on numbers, length, junk or failure", async () => {
    const sample = "نامەمان بۆت نارد 🌷";
    expect(await varySample(sample, "ckb", says({ text: "نرخ ٢٥ هەزارە" }))).toEqual({ text: sample, ai: false });
    expect(await varySample(sample, "ckb", says({ text: "x".repeat(MAX_REPLY + 1) }))).toEqual({ text: sample, ai: false });
    expect(await varySample(sample, "ckb", says({ reply: "hi" }))).toEqual({ text: sample, ai: false });
    expect(await varySample(sample, "ckb", async () => { throw new Error("down"); })).toEqual({ text: sample, ai: false });
  });
});
