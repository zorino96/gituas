import { describe, expect, it } from "vitest";

import { priceFor, STUDIO_PACKS } from "@/lib/billing/prices";
import { imagePrice, imagePriceInputs, marginOf, priceFromCost } from "@/lib/studio/pricing";
import { isWebhookToken, parseStatus, webhookToken } from "@/lib/studio/higgsfield";
import { cleanHeadline, imageArgs, isStudioAspect, isStudioPreset, MODEL_ASPECT, PRESET_ASPECT, STUDIO_PRESETS, studioPrompt } from "@/lib/studio/presets";
import { priceLine } from "@/lib/studio/price";

describe("studio prompt", () => {
  it("keeps the real product and never lets the model write text, in every scene", () => {
    for (const p of STUDIO_PRESETS) {
      const prompt = studioPrompt(p);
      expect(prompt).toMatch(/Keep the product exactly as it is in the reference photo/);
      expect(prompt).toMatch(/Do not add any text, letters, numbers, prices/);
      expect(prompt).toMatch(/modest clothing/);
      expect(PRESET_ASPECT[p]).toBeTruthy();
    }
    expect(studioPrompt("newroz")).toMatch(/Kurdistan/);
  });

  it("sends the shop's own photo as the reference, at a ratio the model offers", () => {
    expect(imageArgs("p", "https://x.public.blob.vercel-storage.com/merchant/w/a.jpg", "4:5")).toEqual({
      prompt: "p",
      image_urls: ["https://x.public.blob.vercel-storage.com/merchant/w/a.jpg"],
      aspect_ratio: "3:4",
      resolution: "1k",
      quality: "high",
      enhance_prompt: false,
    });
    expect(MODEL_ASPECT["9:16"]).toBe("9:16");
  });

  it("knows its scenes and sizes", () => {
    expect(isStudioPreset("ramadan")).toBe(true);
    expect(isStudioPreset("disco")).toBe(false);
    expect(isStudioAspect("4:5")).toBe(true);
    expect(isStudioAspect("16:9")).toBe(false);
  });

  it("accepts a one-line headline of at most 60 letters", () => {
    expect(cleanHeadline("  کۆکراوەی  نوێی\nزستان ")).toBe("کۆکراوەی نوێی زستان");
    expect(cleanHeadline("")).toBe("");
    expect(cleanHeadline("ک".repeat(61))).toBeNull();
    expect(cleanHeadline("<b>sale</b>")).toBe("b sale /b");
    expect(cleanHeadline(5)).toBeNull();
  });
});

describe("studio pricing", () => {
  it("prices a picture so the owner keeps at least the margin after Wayl's fee and the Higgsfield cost", () => {
    const i = imagePriceInputs({});
    expect(i).toEqual({ costUsd: 0.2, iqdPerUsd: 1750, margin: 0.3, payFee: 0.04 });
    const { priceIqd } = imagePrice({});
    expect(priceIqd).toBe(500);
    expect(marginOf(priceIqd, i)).toBeGreaterThanOrEqual(0.3);
  });

  it("never loses the margin to rounding, whatever the inputs", () => {
    for (const costUsd of [0.011, 0.05, 0.13, 0.2, 0.61, 1.7]) {
      for (const iqdPerUsd of [1300, 1500, 1600, 2000]) {
        for (const margin of [0.1, 0.3, 0.5]) {
          for (const payFee of [0, 0.025, 0.04, 0.1]) {
            const p = priceFromCost({ costUsd, iqdPerUsd, margin, payFee });
            expect(p % 250).toBe(0);
            expect(marginOf(p, { costUsd, iqdPerUsd, margin, payFee })).toBeGreaterThanOrEqual(margin - 1e-9);
          }
        }
      }
    }
  });

  it("can be tuned from the environment, and ignores nonsense values", () => {
    expect(imagePrice({ HIGGSFIELD_IMAGE_COST_USD: "0.05", STUDIO_IQD_PER_USD: "1500", STUDIO_MARGIN: "0.3", STUDIO_PAY_FEE: "0.03" }).priceIqd).toBe(250);
    expect(imagePriceInputs({ HIGGSFIELD_IMAGE_COST_USD: "-1", STUDIO_IQD_PER_USD: "abc", STUDIO_PAY_FEE: "0.9" })).toEqual({ costUsd: 0.2, iqdPerUsd: 1750, margin: 0.3, payFee: 0.04 });
  });

  it("sells Studio top-ups at fixed amounts only", () => {
    expect(priceFor("STUDIO", "STUDIO_10K")).toBe(10000);
    expect(priceFor("STUDIO", "STUDIO_1")).toBeNull();
    expect(Object.values(STUDIO_PACKS).every((n) => Number.isInteger(n) && n >= 5000)).toBe(true);
  });
});

describe("higgsfield status", () => {
  it("reads a finished picture, a video, a failure and moderation", () => {
    expect(parseStatus({ status: "completed", request_id: "r", images: [{ url: "https://cdn.example.com/1.jpg" }] })).toEqual({
      state: "completed",
      imageUrl: "https://cdn.example.com/1.jpg",
      videoUrl: null,
      error: null,
    });
    expect(parseStatus({ status: "completed", video: { url: "https://cdn.example.com/v.mp4" } }).videoUrl).toBe("https://cdn.example.com/v.mp4");
    expect(parseStatus({ status: "failed", error: "bad input" })).toMatchObject({ state: "failed", error: "bad input" });
    expect(parseStatus({ status: "nsfw" }).state).toBe("nsfw");
  });

  it("never trusts an odd answer: unknown states wait, and only https outputs count", () => {
    expect(parseStatus({ status: "weird" }).state).toBe("in_progress");
    expect(parseStatus(null).state).toBe("in_progress");
    expect(parseStatus({ status: "completed", images: [{ url: "http://insecure/1.jpg" }] }).imageUrl).toBeNull();
    expect(parseStatus({ status: "completed", images: [{ url: "javascript:alert(1)" }] }).imageUrl).toBeNull();
  });

  it("accepts only our own webhook token", () => {
    const token = webhookToken("secret-a");
    expect(isWebhookToken(token, "secret-a")).toBe(true);
    expect(isWebhookToken(token, "secret-b")).toBe(false);
    expect(isWebhookToken("x", "secret-a")).toBe(false);
    expect(isWebhookToken(undefined, "secret-a")).toBe(false);
  });
});

describe("ad price", () => {
  it("shows the price, or the lowest in-stock price with لە when variants differ", () => {
    expect(priceLine([{ amountMinor: 25000, currency: "IQD", inStock: true }])).toBe("٢٥٬٠٠٠ د.ع");
    expect(
      priceLine([
        { amountMinor: 30000, currency: "IQD", inStock: true },
        { amountMinor: 20000, currency: "IQD", inStock: false },
        { amountMinor: 25000, currency: "IQD", inStock: true },
      ]),
    ).toBe("لە ٢٥٬٠٠٠ د.ع");
    expect(priceLine([])).toBeNull();
  });
});
