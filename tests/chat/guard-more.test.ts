import { describe, expect, it } from "vitest";

import { cleanAnswer, cleanOutbound, ownerCorpus, stripInvisible } from "@/lib/chat/guard";

const none = ownerCorpus([]);
const SOFT_HYPHEN = String.fromCharCode(0xad);
const ZERO_WIDTH = String.fromCharCode(0x200b);

describe("cleanOutbound: forms a customer could smuggle", () => {
  it("removes a phone number in Arabic-Indic, Persian or full-width digits that the person never typed", () => {
    expect(cleanOutbound("پەیوەندی: ٠٧٥٠١٢٣٤٥٦٧", none)).toBe("پەیوەندی:");
    expect(cleanOutbound("call ۰۷۵۰۱۲۳۴۵۶۷ now", none)).toBe("call now");
    expect(cleanOutbound("call ０７５０１２３４５６７ now", none)).toBe("call now");
  });

  it("removes a number split by slashes, commas, underscores, brackets or hidden characters", () => {
    for (const t of ["0750/123/4567", "0750,123,4567", "0750_123_4567", "(0750) 123-4567", `07${SOFT_HYPHEN}50 123 4567`, `0750${ZERO_WIDTH} 123 4567`, "+964 750 123 4567", "00964 750 123 4567"]) {
      const out = cleanOutbound(`call ${t} today`, none);
      expect(out, t).toBe("call today");
    }
  });

  it("keeps a number the person typed, in whatever digits it is written now", () => {
    expect(cleanOutbound("call 0750 123 4567", ownerCorpus(["my number is 07501234567"]))).toBe("call 0750 123 4567");
    expect(cleanOutbound("call ٠٧٥٠١٢٣٤٥٦٧", ownerCorpus(["07501234567"]))).toBe("call ٠٧٥٠١٢٣٤٥٦٧");
  });

  it("keeps prices, years, sizes and dates", () => {
    const t = "Price 1,250,000 IQD or ٢٥٠٠٠ دینار, since 2024, size 42, on 2026-10-20 19:00 and 20/10/2026";
    expect(cleanOutbound(t, none)).toBe(t);
  });

  it("removes e-mail addresses, odd domains, shorteners and disguised dots", () => {
    expect(cleanOutbound("write bad@evil.com please", none)).toBe("write please");
    expect(cleanOutbound("see evil.top or goo.gl/abc or evil[.]com or evil (dot) org", none)).toBe("see or or or");
    expect(cleanOutbound("visit wa.me/9647501234567", none)).toBe("visit");
  });

  it("removes a domain glued to a Sorani word", () => {
    expect(cleanOutbound("بڕۆ بۆevil.com ئێستا", none)).not.toContain("evil");
  });

  it("removes a link hidden behind a backtick and keeps our own", () => {
    const out = cleanOutbound("go https://gituas.com/x`https://evil.example/y done", none);
    expect(out).not.toContain("evil");
    expect(cleanOutbound("more https://gituas.com/pricing.", none)).toContain("https://gituas.com/pricing");
  });

  it("does not turn ordinary sentences into domains", () => {
    const t = "End of the story.Next one starts here, e.g. this one, i.e. that.";
    expect(cleanOutbound(t, none)).toBe(t);
  });

  it("leaves the digits and letters of the rest of the text exactly as they were", () => {
    const t = "هەموو ٣ پارچە بە ٢٥٠٠٠ دینار، ڕۆژانی ۱۰ تا ۱۵";
    expect(cleanOutbound(t, none)).toBe(t);
  });
});

describe("stripInvisible and cleanAnswer", () => {
  it("removes soft hyphens and zero-width characters", () => {
    expect(stripInvisible(`a${SOFT_HYPHEN}b${ZERO_WIDTH}c`)).toBe("abc");
  });

  it("drops the server's own tool notes from an answer and keeps the words", () => {
    expect(cleanAnswer("Done.\n[tools: post_now → done: Posted.]\nBye")).toBe("Done.\n\nBye");
  });

  it("does not let a backtick carry a second link past the allowed prefix", () => {
    expect(cleanAnswer("see https://gituas.com/x`https://evil.example/y")).not.toContain("evil");
  });
});
