import { describe, expect, it } from "vitest";

import { ago, friendlyError, kuDate, kuDateTime } from "@/app/app/format";
import { ar } from "@/lib/i18n/ar";
import { ckb } from "@/lib/i18n/ckb";

describe("format helpers follow the dictionary", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  const before = (seconds: number) => new Date(now - seconds * 1000).toISOString();

  it("ago defaults to Sorani and switches to Arabic", () => {
    expect(ago(before(10), undefined, now)).toBe("ئێستا");
    expect(ago(before(5 * 60), ckb, now)).toBe("٥ خولەک");
    expect(ago(before(5 * 60), ar, now)).toBe("منذ ٥ دقائق");
    expect(ago(before(60 * 60), ar, now)).toBe("منذ ساعة");
    expect(ago(before(3 * 24 * 3600), ar, now)).toBe("منذ ٣ أيام");
    expect(ago(before(3 * 24 * 3600), ckb, now)).toBe("٣ ڕۆژ");
    expect(ago(undefined, ar, now)).toBe("");
  });

  it("ago falls back to a calendar day after a month", () => {
    expect(ago(before(40 * 24 * 3600), ar, now)).toMatch(/أيلول|آب|تشرين/);
  });

  it("kuDate and kuDateTime print the date in each language, in Baghdad time", () => {
    const iso = "2026-09-30T12:30:00Z";
    expect(kuDate(iso)).toBe("٣٠ی ئەیلوول ٢٠٢٦");
    expect(kuDate(iso, ar)).toBe("٣٠ أيلول ٢٠٢٦");
    expect(kuDateTime(iso, ar)).toBe("٣٠ أيلول ٢٠٢٦، ١٥:٣٠");
    expect(kuDate(null, ar)).toBe("");
  });

  it("friendlyError maps a raw error to the chosen language and passes unknown text through", () => {
    expect(friendlyError("Session has expired")).toBe(ckb.errors.expired);
    expect(friendlyError("Session has expired", ar)).toBe(ar.errors.expired);
    expect(friendlyError(undefined, ar)).toBe(ar.errors.generic);
    expect(friendlyError("something odd", ar)).toBe("something odd");
  });
});
