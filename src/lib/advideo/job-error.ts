// What an owner may be told about a video that did not come out. The stored text can hold a provider's
// own words (a voice service's answer, a renderer's trace): it is for the logs, never for the screen.

/** Stored when the AI could not write the storyboard and a plain one was made instead. */
export const PLAIN_VIDEO_NOTE = "a plain video: the AI could not write this one, so it was not posted by itself";

/**
 * Stored when a story was asked for without a specific subject. No story fails this way any more (when the owner names no case the
 * system chooses a real one, see subject.ts): the text is kept so a job stored earlier still reads, and the "none" reason stays in
 * StorySubjectMissing for it.
 */
export const NO_SUBJECT_NOTE = "story needs a specific subject";
/**
 * Stored when the story's case cannot be told: the owner named one and the English Wikipedia has no article that matches it, or its
 * article is too short and the writer does not know the case well enough. The job fails at once.
 */
export const UNKNOWN_SUBJECT_NOTE = "story subject is not known well enough";
/** Stored (as the attempt's error, for the logs) when the owner's request could not be read by the model, twice. */
export const REQUEST_UNREADABLE_NOTE = "the story request could not be read; it will be tried again";
/** Stored when the case the system chose could not be told without its article. */
export const SOURCE_UNAVAILABLE_NOTE = "the story case could not be told without its article; it will be tried again";

/**
 * Thrown by the subject stage (resolveStorySubject) and by the writer when a documented story cannot be told because of a case the
 * OWNER NAMED: it has no Wikipedia article ("unknown"), or its article is too short and the writer, with nothing to tell it from,
 * refuses to guess. It lives here (not in write.ts) so a test that mocks the writer still gets the real class. Trying again would ask
 * the same question, so the job fails at once and the month's and the day's place go back. It is NEVER thrown for a case the system
 * chose, or for a request that merely could not be read (see StoryRetryable): the owner is told to write a name differently only when
 * the name was his. (The "none" reason is no longer thrown by this code.)
 */
export class StorySubjectMissing extends Error {
  readonly reason: "none" | "unknown";
  constructor(reason: "none" | "unknown") {
    super(reason === "none" ? NO_SUBJECT_NOTE : UNKNOWN_SUBJECT_NOTE);
    this.name = "StorySubjectMissing";
    this.reason = reason;
  }
}

/**
 * A story that could not be made right now for a reason a later try may fix and that is no fault of the owner's: his request could
 * not be read by the model (it was tried twice), or the case the system chose (or one told while Wikipedia is down) is not known well
 * enough without its article. An ordinary failure: the job is tried again (the cron tick, up to its tries) and then refunded, and the
 * owner reads the plain "could not be made" text, never a request to rename something he did not name.
 */
export class StoryRetryable extends Error {
  readonly reason: "request" | "source";
  constructor(reason: "request" | "source") {
    super(reason === "request" ? REQUEST_UNREADABLE_NOTE : SOURCE_UNAVAILABLE_NOTE);
    this.name = "StoryRetryable";
    this.reason = reason;
  }
}

/** Stored (as the attempt's note, for the logs) when a story attempt was put off for want of time. */
export const STORY_DEFERRED_NOTE = "the story attempt was put off: too little time was left in this run";

/**
 * Thrown by the writer BEFORE any model is paid for, when the run has too little time left for the step that reads the owner's request
 * (a request in Arabic or Sorani letters needs a model call of at least five seconds, and a story's director needs most of the rest).
 * It is nobody's fault and nothing was spent: the caller gives the attempt's try back (the next run starts with a full budget) instead
 * of burning one of the job's three tries. A caller that does not know this class treats it as an ordinary failed try.
 */
export class StoryDeferred extends StoryRetryable {
  constructor() {
    super("request");
    this.name = "StoryDeferred";
    this.message = STORY_DEFERRED_NOTE;
  }
}

export interface OwnerJobErrorTexts {
  plainVideo: string;
  jobFailed: string;
  /** The story named no specific subject (falls back to jobFailed). Not reached any more: see NO_SUBJECT_NOTE. */
  noSubject?: string;
  /** The case the owner named has no Wikipedia article, or the writer does not know it well enough (falls back to jobFailed). */
  unknownSubject?: string;
}

export function ownerJobError(status: string, error: string | null, texts: OwnerJobErrorTexts): string | null {
  if (!error) return null;
  if (error === PLAIN_VIDEO_NOTE) return texts.plainVideo;
  // A failed attempt that will be tried again says nothing; the final failure says it plainly.
  if (status !== "FAILED") return null;
  if (error === NO_SUBJECT_NOTE) return texts.noSubject ?? texts.jobFailed;
  if (error === UNKNOWN_SUBJECT_NOTE) return texts.unknownSubject ?? texts.jobFailed;
  return texts.jobFailed;
}
