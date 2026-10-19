import { describe, expect, it } from "vitest";

import { SHOP_PRICES } from "@/lib/billing/prices";
import { buildKnowledge, planFacts } from "@/lib/assistant/knowledge";
import { IMAGES_PER_DAY, SHOP_LIMITS, STORE_PLANS, VIDEOS_PER_DAY } from "@/lib/shop/plans";
import { SHOP_ACCOUNT_CAP } from "@/lib/oauth/account-limit";
import { SUPPORT_WHATSAPP, SUPPORT_WHATSAPP_DISPLAY, supportWhatsAppUrl } from "@/lib/support";

const ALL = { max: true, video: true, pictures: true };

describe("the knowledge sheet", () => {
  it("states each plan's price and numbers from the tables the product runs on", () => {
    const facts = planFacts(ALL);
    for (const plan of STORE_PLANS) {
      const price = SHOP_PRICES[plan];
      if (price) expect(facts).toContain(price.toLocaleString("en-US"));
      const l = SHOP_LIMITS[plan];
      if (l.videosPerMonth > 0) expect(facts).toContain(`up to ${l.videosPerMonth} AI video ads`);
      if (l.imagesPerMonth > 0) expect(facts).toContain(`${l.imagesPerMonth} AI pictures a month (at most ${IMAGES_PER_DAY} a day)`);
    }
    // The free plan says it has no videos, the Opus plan says it has the strongest model.
    expect(facts).toMatch(/Free:[^\n]*no AI video ads/);
    expect(facts).toMatch(/Max:[^\n]*Claude Opus/);
  });

  it("leaves out what is not switched on: Max, AI video, AI pictures", () => {
    const off = buildKnowledge({ max: false, video: false, pictures: false });
    expect(off).not.toContain("- Max:");
    expect(off).not.toContain("AI video ads a month");
    expect(off).not.toContain("- AI video:");
    expect(off).not.toContain("AI pictures a month");
    expect(off).not.toContain("Gituas review");
    expect(off).not.toMatch(/Max \d+/);
    const on = buildKnowledge(ALL);
    expect(on).toContain("- Max:");
    expect(on).toContain("- AI video:");
    expect(on).toContain(`At most ${VIDEOS_PER_DAY} video a day for each paid shop`);
  });

  it("carries the support number, the account caps and the allowance rule from the code", () => {
    const k = buildKnowledge(ALL);
    expect(k).toContain(SUPPORT_WHATSAPP_DISPLAY);
    expect(k).toContain(`Merchant ${SHOP_ACCOUNT_CAP.MERCHANT}`);
    expect(k).toContain("At 70 percent the optional ones stop");
  });

  it("does not claim what the product does not do", () => {
    const k = buildKnowledge(ALL);
    // Verified against the code by the 2026-10-13 review.
    expect(k).not.toMatch(/the brand \(logo, colours, tagline\)/);
    expect(k).not.toMatch(/posting hours the owner sets/);
    expect(k).toMatch(/automatic replies START OFF/);
    expect(k).toMatch(/TikTok is always posted at once/);
    expect(k).toMatch(/does not run or pay for ads/);
  });

  it("does not mention the models' internal prices or the money allowance", () => {
    const k = buildKnowledge(ALL);
    expect(k).not.toMatch(/\$\d/);
    expect(k).not.toMatch(/USD/);
  });

  it("tells about the setup questions and the weekly note only while they are switched on, and promises nothing", () => {
    delete process.env.BUSINESS_PROFILE_ENABLED;
    const off = buildKnowledge(ALL);
    expect(off).not.toMatch(/setup questions/);
    expect(off).not.toMatch(/Sunday morning/);
    process.env.BUSINESS_PROFILE_ENABLED = "1";
    try {
      const on = buildKnowledge(ALL);
      expect(on).toMatch(/setup questions/);
      expect(on).toMatch(/Sunday morning/);
      expect(on).toMatch(/not market data and predicts nothing/);
      expect(on).toMatch(/only the facts the owner switches on are ever told to buyers/);
      expect(on).not.toMatch(/will (sell|grow|increase)/);
    } finally {
      delete process.env.BUSINESS_PROFILE_ENABLED;
    }
  });
});

describe("support", () => {
  it("is the number the owner gave, as a wa.me link", () => {
    expect(SUPPORT_WHATSAPP).toBe("9647710106009");
    expect(supportWhatsAppUrl()).toBe("https://wa.me/9647710106009");
    expect(supportWhatsAppUrl("سڵاو")).toBe(`https://wa.me/9647710106009?text=${encodeURIComponent("سڵاو")}`);
  });
});
