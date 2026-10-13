import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { SHOP_PRICES } from "@/lib/billing/prices";
import { HREFLANG, isSiteLang, SITE_LANGS, SITE_TO_LANG, LANG_TO_SITE, siteUrl } from "@/lib/site/langs";
import { planRows } from "@/lib/site/pricing";
import { alternatesFor, breadcrumbs, faqPage, graph, howTo, pageMetadata } from "@/lib/site/seo";
import type { Guide } from "@/lib/site/types";

afterEach(() => vi.unstubAllEnvs());

describe("site languages", () => {
  it("maps every URL segment to an app language and back", () => {
    for (const s of SITE_LANGS) expect(LANG_TO_SITE[SITE_TO_LANG[s]]).toBe(s);
    expect(isSiteLang("ku")).toBe(true);
    expect(isSiteLang("ckb")).toBe(false);
    expect(isSiteLang("de")).toBe(false);
  });
});

describe("alternates", () => {
  it("lists the page in every language, with English as x-default and a canonical of its own", () => {
    const a = alternatesFor("ku", "/pricing");
    expect(a.canonical).toBe("https://gituas.com/ku/pricing");
    expect(a.languages.en).toBe("https://gituas.com/en/pricing");
    expect(a.languages.ku).toBe("https://gituas.com/ku/pricing");
    expect(a.languages.ar).toBe("https://gituas.com/ar/pricing");
    expect(a.languages["x-default"]).toBe("https://gituas.com/en/pricing");
    expect(Object.keys(a.languages).sort()).toEqual([...SITE_LANGS.map((l) => HREFLANG[l]), "x-default"].sort());
  });

  it("builds page metadata with Open Graph in the page's language", () => {
    const m = pageMetadata({ lang: "ar", path: "", title: "T", description: "D" });
    expect(m.openGraph).toMatchObject({ url: siteUrl("ar"), locale: "ar_IQ", siteName: "Gituas" });
    expect(m.robots).toMatchObject({ index: true, follow: true });
  });
});

describe("structured data", () => {
  it("escapes markup so a text can never close the script tag", () => {
    const s = graph(faqPage([{ q: "</script><b>", a: "x" }]));
    expect(s).not.toContain("</script>");
    expect(JSON.parse(s)["@graph"][0].mainEntity[0].name).toBe("</script><b>");
  });

  it("makes numbered breadcrumbs and a HowTo only when a guide has steps", () => {
    expect(breadcrumbs([{ name: "A", url: "u1" }, { name: "B", url: "u2" }])).toMatchObject({ itemListElement: [{ position: 1 }, { position: 2 }] });
    const g = { title: "T", steps: [{ name: "One", text: "do" }] } as unknown as Guide;
    expect(howTo("en", g)).toMatchObject({ "@type": "HowTo", step: [{ position: 1, name: "One" }] });
    expect(howTo("en", { ...g, steps: [] })).toBeNull();
  });
});

describe("pricing rows", () => {
  it("come from the product's own numbers", () => {
    vi.stubEnv("MAX_PLAN_ENABLED", "0");
    const rows = planRows();
    expect(rows.map((r) => r.plan)).toEqual(["FREE", "MERCHANT", "PRO"]);
    expect(rows.find((r) => r.plan === "MERCHANT")).toMatchObject({ price: SHOP_PRICES.MERCHANT, posts: 25, repliesPerDay: 1000 });
    expect(rows.find((r) => r.plan === "PRO")).toMatchObject({ price: SHOP_PRICES.PRO, posts: null });
    expect(rows.find((r) => r.plan === "FREE")).toMatchObject({ price: 0, videosPerMonth: 0, picturesPerMonth: 0 });
  });

  it("shows Max only while it is on sale", () => {
    vi.stubEnv("MAX_PLAN_ENABLED", "1");
    expect(planRows().map((r) => r.plan)).toContain("MAX");
  });
});
