"use client";

// The two things an owner does with a finished video that is going to YouTube (or anywhere Gituas does not post it itself): save the file, and copy
// its caption together with the photo credits. Shared by the Video screen's job card and the chat's finished story.

import { useState } from "react";

import { useT } from "@/lib/i18n/client";
import { downloadHref } from "./story-form";

/**
 * Saves the video. The address is the one that makes the browser download (a finished video lives on another origin, where the `download`
 * attribute alone is ignored); the attribute stays as the fallback for any other address.
 */
export function DownloadLink({ url, className = "gm-btn small" }: { url: string; className?: string }) {
  const v = useT().video;
  return (
    <a className={className} href={downloadHref(url)} download>
      {v.download}
    </a>
  );
}

/** Copies a text to the clipboard (the owner pastes it under the video wherever it goes), and says "Copied" for a moment. */
export function CopyButton({ text, disabled }: { text: string; disabled?: boolean }) {
  const v = useT().video;
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 2500);
    } catch {
      setDone(false);
    }
  }
  return (
    <button type="button" className="gm-btn small quiet" disabled={disabled} onClick={copy}>
      {done ? v.copied : v.copyCaption}
    </button>
  );
}
