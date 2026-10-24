"use client";

// What the chat shows when a story video is finished: it is the owner's video to check before it goes anywhere, so the line that it is ready
// comes with the video itself (`video`, drawn by the chat), the case it tells (a link to its article only when that article was read), the notes
// that tell the owner to check the facts (told from memory, a very recent case) or why it was not posted by itself, Download, Copy caption (with the
// photo credits that must travel with the video) and the way to the Video section where it can be posted. It never offers "ask me to post it":
// a real story is read first and posted from the Video section.

import type { ReactNode } from "react";
import Link from "next/link";

import { useT } from "@/lib/i18n/client";
import { CopyButton, DownloadLink } from "../video/story-actions";
import { captionWithCredits, type StoryStatusView } from "../video/story-form";

export function StoryReady({ url, caption, story, video }: { url: string; caption: string | null; story: StoryStatusView; video: ReactNode }) {
  const v = useT().video;
  const credits = story.credits;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <p className="ch-ok" role="status">
        {v.chatStoryReady}
      </p>
      {video}
      {story.subject && (
        <p className="ch-note">
          <span>
            {v.subjectLine}:{" "}
            <b>
              <bdi>{story.subject}</bdi>
            </b>
            {story.subjectUrl && (
              <>
                {" · "}
                <a className="gm-link" href={story.subjectUrl} target="_blank" rel="noopener noreferrer">
                  {v.sourceWikipedia}
                </a>
              </>
            )}
            {story.chosen && ` · ${v.subjectChosenNote}`}
          </span>
        </p>
      )}
      {story.subject && story.fromMemory && <p className="ch-note warn">{v.fromMemoryNote}</p>}
      {story.subject && story.recent && <p className="ch-note warn">{v.recentNote}</p>}
      {story.waited && <p className="ch-note">{story.waited}</p>}
      <div className="gm-row" style={{ flexWrap: "wrap" }}>
        <DownloadLink url={url} />
        <CopyButton text={captionWithCredits({ caption, credits }, v.photoCredits)} disabled={!caption && credits.length === 0} />
        <Link className="gm-link" href="/app/video">
          {v.openSection}
        </Link>
      </div>
      {credits.length > 0 && <p className="ch-note">{v.creditsTravel}</p>}
      <p className="ch-note">{v.youtubeNote}</p>
    </div>
  );
}
