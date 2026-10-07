"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { upload } from "@vercel/blob/client";

import { useT } from "@/lib/i18n/client";
import { makeVideoAction, videoStatusAction, type VideoView } from "../actions";

const WORKING = ["QUEUED", "VOICED", "RENDERING"];
const MAX_CLIPS = 3;

/**
 * A draft's video: the team uploads up to three of its own clips and gets a 9:16 highlight with
 * our voice and captions (or the brand template without clips), then publishes it.
 */
export function VideoPanel({ workspaceId, draftId, initial }: { workspaceId: string; draftId: string; initial: VideoView | null }) {
  const t = useT();
  const te = t.nr.news.editor;
  const [video, setVideo] = useState<VideoView | null>(initial);
  const [clips, setClips] = useState<string[]>([]);
  const [uploading, setUploading] = useState<{ done: number; of: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const working = !!video && WORKING.includes(video.status);

  // Follow a video that is being made; the render takes a few minutes.
  useEffect(() => {
    if (!working) return;
    const id = setInterval(async () => {
      const r = await videoStatusAction(draftId);
      if (r.ok && r.video) setVideo(r.video);
    }, 15_000);
    return () => clearInterval(id);
  }, [working, draftId]);

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    const list = [...files].filter((f) => f.type === "video/mp4" || f.type === "video/quicktime");
    if (list.length + clips.length > MAX_CLIPS) return setError(te.videoTooMany);
    setError(null);
    setUploading({ done: 0, of: list.length });
    try {
      const urls: string[] = [];
      for (const [i, f] of list.entries()) {
        const ext = f.type === "video/quicktime" ? "mov" : "mp4";
        const blob = await upload(`merchant/${workspaceId}/footage/${Date.now()}-${i}.${ext}`, f, {
          access: "public",
          handleUploadUrl: "/api/app/upload",
          contentType: f.type,
          multipart: f.size > 20 * 1024 * 1024,
        });
        urls.push(blob.url);
        setUploading({ done: i + 1, of: list.length });
      }
      setClips((c) => [...c, ...urls]);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.common.error);
    } finally {
      setUploading(null);
    }
  }

  function make() {
    setError(null);
    start(async () => {
      const r = await makeVideoAction(draftId, clips);
      if (!r.ok) return setError(r.error);
      setVideo(r.video);
      setClips([]);
    });
  }

  return (
    <>
      <p className="gm-sec">{te.videoSec}</p>
      <div className="gm-card gm-stack">
        <p className="gm-hint" style={{ margin: 0 }}>{te.videoHint}</p>
        {video?.status === "RENDERED" && video.videoUrl && (
          <>
            <p className="gm-ok" style={{ margin: 0 }}>{te.videoReady}</p>
            <video src={video.videoUrl} controls playsInline style={{ width: 240, aspectRatio: "9 / 16", borderRadius: 12, background: "#000" }} />
            <Link href={`/newsroom/publish?draft=${draftId}&video=${video.id}`} className="gm-btn" style={{ alignSelf: "flex-start" }}>
              {te.videoPublish}
            </Link>
          </>
        )}
        {working && <p className="gm-note" style={{ margin: 0 }}>{te.videoWorking}</p>}
        {video && (video.status === "FAILED" || video.status === "CARD") && <p className="gm-err" style={{ margin: 0 }}>{te.videoFailed}</p>}
        {!working && (
          <>
            <label className="gm-btn quiet small" style={{ alignSelf: "flex-start", opacity: uploading ? 0.6 : 1, pointerEvents: uploading ? "none" : "auto" }}>
              {uploading ? te.videoUploading(uploading.done, uploading.of) : te.videoPick}
              <input type="file" accept="video/mp4,video/quicktime" multiple hidden disabled={!!uploading} onChange={(e) => pick(e.target.files)} />
            </label>
            {clips.length > 0 && <small className="gm-sub" style={{ margin: 0 }}>{te.videoClips(clips.length)}</small>}
            <button type="button" className="gm-btn" disabled={pending || !!uploading} onClick={make}>
              {clips.length ? te.videoMakeHighlight : te.videoMakeTemplate}
            </button>
          </>
        )}
        {error && <p className="gm-err" style={{ margin: 0 }}>{error}</p>}
      </div>
    </>
  );
}
