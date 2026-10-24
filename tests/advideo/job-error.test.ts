import { describe, expect, it } from "vitest";

import {
  NO_SUBJECT_NOTE,
  ownerJobError,
  PLAIN_VIDEO_NOTE,
  REQUEST_UNREADABLE_NOTE,
  SOURCE_UNAVAILABLE_NOTE,
  STORY_DEFERRED_NOTE,
  StoryDeferred,
  StoryRetryable,
  StorySubjectMissing,
  UNKNOWN_SUBJECT_NOTE,
} from "@/lib/advideo/job-error";

const texts = { plainVideo: "PLAIN", jobFailed: "FAILED" };
const withSubjects = { ...texts, noSubject: "NO SUBJECT", unknownSubject: "UNKNOWN SUBJECT" };

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

  it("tells a story without a subject, and one the writer does not know, apart from any other failure", () => {
    expect(ownerJobError("FAILED", NO_SUBJECT_NOTE, withSubjects)).toBe("NO SUBJECT");
    expect(ownerJobError("FAILED", UNKNOWN_SUBJECT_NOTE, withSubjects)).toBe("UNKNOWN SUBJECT");
    expect(ownerJobError("FAILED", "the story could not be written", withSubjects)).toBe("FAILED");
  });

  it("falls back to the general failure text when the screen has no words for the subject", () => {
    expect(ownerJobError("FAILED", NO_SUBJECT_NOTE, texts)).toBe("FAILED");
    expect(ownerJobError("FAILED", UNKNOWN_SUBJECT_NOTE, texts)).toBe("FAILED");
  });

  it("says nothing about a subject note while the job is not failed", () => {
    for (const status of ["QUEUED", "PREPARING", "READY", "RENDERED"]) {
      expect(ownerJobError(status, NO_SUBJECT_NOTE, withSubjects)).toBeNull();
      expect(ownerJobError(status, UNKNOWN_SUBJECT_NOTE, withSubjects)).toBeNull();
    }
  });
});

describe("StorySubjectMissing", () => {
  it("is an Error that carries the stable note of its reason", () => {
    const none = new StorySubjectMissing("none");
    const unknown = new StorySubjectMissing("unknown");
    expect(none).toBeInstanceOf(Error);
    expect(none).toBeInstanceOf(StorySubjectMissing);
    expect(none.reason).toBe("none");
    expect(none.message).toBe(NO_SUBJECT_NOTE);
    expect(unknown.reason).toBe("unknown");
    expect(unknown.message).toBe(UNKNOWN_SUBJECT_NOTE);
    expect(NO_SUBJECT_NOTE).not.toBe(UNKNOWN_SUBJECT_NOTE);
  });

  it("keeps the notes that rows already stored carry, so an old failed job still reads", () => {
    expect(NO_SUBJECT_NOTE).toBe("story needs a specific subject");
    expect(UNKNOWN_SUBJECT_NOTE).toBe("story subject is not known well enough");
  });

  it("is what the subject stage throws for a named case with no article: a final failure with the case's own text, never the generic one", () => {
    const err = new StorySubjectMissing("unknown");
    expect(ownerJobError("FAILED", err.message, withSubjects)).toBe("UNKNOWN SUBJECT");
    // (A try that will be repeated says nothing; this one is never repeated, the job is failed at once.)
    expect(ownerJobError("QUEUED", err.message, withSubjects)).toBeNull();
  });
});

describe("StoryRetryable", () => {
  it("is an ordinary Error, never a StorySubjectMissing: the job is tried again, not failed at once", () => {
    const request = new StoryRetryable("request");
    const source = new StoryRetryable("source");
    for (const e of [request, source]) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(StoryRetryable);
      expect(e).not.toBeInstanceOf(StorySubjectMissing);
      expect(e.name).toBe("StoryRetryable");
    }
    expect(request.reason).toBe("request");
    expect(request.message).toBe(REQUEST_UNREADABLE_NOTE);
    expect(source.reason).toBe("source");
    expect(source.message).toBe(SOURCE_UNAVAILABLE_NOTE);
    expect(REQUEST_UNREADABLE_NOTE).not.toBe(SOURCE_UNAVAILABLE_NOTE);
  });

  it("is never read as 'write its name differently': the owner of such a job reads the general failure text, and only when it failed for good", () => {
    for (const e of [new StoryRetryable("request"), new StoryRetryable("source")]) {
      expect(ownerJobError("FAILED", e.message, withSubjects)).toBe("FAILED");
      expect(ownerJobError("QUEUED", e.message, withSubjects)).toBeNull();
      expect(e.message).not.toBe(UNKNOWN_SUBJECT_NOTE);
      expect(e.message).not.toBe(NO_SUBJECT_NOTE);
    }
  });
});

describe("StoryDeferred: an attempt put off for want of time", () => {
  it("is a StoryRetryable of its own, with its own note, so a caller that does not know it treats it as an ordinary failed try", () => {
    const e = new StoryDeferred();
    expect(e).toBeInstanceOf(StoryRetryable);
    expect(e).not.toBeInstanceOf(StorySubjectMissing);
    expect(e.name).toBe("StoryDeferred");
    expect(e.message).toBe(STORY_DEFERRED_NOTE);
    expect(e.message).not.toBe(REQUEST_UNREADABLE_NOTE);
  });

  it("is never read as 'write its name differently', and says nothing to the owner until the job failed for good", () => {
    const e = new StoryDeferred();
    expect(ownerJobError("QUEUED", e.message, withSubjects)).toBeNull();
    expect(ownerJobError("FAILED", e.message, withSubjects)).toBe("FAILED");
  });
});
