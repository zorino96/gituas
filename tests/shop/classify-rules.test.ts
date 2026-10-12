import { describe, expect, it } from "vitest";

import { classifyByRules } from "@/lib/shop/classify-rules";

const price = (language: string) => ({ type: "QUESTION", intent: "price", language, confidence: 0.85 });

describe("classifyByRules", () => {
  it("labels a message of emoji only as praise", () => {
    for (const t of ["😍", "😍😍😍", "❤️🔥", "👍 👍", "🙏🏽"]) expect(classifyByRules(t), t).toMatchObject({ type: "PRAISE", intent: "none" });
  });

  it("labels a plain price question in Sorani, Arabic and English", () => {
    expect(classifyByRules("چەندە؟")).toEqual(price("ckb"));
    expect(classifyByRules("بە چەندە")).toEqual(price("ckb"));
    expect(classifyByRules("نرخی چەندە")).toEqual(price("ckb"));
    expect(classifyByRules("بكم؟")).toEqual(price("ar"));
    expect(classifyByRules("شكد السعر")).toEqual(price("ar"));
    expect(classifyByRules("كم السعر؟")).toEqual(price("ar"));
    expect(classifyByRules("price?")).toEqual(price("en"));
    expect(classifyByRules("How much")).toEqual(price("en"));
  });

  it("leaves haggling, complaints and anything longer to the model", () => {
    for (const t of ["نرخەکەی زۆر گرانە", "هەرزانتر نییە؟", "بكم بس غالي", "can you do a cheaper price", "price is too high", "داشکاندن هەیە؟"]) {
      expect(classifyByRules(t), t).toBeNull();
    }
    expect(classifyByRules("سڵاو، ئەم جانتایە چەندە و کەی دەگات بۆ سلێمانی و ئایا ڕەنگی تریشی هەیە؟")).toBeNull();
  });

  it("leaves an unrelated or empty message alone", () => {
    for (const t of ["", "   ", "زۆر جوانە", "بەخێربێن", "hello", "اريد واحد"]) expect(classifyByRules(t), t).toBeNull();
  });

  it("leaves a question that says more than the price, or a reaction that may be sour, to the model", () => {
    for (const t of ["چەندە جوانە", "نرخ و گەیاندن چەندە", "قیاس و نرخ", "بكم التوصيل", "price and delivery", "delivery price"]) expect(classifyByRules(t), t).toBeNull();
    for (const t of ["😂", "🙄", "😡", "💩", "😍?", "💰", "🇮🇶", "❓", "👎"]) expect(classifyByRules(t), t).toBeNull();
  });

  it("ignores courtesy words around a bare price question", () => {
    expect(classifyByRules("سڵاو بە چەندە تکایە")).toMatchObject({ intent: "price", language: "ckb" });
    expect(classifyByRules("please price")).toMatchObject({ intent: "price", language: "en" });
  });

  it("gives labels the model's pipeline accepts", () => {
    const c = classifyByRules("چەندە")!;
    expect(c.confidence).toBeGreaterThanOrEqual(0.6);
  });
});
