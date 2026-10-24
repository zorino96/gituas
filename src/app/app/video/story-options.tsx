"use client";

import { useT } from "@/lib/i18n/client";
import { SwitchRow } from "../automation/shared";
import type { StoryForm, VideoFormat } from "./story-form";

/**
 * The extra options of a story, after the voice (in every video language): its SHAPE (vertical 9:16 for Reels, or wide 16:9 for YouTube; when
 * the caller handles the choice), then the switch for the real photographs from Wikimedia Commons (a story told from a real case), or a note
 * that a fiction has none. An ad shows nothing here (an ad is always vertical).
 */
export function StoryOptions({
  form,
  photos,
  disabled,
  onToggle,
  format,
  onFormat,
}: {
  form: StoryForm;
  photos: boolean;
  disabled?: boolean;
  onToggle: () => void;
  /** The shape chosen now, and the handler: given, the shape choice is shown (left out, as in the older callers, there is none). */
  format?: VideoFormat;
  onFormat?: (next: VideoFormat) => void;
}) {
  const v = useT().video;
  if (!form.story) return null;
  return (
    <>
      {onFormat && (
        <div className="gm-field">
          <label>{v.formatLabel}</label>
          <div className="gm-seg" role="group" aria-label={v.formatLabel}>
            <button type="button" aria-pressed={format !== "wide"} disabled={disabled} onClick={() => onFormat("vertical")}>
              {v.formatVertical}
            </button>
            <button type="button" aria-pressed={format === "wide"} disabled={disabled} onClick={() => onFormat("wide")}>
              {v.formatWide}
            </button>
          </div>
          <p className="gm-hint">{v.formatHint}</p>
        </div>
      )}
      {form.realStory ? <SwitchRow label={v.storyPhotosLabel} hint={v.storyPhotosHint} checked={photos} disabled={disabled} onToggle={onToggle} /> : <p className="gm-hint">{v.storyFictionNote}</p>}
    </>
  );
}
