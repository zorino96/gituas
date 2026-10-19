import { describe, expect, it } from "vitest";

import { AUTONOMY_LEVELS, QUICK_IDS, type ChatErrorCode, type Risk, type RunStatus } from "@/lib/chat/types";
import { ar } from "@/lib/i18n/ar";
import { ckb } from "@/lib/i18n/ckb";
import { en } from "@/lib/i18n/en";

const ERROR_CODES: ChatErrorCode[] = [
  "signin", "forbidden", "workspace", "badrequest", "limit_day", "limit_month", "allowance", "busy", "unavailable", "not_found", "expired", "internal",
];
// Every risk a card can show a label for (a card of "read" or "low" risk shows none).
const LABELLED_RISKS: Exclude<Risk, "read" | "low">[] = ["money", "public", "outbound", "standing", "destructive"];
const RUN_STATUSES: RunStatus[] = ["PROPOSED", "RUNNING", "DONE", "FAILED", "CANCELLED", "EXPIRED"];
const DICTS = { ckb: ckb.chat, ar: ar.chat, en: en.chat } as const;

describe("the chat's words, in every language", () => {
  for (const [name, c] of Object.entries(DICTS)) {
    describe(name, () => {
      it("words every ChatErrorCode, and a broken connection", () => {
        for (const code of [...ERROR_CODES, "network"] as const) expect(c.errors[code as keyof typeof c.errors]?.trim(), code).toBeTruthy();
      });

      it("has a label and a lead sentence for every quick button, under exactly these keys", () => {
        expect(Object.keys(c.quick).sort()).toEqual([...QUICK_IDS].sort());
        for (const id of QUICK_IDS) {
          expect(c.quick[id].label.trim(), `${id}.label`).toBeTruthy();
          expect(c.quick[id].lead.trim(), `${id}.lead`).toBeTruthy();
        }
      });

      it("names every state of a card", () => {
        for (const status of RUN_STATUSES) expect(c.runs.status[status].trim(), status).toBeTruthy();
      });

      it("labels every risk that needs one, a removal included", () => {
        for (const risk of LABELLED_RISKS) expect(c.runs.risk[risk].trim(), risk).toBeTruthy();
      });

      it("explains every level of autonomy", () => {
        for (const level of AUTONOMY_LEVELS) {
          expect(c.settings.levels[level].label.trim()).toBeTruthy();
          expect(c.settings.levels[level].help.trim().length).toBeGreaterThan(30);
        }
      });

      it("gives four to six example sentences for the empty state, and a name to every group of the history", () => {
        expect(c.empty.examples.length).toBeGreaterThanOrEqual(4);
        expect(c.empty.examples.length).toBeLessThanOrEqual(6);
        for (const key of ["pinned", "today", "yesterday", "week", "month", "older"] as const) expect(c.sidebar.groups[key].trim(), key).toBeTruthy();
      });

      it("keeps the numbers in the words it builds", () => {
        expect(c.composer.left(5, 120)).toMatch(/5|٥/);
        expect(c.composer.left(5, 120)).toMatch(/120|١٢٠/);
        expect(c.runs.expiresIn(12)).toMatch(/12|١٢/);
        expect(c.views.more(4)).toMatch(/4|٤/);
        expect(c.settings.deleted(3)).toMatch(/3|٣/);
      });

      it("says how long the chat keeps what it looked up, what it shows, and a chat nobody uses", () => {
        const r = c.settings.retention;
        expect(r, "a day").toMatch(/\b1\b|١|يوم واحد|ڕۆژێک/);
        expect(r, "30 days").toMatch(/30|٣٠/);
        expect(r, "180 days").toMatch(/180|١٨٠/);
      });

      it("describes the autonomy levels the way the rules work: removals and messages always get a card", () => {
        // guard.ts decide(): LOW runs only low-risk changes; ALL also runs money and public changes; outbound, standing,
        // destructive, pictures and anything after customers' words always wait for Confirm.
        const words = (level: "LOW" | "ALL") => c.settings.levels[level].help;
        const removal = /remov|حذف|دەسڕێتەوە|سڕینەوە/;
        const messages = /message|رسال|رسائل|نامە/i;
        expect(words("LOW")).toMatch(removal);
        expect(words("LOW")).toMatch(messages);
        expect(words("ALL")).toMatch(removal);
        expect(words("ALL")).toMatch(messages);
      });
    });
  }

  it("keeps the Arabic count and noun in agreement (one, two, 3 to 10, 11 and up)", () => {
    const c = ar.chat;
    expect(c.runs.expiresIn(2)).toBe("متبقٍ دقيقتان");
    expect(c.runs.expiresIn(5)).toBe("متبقٍ ٥ دقائق");
    expect(c.runs.expiresIn(10)).toBe("متبقٍ ١٠ دقائق");
    expect(c.runs.expiresIn(11)).toBe("متبقٍ ١١ دقيقة");
    expect(c.runs.expiresIn(30)).toBe("متبقٍ ٣٠ دقيقة");
    expect(c.settings.deleted(1)).toBe("تم حذف محادثة واحدة.");
    expect(c.settings.deleted(2)).toBe("تم حذف محادثتين.");
    expect(c.settings.deleted(3)).toBe("تم حذف ٣ محادثات.");
    expect(c.settings.deleted(10)).toBe("تم حذف ١٠ محادثات.");
    expect(c.settings.deleted(12)).toBe("تم حذف ١٢ محادثة.");
  });

  it("writes the English chat in Latin script and the Arabic without Kurdish-only letters", () => {
    const text = (o: unknown): string => (typeof o === "string" ? o : typeof o === "function" ? "" : o && typeof o === "object" ? Object.values(o).map(text).join(" ") : "");
    expect(/[\u0600-\u06ff]/.test(text(en.chat))).toBe(false);
    expect(/[\u06d5\u0695\u06b5\u06c6\u06ce\u06a4\u06a9\u06cc]/.test(text(ar.chat))).toBe(false);
  });

  it("keeps the sentences of Sorani and Arabic in their own script", () => {
    // The product name and the platform names may stay Latin; whole sentences may not.
    for (const c of [ckb.chat, ar.chat]) {
      for (const code of ERROR_CODES) expect(/[\u0600-\u06ff]/.test(c.errors[code]), code).toBe(true);
      for (const id of QUICK_IDS) expect(/[\u0600-\u06ff]/.test(c.quick[id].lead), id).toBe(true);
    }
  });
});
