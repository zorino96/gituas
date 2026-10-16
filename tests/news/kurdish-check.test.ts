import { describe, it, expect } from "vitest";

import { hasKurdishDefects, kurdishDefects } from "@/lib/news/kurdish-check";
import { validateDraft } from "@/lib/news/draft";

describe("kurdishDefects", () => {
  it("finds a Latin letter inside a Kurdish word", () => {
    expect(kurdishDefects("دوای باranی بەهێز")).toEqual(["mixed-script"]);
  });

  it("finds a doubled alef", () => {
    expect(kurdishDefects("٣ مندااڵ لە قوتابخانە")).toEqual(["double-alef"]);
    expect(kurdishDefects("کۆمیسیۆنەری بااڵی مافی مرۆڤ")).toEqual(["double-alef"]);
  });

  it("finds Arabic-only letters Kurdish does not use", () => {
    expect(kurdishDefects("كوردستان")).toContain("arabic-letter");
    expect(kurdishDefects("العراق ي")).toContain("arabic-letter");
  });

  it("lets whole Latin words, numbers and normal Sorani through", () => {
    expect(kurdishDefects("OpenAI ڕایگەیاند کە CNN و WhatsApp ٢٠٢٦ هەواڵی نوێ دەرکرد")).toEqual([]);
    expect(kurdishDefects("ڕێگای ئیرزینجان–ئەرزرۆم بەهۆی ڕووخانی زەوی داخرا، پاشان کرایەوە.")).toEqual([]);
    expect(kurdishDefects("")).toEqual([]);
  });

  it("answers for several texts at once, ignoring empty ones", () => {
    expect(hasKurdishDefects("ڕاستە", null, undefined, "")).toBe(false);
    expect(hasKurdishDefects("ڕاستە", "مندااڵ")).toBe(true);
  });
});

describe("validateDraft with the Kurdish check", () => {
  const ok = { headline: "ڕێگا کرایەوە", body: "ڕێگای ئیرزینجان دوای پاککردنەوە کرایەوە.", category: "گشتی", cardKind: "STANDARD" };

  it("accepts a clean draft", () => {
    expect(validateDraft(ok)?.headline).toBe("ڕێگا کرایەوە");
  });

  it("refuses a draft with a slip, so it is written again", () => {
    expect(validateDraft({ ...ok, body: "دوای باranی بەهێز ڕێگا داخرا." })).toBeNull();
    expect(validateDraft({ ...ok, headline: "٣ مندااڵ کوژران" })).toBeNull();
  });
});
