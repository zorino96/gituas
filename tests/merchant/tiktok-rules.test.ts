import { describe, it, expect } from "vitest";
import { tiktokProblems, type TikTokChoice } from "@/lib/merchant/tiktok-rules";

const info = { privacyOptions: ["PUBLIC_TO_EVERYONE", "FOLLOWER_OF_CREATOR", "SELF_ONLY"], maxDurationSec: 600 };
const ok: TikTokChoice = { privacy: "PUBLIC_TO_EVERYONE", commercial: false, yourBrand: false, branded: false, durationSec: 30 };

describe("tiktokProblems", () => {
  it("accepts a complete choice", () => expect(tiktokProblems(ok, info)).toEqual([]));
  it("requires a privacy choice — there is no default", () =>
    expect(tiktokProblems({ ...ok, privacy: null }, info)).toContain("privacy"));
  it("rejects a privacy value TikTok did not offer", () =>
    expect(tiktokProblems({ ...ok, privacy: "MUTUAL_FOLLOW_FRIENDS" }, info)).toContain("privacy"));
  it("requires a type once commercial content is on", () =>
    expect(tiktokProblems({ ...ok, commercial: true }, info)).toContain("commercial"));
  it("forbids branded content set to Only me", () =>
    expect(tiktokProblems({ ...ok, commercial: true, branded: true, privacy: "SELF_ONLY" }, info)).toContain("branded-private"));
  it("rejects a video longer than the creator's limit", () =>
    expect(tiktokProblems({ ...ok, durationSec: 601 }, info)).toContain("duration"));
});
