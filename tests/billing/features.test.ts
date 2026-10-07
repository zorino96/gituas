import { describe, expect, it } from "vitest";
import { ar } from "@/lib/i18n/ar";
import { ckb } from "@/lib/i18n/ckb";
import { planFeatures } from "@/lib/billing/features";
import { NEWS_LIMITS } from "@/lib/billing/plans";
import { SHOP_LIMITS } from "@/lib/shop/plans";

describe("planFeatures NEWS", () => {
  it("lists the features in order, from the plan's limits", () => {
    const f = planFeatures("NEWS", "AUTO");
    expect(f.map((x) => x.key)).toEqual(["refresh", "drafts", "improves", "publishes", "sources", "seats", "desks", "mode", "prompt", "videos"]);
    expect(f.map((x) => x.value)).toEqual([60, 3000, 300, 3000, 30, 5, 3, "autoPublish", "promptFocus", 300]);
  });
  it("lists news by prompt only on the two top plans", () => {
    const prompt = (p: string) => planFeatures("NEWS", p).find((x) => x.key === "prompt")?.value;
    expect(prompt("LITE")).toBeUndefined();
    expect(prompt("MANUAL")).toBeUndefined();
    expect(prompt("AUTO")).toBe("promptFocus");
    expect(prompt("ENTERPRISE")).toBe("promptFull");
  });
  it("follows NEWS_LIMITS for every plan", () => {
    for (const plan of ["LITE", "MANUAL", "AUTO", "ENTERPRISE"] as const) {
      const v = Object.fromEntries(planFeatures("NEWS", plan).map((x) => [x.key, x.value]));
      const l = NEWS_LIMITS[plan];
      expect(v).toEqual({
        refresh: l.refreshSec,
        drafts: l.draft,
        improves: l.improve,
        publishes: l.publish,
        sources: l.sources,
        seats: l.seats,
        desks: l.desks,
        mode: l.autoPublish ? "autoPublish" : "autoDraft",
        ...(l.promptFilter === "none" ? {} : { prompt: l.promptFilter === "full" ? "promptFull" : "promptFocus" }),
        ...(l.video > 0 ? { videos: l.video } : {}),
      });
    }
  });
  it("only the two top plans auto-publish; the others auto-draft", () => {
    const mode = (p: string) => planFeatures("NEWS", p).find((x) => x.key === "mode")?.value;
    expect(mode("LITE")).toBe("autoDraft");
    expect(mode("MANUAL")).toBe("autoDraft");
    expect(mode("AUTO")).toBe("autoPublish");
    expect(mode("ENTERPRISE")).toBe("autoPublish");
  });
  it("is faster on a higher plan", () => {
    const sec = (p: string) => planFeatures("NEWS", p).find((x) => x.key === "refresh")?.value as number;
    expect(sec("ENTERPRISE")).toBe(30);
    expect(sec("LITE")).toBe(300);
  });
});

describe("planFeatures SHOP", () => {
  it("lists posts, replies per day and AI rewrites", () => {
    const m = planFeatures("SHOP", "MERCHANT");
    expect(m.map((x) => x.key)).toEqual(["shopPosts", "shopReplies", "shopAi"]);
    expect(m.map((x) => x.value)).toEqual([25, SHOP_LIMITS.MERCHANT.repliesPerDay, SHOP_LIMITS.MERCHANT.aiVaryPerMonth]);
  });
  it("says all posts when the plan has no post cap", () => {
    const p = planFeatures("SHOP", "PRO");
    expect(p[0]).toEqual({ key: "shopPosts", value: "all" });
    expect(p[1].value).toBe(SHOP_LIMITS.PRO.repliesPerDay);
  });
});

describe("planFeatures with an unknown plan", () => {
  it("returns nothing rather than throwing", () => {
    expect(planFeatures("NEWS", "PRO")).toEqual([]);
    expect(planFeatures("SHOP", "AUTO")).toEqual([]);
    expect(planFeatures("NEWS", "toString")).toEqual([]);
    expect(planFeatures("SHOP", "")).toEqual([]);
  });
});

describe("refresh labels", () => {
  it("reads naturally in Sorani", () => {
    expect([30, 60, 120, 300].map(ckb.billing.features.refresh)).toEqual(["هەر ٣٠ چرکە", "هەر خولەکێک", "هەر ٢ خولەک", "هەر ٥ خولەک"]);
  });
  it("reads naturally in Arabic", () => {
    expect([30, 60, 120, 300].map(ar.billing.features.refresh)).toEqual(["كل ٣٠ ثانية", "كل دقيقة", "كل دقيقتين", "كل ٥ دقائق"]);
  });
});
