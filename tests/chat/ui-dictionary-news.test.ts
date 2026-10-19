import { describe, expect, it } from "vitest";

import { NEWS_QUICK } from "@/lib/chat/text";
import { AUTONOMY_LEVELS, NEWS_QUICK_IDS } from "@/lib/chat/types";
import { ar } from "@/lib/i18n/ar";
import { chatNewsAr } from "@/lib/i18n/chat-news.ar";
import { chatNewsCkb } from "@/lib/i18n/chat-news.ckb";
import { chatNewsEn } from "@/lib/i18n/chat-news.en";
import { newsChat, newsChatText } from "@/lib/i18n/chat-news";
import { ckb } from "@/lib/i18n/ckb";
import { en } from "@/lib/i18n/en";
import type { Lang } from "@/lib/i18n/lang";

const LANGS: Lang[] = ["ckb", "ar", "en"];
const OVERLAYS = { ckb: chatNewsCkb, ar: chatNewsAr, en: chatNewsEn } as const;
const BASE = { ckb: ckb.chat, ar: ar.chat, en: en.chat } as const;

/** Every leaf of a dictionary as "group.key" -> value; arrays contribute "group.key.0", ... */
function leaves(node: unknown, path = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (typeof node === "function" || typeof node === "string") out.set(path, node);
  else if (Array.isArray(node)) node.forEach((v, i) => leaves(v, `${path}.${i}`).forEach((x, k) => out.set(k, x)));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) leaves(v, path ? `${path}.${k}` : k).forEach((x, key) => out.set(key, x));
  return out;
}
const text = (v: unknown): string => (typeof v === "function" ? (v as (...a: number[]) => string)(2, 3) : String(v));

// Letters Sorani has and Arabic does not (the Persian kaf and yeh included), and any Arabic-script letter at all.
const KURDISH_ONLY = /[کیەێۆڕڵڤپچژگ]/;
const ARABIC_SCRIPT = /[؀-ۿ]/;

describe("the news desk's chat words", () => {
  it("carry the same keys in Sorani, Arabic and English, none of them empty", () => {
    const keys = [...leaves(chatNewsCkb).keys()].sort();
    expect([...leaves(chatNewsAr).keys()].sort()).toEqual(keys);
    expect([...leaves(chatNewsEn).keys()].sort()).toEqual(keys);
    for (const lang of LANGS) for (const [key, v] of leaves(OVERLAYS[lang])) expect(text(v).trim(), `${lang}.${key}`).not.toBe("");
  });

  it("keep each language in its own script", () => {
    for (const [key, v] of leaves(chatNewsEn)) expect(ARABIC_SCRIPT.test(text(v)), `en.${key}: ${text(v)}`).toBe(false);
    for (const [key, v] of leaves(chatNewsAr)) expect(KURDISH_ONLY.test(text(v)), `ar.${key} has a Kurdish-only letter: ${text(v)}`).toBe(false);
    // Whole sentences are in the language's script; the product name may stay Latin in the Arabic.
    for (const lang of ["ckb", "ar"] as const) {
      const o = OVERLAYS[lang];
      for (const s of [o.empty.hello, o.empty.sub, ...o.empty.examples, o.errors.forbidden, o.errors.workspace, o.errors.frozen, o.runs.tainted, o.settings.levels.LOW.help, o.settings.levels.ALL.help, o.settings.deleteHelp, o.settings.retention, o.settings.frozenNote]) {
        expect(ARABIC_SCRIPT.test(s), `${lang}: ${s}`).toBe(true);
      }
    }
  });

  it("use Sorani, not Arabic, letters in the Sorani", () => {
    // Arabic-only letters (ك ي ى ة ؤ ئ in an Arabic spelling) show a string that was written as Arabic. ئ is Sorani too, so it is left out.
    for (const [key, v] of leaves(chatNewsCkb)) expect(/[كيىةؤ]/.test(text(v)), `ckb.${key}: ${text(v)}`).toBe(false);
  });

  it("name every shortcut of the desk, with the very words the server uses for its answer", () => {
    for (const lang of LANGS) {
      const quick = newsChatText(lang).quick;
      expect(Object.keys(quick).sort(), lang).toEqual([...NEWS_QUICK_IDS].sort());
      for (const id of NEWS_QUICK_IDS) {
        expect(quick[id].label, `${lang}.${id}.label`).toBe(NEWS_QUICK[id].label[lang]);
        expect(quick[id].lead, `${lang}.${id}.lead`).toBe(NEWS_QUICK[id].lead[lang]);
      }
    }
  });

  it("give four to six example sentences for the empty state", () => {
    for (const lang of LANGS) {
      const n = newsChatText(lang).empty.examples.length;
      expect(n, lang).toBeGreaterThanOrEqual(4);
      expect(n, lang).toBeLessThanOrEqual(6);
    }
  });

  it("describe the autonomy levels the way the rules work: removals and messages always get a card", () => {
    // guard.ts decide(): LOW runs only low-risk changes; ALL also runs money and public ones; outbound, standing, destructive, long
    // (writing a story, a card, publishing now, a frame) and anything after text others wrote always wait for Confirm.
    const removal = /remov|حذف|دەسڕێتەوە|سڕینەوە/;
    const messages = /message|رسال|رسائل|نامە/i;
    for (const lang of LANGS) {
      for (const level of ["LOW", "ALL"] as const) {
        const help = newsChat(lang).settings.levels[level].help;
        expect(help, `${lang}.${level} removal`).toMatch(removal);
        expect(help, `${lang}.${level} messages`).toMatch(messages);
        expect(help.length, `${lang}.${level}`).toBeGreaterThan(80);
      }
    }
  });

  it("say that a chat which read stories, comments or messages puts everything behind a card, at both levels that act alone", () => {
    const read = { ckb: /هەواڵ، کۆمێنت یان نامە/, ar: /أخبارًا أو تعليقات أو رسائل/, en: /stories, comments or messages/ } as const;
    for (const lang of LANGS) for (const level of ["LOW", "ALL"] as const) expect(newsChat(lang).settings.levels[level].help, `${lang}.${level}`).toMatch(read[lang]);
  });

  it("say how long the chat keeps what it looked up, what it shows, and a chat nobody uses", () => {
    for (const lang of LANGS) {
      const r = newsChat(lang).settings.retention;
      expect(r, `${lang}: a day`).toMatch(/\b1\b|١|يوم واحد|ڕۆژێک/);
      expect(r, `${lang}: 30 days`).toMatch(/30|٣٠/);
      expect(r, `${lang}: 180 days`).toMatch(/180|١٨٠/);
    }
  });

  it("tell a desk whose trial or plan ended that the chat can only read, and that the shortcuts still work", () => {
    for (const lang of LANGS) {
      const o = newsChatText(lang);
      expect(o.errors.frozen.length, lang).toBeGreaterThan(60);
      expect(o.settings.frozenNote.length, lang).toBeGreaterThan(60);
    }
    expect(chatNewsEn.errors.frozen).toMatch(/quick buttons still work/i);
    expect(chatNewsEn.settings.frozenNote).toMatch(/only read/i);
  });
});

describe("the chat dictionary a desk reads (the shop's, with the desk's wording over it)", () => {
  it("has every key the shop's has, so no component finds a hole", () => {
    for (const lang of LANGS) {
      const merged = leaves(newsChat(lang));
      for (const key of leaves(BASE[lang]).keys()) expect(merged.has(key), `${lang}.${key}`).toBe(true);
    }
  });

  it("is one object per language, so a component that keeps it in a dependency list is not woken for nothing", () => {
    for (const lang of LANGS) expect(newsChat(lang)).toBe(newsChat(lang));
  });

  it("leaves the shop's own dictionary alone", () => {
    for (const lang of LANGS) {
      newsChat(lang);
      expect(Object.keys(BASE[lang].quick).sort()).toEqual(["coach", "comments", "messages", "orders", "scheduled", "today"]);
      expect(BASE[lang].sidebar.classic).not.toBe(newsChat(lang).sidebar.classic);
    }
  });

  it("holds the desk's six shortcuts, and the desk's own wording in the places that named a shop", () => {
    for (const lang of LANGS) {
      const c = newsChat(lang);
      for (const id of NEWS_QUICK_IDS) expect(c.quick[id as keyof typeof c.quick].label.trim(), `${lang}.${id}`).toBeTruthy();
      expect(c.empty.hello).toBe(newsChatText(lang).empty.hello);
      expect(c.errors.forbidden).toBe(newsChatText(lang).errors.forbidden);
      expect(c.sidebar.classic).toBe(newsChatText(lang).sidebar.classic);
    }
  });

  it("names no shop, buyer, order or product in anything a desk's screen draws", () => {
    // Words that belong to a shop. The shop's shortcuts (orders, coach) stay in the table but nothing draws them for a desk.
    const SHOP: Record<Lang, RegExp> = {
      ckb: /دووکان|کڕیار|داواکاری|بەرهەم|گیتواس/,
      // "طلب" alone is also the verb "ask" (اطلب), so only the plural and the definite noun count.
      ar: /متجر|زبون|زبائن|الطلبات|طلبات|منتج|Gituas/,
      en: /\bshops?\b|buyers?|customers?|orders?\b|products?|Gituas/i,
    };
    const skip = (key: string) => key.startsWith("quick.orders") || key.startsWith("quick.coach");
    for (const lang of LANGS) {
      for (const [key, v] of leaves(newsChat(lang))) {
        if (skip(key)) continue;
        expect(SHOP[lang].test(text(v)), `${lang}.${key} still talks about a shop: ${text(v)}`).toBe(false);
      }
    }
  });

  it("uses the desk's own terms: no AI allowance (a desk has none), the editor-in-chief and not an 'admin'", () => {
    // Hawalnoos is not on the AI allowance: its chat is bounded by the plan's counts. Nothing a desk's screen draws may speak of one.
    const ALLOWANCE: Record<Lang, RegExp> = { ckb: /بڕی AI|AIی ئەم مانگە/, ar: /رصيد الذكاء/, en: /allowance/i };
    const ADMIN: Record<Lang, RegExp> = { ckb: /بەڕێوەبەر/, ar: /مدير/, en: /\badmins?\b/i };
    // The shop's sentence about its allowance lives under settings.allowanceUsed (the desk's settings card does not draw it) and errors.allowance
    // (a desk is never told it: the merged text answers it with the general error).
    const skip = (key: string) => key.startsWith("settings.allowanceUsed") || key.startsWith("quick.orders") || key.startsWith("quick.coach");
    for (const lang of LANGS) {
      for (const [key, v] of leaves(newsChat(lang))) {
        if (skip(key)) continue;
        expect(ALLOWANCE[lang].test(text(v)), `${lang}.${key} speaks of an AI allowance: ${text(v)}`).toBe(false);
        expect(ADMIN[lang].test(text(v)), `${lang}.${key} says admin instead of the editor-in-chief: ${text(v)}`).toBe(false);
      }
      expect(newsChat(lang).errors.allowance, lang).toBe(newsChat(lang).errors.internal);
    }
  });

  it("names the editor-in-chief as the dictionaries of the desk's team do", () => {
    expect(chatNewsEn.errors.forbidden).toContain("editor-in-chief");
    expect(chatNewsEn.settings.ownerOnly).toContain("editor-in-chief");
    expect(chatNewsCkb.errors.forbidden).toContain("سەرنووسەر");
    expect(chatNewsCkb.settings.ownerOnly).toContain("سەرنووسەر");
    expect(chatNewsAr.errors.forbidden).toContain("رئيس التحرير");
    expect(chatNewsAr.settings.ownerOnly).toContain("رئيس التحرير");
  });

  it("says 'desk' the way the rest of the desk does, in the Today lead as everywhere", () => {
    expect(chatNewsCkb.quick.today.lead).toContain("مێزی هەواڵ");
    expect(chatNewsCkb.quick.today.lead).not.toContain("ڕۆژنامەنووس");
    expect(chatNewsAr.quick.today.lead).toContain("مكتب الأخبار");
    expect(chatNewsAr.quick.today.lead).not.toContain("غرفة");
  });

  it("words the card line of a money tool for the plan's monthly count, in each language, and the other four lines stay the shop's", () => {
    expect(chatNewsEn.runs.risk.money).toMatch(/plan/);
    for (const lang of LANGS) {
      const risk = newsChat(lang).runs.risk;
      expect(risk.money, lang).toBe(OVERLAYS[lang].runs.risk.money);
      for (const k of ["public", "outbound", "standing", "destructive"] as const) expect(risk[k], `${lang}.${k}`).toBe(BASE[lang].runs.risk[k]);
    }
  });

  it("tells the truth about what runs by itself: automatic drafting does, and says it publishes nothing; automatic publishing always gets a card", () => {
    // decide() (src/lib/chat/guard.ts) and the desk tools' risks (writes-news-settings.ts): set_news_autopilot with mode DRAFT or OFF is a low
    // change, so at "small things" and at "most things" it runs at once; PUBLISH is a standing change and always waits for the card.
    for (const level of ["LOW", "ALL"] as const) {
      expect(chatNewsEn.settings.levels[level].help, level).toContain("Auto drafts");
      expect(chatNewsEn.settings.levels[level].help, level).toContain("publish nothing");
      expect(chatNewsEn.settings.levels[level].help, level).toContain("Auto publish");
      expect(chatNewsCkb.settings.levels[level].help, level).toContain("ڕەشنووسی خۆکار");
      expect(chatNewsCkb.settings.levels[level].help, level).toContain("بڵاوکردنەوەی خۆکار");
      expect(chatNewsAr.settings.levels[level].help, level).toContain("مسودات تلقائية");
      expect(chatNewsAr.settings.levels[level].help, level).toContain("نشر تلقائي");
    }
  });

  it("explains every level of autonomy", () => {
    for (const lang of LANGS) {
      for (const level of AUTONOMY_LEVELS) {
        const l = newsChat(lang).settings.levels[level];
        expect(l.label.trim()).toBeTruthy();
        expect(l.help.trim().length).toBeGreaterThan(30);
      }
    }
  });
});
