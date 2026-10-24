// Why a finished story video waits for its owner instead of being posted by itself.
//
// An AI story is posted automatically (the daily routine, or the owner's own choice to post a manual video when it is ready) ONLY when it
// was told from an article that was really read, about a case that is not recent, as the kind of story the owner asked for. In every other
// case the video is made and kept as a draft, and the job carries one of the notes below (in its `error` column, like the plain-storyboard
// note, in plain English for the logs). The Video screen and the chat map each note to a sentence in the owner's language with
// ownerWaitNote below; the stored English text is never shown as it is.

import type { StoryMode } from "./lang";

/** The story was told from what the writer remembers: Wikipedia could not be read, or the article was too short. Its facts must be checked first. */
export const WAIT_MEMORY_NOTE = "waits for you: told from memory, not from an article";
/** The case is recent, or may involve people who are alive: the owner reads it before it goes out. */
export const WAIT_RECENT_NOTE = "waits for you: a recent case";
/** The story is invented, and the owner's own words did not ask for fiction (a story told as fiction by a guess is never posted by itself). */
export const WAIT_FICTION_NOTE = "waits for you: an invented story you did not ask for";

export const WAIT_NOTES: readonly string[] = [WAIT_MEMORY_NOTE, WAIT_RECENT_NOTE, WAIT_FICTION_NOTE];

/** Whether a stored job error is one of these notes. */
export function isWaitNote(error: string | null | undefined): boolean {
  return typeof error === "string" && WAIT_NOTES.includes(error);
}

export interface WaitCheck {
  /** How the story is told (storyModeOf). Only "real" and "fiction" can wait; an ad is never held here. */
  mode: StoryMode;
  /** The owner's own words asked for fiction (the spec stub's `fiction: true`). */
  fictionAsked: boolean;
  /** The subject the writer step set (spec.subject). */
  subject?: { fromMemory?: unknown; recent?: unknown } | null;
}

/**
 * The note for a story that must not be posted by itself, or null when it may be: a documented story told from a read article about a case
 * that is not recent, or an invented story the owner asked for. Memory is named before recent, recent before fiction.
 */
export function waitNoteFor(c: WaitCheck): string | null {
  if (c.mode === "real") {
    if (c.subject?.fromMemory === true) return WAIT_MEMORY_NOTE;
    if (c.subject?.recent === true) return WAIT_RECENT_NOTE;
    return null;
  }
  if (c.mode === "fiction") return c.fictionAsked ? null : WAIT_FICTION_NOTE;
  return null;
}

/**
 * The note a FINISHED video's spec stands for: what the owner is told about why a story was not posted by itself, read from the spec alone
 * (the stored job error is cleared when the render finishes, so a screen reads the spec to say why a rendered story waits). Null for an ad,
 * and for a story that may be posted: told from a read article, not recent, or invented at the owner's own asking.
 */
export function waitNoteOfSpec(spec: unknown): string | null {
  const s = (spec && typeof spec === "object" ? spec : null) as { kind?: unknown; fiction?: unknown; subject?: { kind?: unknown; fromMemory?: unknown; recent?: unknown } | null } | null;
  if (!s || s.kind !== "story") return null;
  return waitNoteFor({ mode: s.subject?.kind === "fiction" ? "fiction" : "real", fictionAsked: s.fiction === true, subject: s.subject ?? null });
}

export interface OwnerWaitTexts {
  /** The story was told from memory: check every fact before posting it. */
  memory: string;
  /** The case is recent: read it before posting. */
  recent: string;
  /** The story is invented, and the words of the idea did not ask for fiction. */
  fiction: string;
}

/** The sentence for the owner when a stored error is one of the waiting notes (in his language, from the caller's texts); null for anything else. */
export function ownerWaitNote(error: string | null | undefined, texts: OwnerWaitTexts): string | null {
  if (error === WAIT_MEMORY_NOTE) return texts.memory;
  if (error === WAIT_RECENT_NOTE) return texts.recent;
  if (error === WAIT_FICTION_NOTE) return texts.fiction;
  return null;
}
