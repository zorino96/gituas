import { describe, expect, it } from "vitest";

import { WAIT_FICTION_NOTE, WAIT_MEMORY_NOTE, WAIT_NOTES, WAIT_RECENT_NOTE, isWaitNote, ownerWaitNote, waitNoteFor, waitNoteOfSpec } from "@/lib/advideo/wait-note";

describe("waitNoteFor: why a finished story waits for its owner", () => {
  it("lets a story told from a read article about a case that is not recent go", () => {
    expect(waitNoteFor({ mode: "real", fictionAsked: false, subject: { } })).toBeNull();
    expect(waitNoteFor({ mode: "real", fictionAsked: false, subject: { fromMemory: false, recent: false } })).toBeNull();
    expect(waitNoteFor({ mode: "real", fictionAsked: false, subject: null })).toBeNull();
    expect(waitNoteFor({ mode: "real", fictionAsked: false })).toBeNull();
  });

  it("holds a story told from memory, and one about a recent case, memory first", () => {
    expect(waitNoteFor({ mode: "real", fictionAsked: false, subject: { fromMemory: true } })).toBe(WAIT_MEMORY_NOTE);
    expect(waitNoteFor({ mode: "real", fictionAsked: false, subject: { recent: true } })).toBe(WAIT_RECENT_NOTE);
    expect(waitNoteFor({ mode: "real", fictionAsked: false, subject: { fromMemory: true, recent: true } })).toBe(WAIT_MEMORY_NOTE);
  });

  it("holds an invented story unless the owner's own words asked for fiction", () => {
    expect(waitNoteFor({ mode: "fiction", fictionAsked: true })).toBeNull();
    expect(waitNoteFor({ mode: "fiction", fictionAsked: false })).toBe(WAIT_FICTION_NOTE);
  });

  it("never holds an ad", () => {
    expect(waitNoteFor({ mode: "classic", fictionAsked: false, subject: { fromMemory: true, recent: true } })).toBeNull();
  });
});

describe("the notes", () => {
  it("are recognised as such, and are plain English for the logs", () => {
    expect(WAIT_NOTES).toEqual([WAIT_MEMORY_NOTE, WAIT_RECENT_NOTE, WAIT_FICTION_NOTE]);
    for (const n of WAIT_NOTES) expect(isWaitNote(n)).toBe(true);
    for (const n of ["", null, undefined, "a plain video: the AI could not write this one", "no connected page"]) expect(isWaitNote(n as never), String(n)).toBe(false);
  });

  it("are turned into the owner's own sentence by ownerWaitNote, and nothing else is", () => {
    const texts = { memory: "M", recent: "R", fiction: "F" };
    expect(ownerWaitNote(WAIT_MEMORY_NOTE, texts)).toBe("M");
    expect(ownerWaitNote(WAIT_RECENT_NOTE, texts)).toBe("R");
    expect(ownerWaitNote(WAIT_FICTION_NOTE, texts)).toBe("F");
    expect(ownerWaitNote("something a provider said", texts)).toBeNull();
    expect(ownerWaitNote(null, texts)).toBeNull();
  });
});

describe("waitNoteOfSpec: the same answer from a finished video's spec (the stored error is cleared when the render finishes)", () => {
  const story = (over: Record<string, unknown> = {}) => ({ kind: "story", subject: { name: "Hinterkaifeck murders", kind: "real" }, ...over });

  it("reads the note from the subject", () => {
    expect(waitNoteOfSpec(story())).toBeNull();
    expect(waitNoteOfSpec(story({ subject: { name: "X", kind: "real", fromMemory: true } }))).toBe(WAIT_MEMORY_NOTE);
    expect(waitNoteOfSpec(story({ subject: { name: "X", kind: "real", recent: true } }))).toBe(WAIT_RECENT_NOTE);
  });

  it("lets an invented story go only when the spec says the owner asked for fiction", () => {
    expect(waitNoteOfSpec(story({ subject: { name: "The lighthouse", kind: "fiction" }, fiction: true }))).toBeNull();
    expect(waitNoteOfSpec(story({ subject: { name: "The lighthouse", kind: "fiction" } }))).toBe(WAIT_FICTION_NOTE);
  });

  it("says nothing for an ad, a spec of another shape, or nothing at all", () => {
    for (const spec of [{ kind: "ad", subject: { fromMemory: true } }, { subject: { fromMemory: true } }, null, undefined, 5, "x", []]) expect(waitNoteOfSpec(spec), JSON.stringify(spec)).toBeNull();
  });
});
