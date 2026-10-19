import { describe, expect, it } from "vitest";

import { cleanOutbound, ownerCorpus, stripInvisible } from "@/lib/chat/guard";

const none = ownerCorpus([]);
const ZWNJ = String.fromCharCode(0x200c);
const ZWJ = String.fromCharCode(0x200d);
const ZWSP = String.fromCharCode(0x200b);

describe("opening hours and Arabic-script typography in outbound text", () => {
  it("keeps opening hours (in any digits, with any dash)", () => {
    for (const t of ["08:00 - 20:00", "09:30-17:00", "٠٨:٠٠ – ٢٠:٠٠", "۰۸:۰۰ — ۲۰:۰۰", "9:00"]) {
      expect(cleanOutbound(`کاتی کار ${t} هەموو ڕۆژێک`, none), t).toContain(t);
    }
  });

  it("keeps ZWNJ and ZWJ (they are part of how Arabic script is written) and still removes a zero-width space", () => {
    const text = `کتێب${ZWNJ}ەکان و ${ZWJ}تاقیکردنەوە`;
    expect(stripInvisible(text)).toBe(text);
    expect(cleanOutbound(text, none)).toBe(text);
    expect(stripInvisible(`a${ZWSP}b`)).toBe("ab");
  });

  it("still removes a phone number split by ZWNJ, ZWJ or a zero-width space", () => {
    for (const sep of [ZWNJ, ZWJ, ZWSP]) {
      const out = cleanOutbound(`call 0750${sep}123${sep}4567 now`, none);
      expect(out, JSON.stringify(sep)).toBe("call now");
    }
  });
});
