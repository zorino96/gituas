// What an owner may be told about a video that did not come out. The stored text can hold a provider's
// own words (a voice service's answer, a renderer's trace): it is for the logs, never for the screen.

/** Stored when the AI could not write the storyboard and a plain one was made instead. */
export const PLAIN_VIDEO_NOTE = "a plain video: the AI could not write this one, so it was not posted by itself";

export function ownerJobError(status: string, error: string | null, texts: { plainVideo: string; jobFailed: string }): string | null {
  if (!error) return null;
  if (error === PLAIN_VIDEO_NOTE) return texts.plainVideo;
  // A failed attempt that will be tried again says nothing; the final failure says it plainly.
  return status === "FAILED" ? texts.jobFailed : null;
}
