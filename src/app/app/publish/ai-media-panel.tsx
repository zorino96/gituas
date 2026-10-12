"use client";

// "Or create it with AI" in the composer: a picture made by the AI image model, or a video made by
// the AI video pipeline (the same one as the Video section), each from an idea and, optionally,
// reference pictures. What comes back is handed to the composer as the post's media.

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { upload } from "@vercel/blob/client";
import { ImagePlus, Sparkles, X } from "lucide-react";

import { useT } from "@/lib/i18n/client";
import { createVideoAction, videoJobStatusAction } from "../video/actions";
import { generateAiImageAction } from "./ai-image-action";

export interface AiMediaConfig {
  storeId: string;
  /** The plan has no AI media at all: the panel only says so. */
  paid: boolean;
  image: { on: boolean; configured: boolean; month: number; day: number } | null;
  video: { on: boolean; tier: "LITE" | "PRO"; month: number; day: number; refImages: number; refVideos: number } | null;
  /** Which shop each product belongs to: a video is made for the shop of the chosen product. */
  productStores: Record<string, string>;
}

type Media = { url: string; pathname: string; type: "IMAGE" | "VIDEO" };

const MB = 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const CLIP_TYPES: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov" };
const MAX_REF_IMAGES = 3;
const REF_LIMITS = { images: 8, videos: 3 };

export function AiMediaPanel({
  workspaceId,
  config,
  productId,
  disabled,
  hasMedia,
  onMedia,
}: {
  workspaceId: string;
  config: AiMediaConfig;
  /** The product chosen in the composer ("" for none). */
  productId: string;
  disabled: boolean;
  /** The composer already has a picture or video attached (this panel stays mounted but hidden). */
  hasMedia: boolean;
  onMedia: (media: Media, caption?: string | null) => void;
}) {
  const t = useT();
  const a = t.publish.ai;
  const imageOn = !!config.image?.on;
  const videoOn = !!config.video?.on;
  const [mode, setMode] = useState<"image" | "video">(imageOn || !videoOn ? "image" : "video");
  const [idea, setIdea] = useState("");
  const [shape, setShape] = useState<"square" | "portrait">("square");
  const [refs, setRefs] = useState<{ url: string; src: string }[]>([]);
  const [videoRefs, setVideoRefs] = useState({ images: config.video?.refImages ?? 0, videos: config.video?.refVideos ?? 0 });
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [job, setJob] = useState<{ id: string; status: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const stopped = useRef(false);
  // The composer re-renders on every key: the polling must not restart with it.
  const onMediaRef = useRef(onMedia);
  onMediaRef.current = onMedia;
  const refsRef = useRef(refs);
  refsRef.current = refs;

  // The picture is gone from the composer: the "done" line no longer applies. Thumbnails are released with the panel.
  useEffect(() => {
    if (!hasMedia) setNote(null);
  }, [hasMedia]);
  useEffect(() => () => refsRef.current.forEach((r) => URL.revokeObjectURL(r.src)), []);

  // The video is made on the render machine: ask how it is going until it is ready or has failed.
  useEffect(() => {
    if (!job || ["RENDERED", "POSTING", "POSTED", "FAILED"].includes(job.status)) return;
    stopped.current = false;
    const timer = setInterval(async () => {
      const r = await videoJobStatusAction(job.id);
      if (stopped.current) return;
      if (!r.ok) {
        setErr(r.error);
        setJob(null);
        return;
      }
      if (r.status === "FAILED") {
        setErr(r.error || a.errors.video);
        setJob(null);
      } else if (r.url && r.pathname) {
        setJob({ id: job.id, status: "RENDERED" });
        setNote(a.doneVideo);
        onMediaRef.current({ url: r.url, pathname: r.pathname, type: "VIDEO" }, r.caption);
        setJob(null);
      } else {
        setJob({ id: job.id, status: r.status });
      }
    }, 6000);
    return () => {
      stopped.current = true;
      clearInterval(timer);
    };
  }, [job, a]);

  if (!config.paid) {
    return (
      <div className="gm-card">
        <p className="gm-hint" style={{ marginTop: 0 }}>
          <Sparkles size={14} aria-hidden="true" /> {a.paidOnly}{" "}
          <Link href="/app/billing" className="gm-link">
            {t.billing.title}
          </Link>
        </p>
      </div>
    );
  }
  if (!imageOn && !videoOn && !config.image && !config.video) return null;

  const imageNotReady = mode === "image" && config.image && !config.image.configured;

  async function addRefs(files: File[]) {
    setErr(null);
    setUploading(true);
    // Counted as the files go up: a multi-file pick cannot pass the cap through stale numbers.
    let nImages = refs.length;
    let nVideoImages = videoRefs.images;
    let nVideoClips = videoRefs.videos;
    try {
      for (const file of files) {
        if (mode === "image") {
          const ext = IMAGE_TYPES[file.type];
          if (!ext || file.size > 12 * MB || nImages >= MAX_REF_IMAGES) continue;
          const blob = await upload(`merchant/${workspaceId}/ai-ref-${Date.now()}-${nImages}.${ext}`, file, { access: "public", handleUploadUrl: "/api/app/upload", contentType: file.type });
          nImages++;
          setRefs((r) => [...r, { url: blob.url, src: URL.createObjectURL(file) }]);
        } else {
          const ext = IMAGE_TYPES[file.type] ?? CLIP_TYPES[file.type];
          const isClip = !!CLIP_TYPES[file.type];
          if (!ext || !config.video) continue;
          if (file.size > (isClip ? 40 : 12) * MB) continue;
          if (isClip ? nVideoClips >= REF_LIMITS.videos : nVideoImages >= REF_LIMITS.images) continue;
          await upload(`merchant/${workspaceId}/advideo-ref/${config.storeId}/${Date.now()}.${ext}`, file, {
            access: "public",
            handleUploadUrl: "/api/app/upload",
            contentType: file.type,
            multipart: file.size > 20 * MB,
          });
          if (isClip) nVideoClips++;
          else nVideoImages++;
          setVideoRefs((c) => (isClip ? { ...c, videos: c.videos + 1 } : { ...c, images: c.images + 1 }));
        }
      }
    } catch {
      setErr(a.errors.failed);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function makeImage() {
    setErr(null);
    setNote(null);
    start(async () => {
      try {
        const r = await generateAiImageAction({ idea, productId: productId || null, refUrls: refs.map((x) => x.url), shape });
        if (r.ok) {
          setNote(a.doneImage);
          onMediaRef.current(r.media);
        } else {
          setErr(r.error);
        }
      } catch {
        // The connection dropped or the page timed out: say so here, do not take the whole composer down.
        setErr(a.errors.failed);
      }
    });
  }

  function makeVideo() {
    if (!config.video) return;
    setErr(null);
    setNote(null);
    start(async () => {
      try {
        const storeId = (productId && config.productStores[productId]) || config.storeId;
        const r = await createVideoAction(storeId, { tier: config.video!.tier, topic: idea, productId: productId || null, voice: "shilan", publish: false, targets: [] });
        if (r.ok && r.id) setJob({ id: r.id, status: "QUEUED" });
        else if (!r.ok) setErr(r.error);
      } catch {
        setErr(a.errors.failed);
      }
    });
  }

  const busy = pending || uploading || !!job || disabled;
  // A message from the other tab does not belong to this one.
  function switchMode(next: "image" | "video") {
    setMode(next);
    setErr(null);
    setNote(null);
  }
  const left = mode === "image" ? config.image : config.video;
  const statusLabel = job ? (t.video.status as Record<string, string>)[job.status] ?? job.status : null;

  return (
    <div className="gm-card gm-stack">
      <p className="gm-sec" style={{ margin: 0 }}>
        <Sparkles size={14} aria-hidden="true" /> {a.title}
      </p>

      <div className="gm-seg" role="group" aria-label={a.title}>
        {config.image && (
          <button type="button" aria-pressed={mode === "image"} disabled={busy} onClick={() => switchMode("image")}>
            {a.imageTab}
          </button>
        )}
        {config.video && (
          <button type="button" aria-pressed={mode === "video"} disabled={busy} onClick={() => switchMode("video")}>
            {a.videoTab}
          </button>
        )}
      </div>

      <div className="gm-field">
        <label htmlFor="gm-ai-idea">{a.ideaLabel}</label>
        <textarea
          id="gm-ai-idea"
          className="gm-textarea"
          style={{ minHeight: 76 }}
          maxLength={400}
          value={idea}
          placeholder={mode === "image" ? a.ideaImage : a.ideaVideo}
          disabled={busy}
          onChange={(e) => setIdea(e.target.value)}
        />
      </div>

      {mode === "image" && (
        <div className="gm-field">
          <label>{a.shapeLabel}</label>
          <div className="gm-seg" role="group" aria-label={a.shapeLabel}>
            <button type="button" aria-pressed={shape === "square"} disabled={busy} onClick={() => setShape("square")}>
              {a.square}
            </button>
            <button type="button" aria-pressed={shape === "portrait"} disabled={busy} onClick={() => setShape("portrait")}>
              {a.portrait}
            </button>
          </div>
        </div>
      )}

      <div className="gm-field">
        <label>{a.refsLabel}</label>
        {mode === "image" && refs.length > 0 && (
          <div className="gm-row" style={{ flexWrap: "wrap" }}>
            {refs.map((r) => (
              <span key={r.url} style={{ position: "relative" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="gm-thumb" src={r.src} alt="" />
                <button
                  type="button"
                  className="gm-btn quiet small"
                  aria-label={a.remove}
                  disabled={busy}
                  onClick={() => {
                    URL.revokeObjectURL(r.src);
                    setRefs((all) => all.filter((x) => x.url !== r.url));
                  }}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
        {mode === "video" && (
          <p className="gm-hint" style={{ marginTop: 0 }}>
            {a.refCounts(videoRefs.images, REF_LIMITS.images, videoRefs.videos, REF_LIMITS.videos)}
          </p>
        )}
        <div>
          <button type="button" className="gm-btn quiet small" disabled={busy} onClick={() => fileInput.current?.click()}>
            <ImagePlus size={14} aria-hidden="true" /> {mode === "image" ? a.addPictures : a.addClips}
          </button>
          <input
            ref={fileInput}
            type="file"
            hidden
            multiple
            accept={mode === "image" ? "image/jpeg,image/png,image/webp" : "image/jpeg,image/png,image/webp,video/mp4,video/quicktime"}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) void addRefs(files);
            }}
          />
        </div>
        <p className="gm-hint">{mode === "image" ? a.refsHelp : a.refsHelpVideo}</p>
        <p className="gm-hint" style={{ marginTop: 0 }}>
          {a.rights}
        </p>
      </div>

      {imageNotReady ? <p className="gm-note warn">{a.notReady}</p> : null}
      {left && <p className="gm-hint">{mode === "image" ? a.imagesLeft(left.month, left.day) : a.videosLeft(left.month, left.day)}</p>}

      <div>
        <button
          type="button"
          className="gm-btn"
          disabled={busy || idea.trim().length < 3 || (mode === "image" ? !config.image?.on || config.image.month < 1 || config.image.day < 1 : !config.video?.on || config.video.month < 1 || config.video.day < 1)}
          onClick={mode === "image" ? makeImage : makeVideo}
        >
          {mode === "image" ? a.makeImage : a.makeVideo}
        </button>
        {pending && mode === "image" && <p className="gm-hint">{a.workingImage}</p>}
        {job && (
          <p className="gm-hint">
            {a.workingVideo} {statusLabel ? `(${statusLabel})` : ""}
          </p>
        )}
        {note && <p className="gm-ok">{note}</p>}
        {err && <p className="gm-err">{err}</p>}
      </div>
    </div>
  );
}
