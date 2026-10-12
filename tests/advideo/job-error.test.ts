import { describe, expect, it } from "vitest";

import { ownerJobError, PLAIN_VIDEO_NOTE } from "@/lib/advideo/job-error";

const texts = { plainVideo: "PLAIN", jobFailed: "FAILED" };

describe("ownerJobError", () => {
  it("never passes a provider's words on to the screen", () => {
    const stored = "No voice available: pawan 402: {\"error\":\"insufficient credits\"}; gemini 400: key rejected";
    expect(ownerJobError("FAILED", stored, texts)).toBe("FAILED");
    expect(ownerJobError("FAILED", stored, texts)).not.toContain("pawan");
    // A try that will be repeated says nothing yet.
    expect(ownerJobError("QUEUED", stored, texts)).toBeNull();
    expect(ownerJobError("READY", stored, texts)).toBeNull();
  });

  it("tells a plain storyboard apart, and says nothing when there is no error", () => {
    expect(ownerJobError("RENDERED", PLAIN_VIDEO_NOTE, texts)).toBe("PLAIN");
    expect(ownerJobError("FAILED", null, texts)).toBeNull();
  });
});
