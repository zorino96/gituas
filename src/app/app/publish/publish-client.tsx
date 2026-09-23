"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { upload } from "@vercel/blob/client";
import { ImagePlus, Sparkles, X } from "lucide-react";

import { CAPTION_LIMITS, CITY_TAGS, captionProblems, mergeHashtags, type Target } from "@/lib/merchant/caption";
import { tiktokProblems } from "@/lib/merchant/tiktok-rules";
import {
  publishAction,
  suggestCaptionAction,
  tiktokContextAction,
  tiktokStatusAction,
  type PublishOutcome,
  type TikTokContext,
} from "../actions";
import { PLATFORM_NAME, PRIVACY_LABEL, friendlyError, num } from "../format";

const ACCEPT = "image/jpeg,image/png,image/webp,video/mp4,video/quicktime";
const MAX_BYTES = 250 * 1024 * 1024;

interface Media {
  url: string;
  pathname: string;
  type: "IMAGE" | "VIDEO";
  durationSec?: number;
}

function readDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      const d = Number.isFinite(v.duration) ? v.duration : undefined;
      URL.revokeObjectURL(v.src);
      resolve(d);
    };
    v.onerror = () => resolve(undefined);
    v.src = URL.createObjectURL(file);
  });
}

export function PublishClient({
  workspaceId,
  accounts,
}: {
  workspaceId: string;
  accounts: Record<Target, string | null>;
}) {
  // media
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ src: string; type: "IMAGE" | "VIDEO" } | null>(null);
  const [media, setMedia] = useState<Media | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  // caption
  const [caption, setCaption] = useState("");
  const [suggesting, startSuggest] = useTransition();
  const [captionError, setCaptionError] = useState<string | null>(null);

  // targets
  const [on, setOn] = useState<Record<Target, boolean>>({ FB: !!accounts.FB, IG: false, TT: false });

  // tiktok
  const [tt, setTt] = useState<TikTokContext | null>(null);
  const [ttError, setTtError] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState<string | null>(null);
  const [allowComment, setAllowComment] = useState(false);
  const [allowDuet, setAllowDuet] = useState(false);
  const [allowStitch, setAllowStitch] = useState(false);
  const [commercial, setCommercial] = useState(false);
  const [yourBrand, setYourBrand] = useState(false);
  const [branded, setBranded] = useState(false);

  // publish
  const [publishing, startPublish] = useTransition();
  const [results, setResults] = useState<PublishOutcome[] | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [ttStatus, setTtStatus] = useState<string | null>(null);

  const targets = (Object.keys(on) as Target[]).filter((t) => on[t]);
  const isVideo = media?.type === "VIDEO";
  const uploading = progress !== null && !media;

  // Instagram and TikTok need media; TikTok needs video. Switch them off when that stops being true.
  useEffect(() => {
    setOn((o) => ({ ...o, IG: o.IG && !!media, TT: o.TT && !!media && isVideo }));
  }, [media, isVideo]);

  // Load TikTok's creator_info the moment TikTok is switched on — its privacy
  // options and interaction switches must come from TikTok, not from us.
  useEffect(() => {
    if (!on.TT || tt) return;
    let cancelled = false;
    setTtError(null);
    tiktokContextAction().then((r) => {
      if (cancelled) return;
      if (r.ok) setTt(r.ctx);
      else setTtError(friendlyError(r.error));
    });
    return () => {
      cancelled = true;
    };
  }, [on.TT, tt]);

  async function pickFile(file: File) {
    setMediaError(null);
    setResults(null);
    if (!ACCEPT.split(",").includes(file.type)) {
      setMediaError("تەنیا وێنەی JPG/PNG/WEBP یان ڤیدیۆی MP4/MOV.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setMediaError("فایلەکە لە ٢٥٠ مێگابایت گەورەترە.");
      return;
    }
    const type = file.type.startsWith("video/") ? "VIDEO" : "IMAGE";
    if (preview) URL.revokeObjectURL(preview.src);
    setPreview({ src: URL.createObjectURL(file), type });
    setMedia(null);
    setProgress(0);
    try {
      const durationSec = type === "VIDEO" ? await readDuration(file) : undefined;
      const ext = (file.name.split(".").pop() || (type === "VIDEO" ? "mp4" : "jpg")).toLowerCase().replace(/[^a-z0-9]/g, "");
      const blob = await upload(`merchant/${workspaceId}/${Date.now()}.${ext}`, file, {
        access: "public",
        handleUploadUrl: "/api/app/upload",
        contentType: file.type,
        onUploadProgress: ({ percentage }) => setProgress(Math.round(percentage)),
      });
      setMedia({ url: blob.url, pathname: blob.pathname, type, durationSec });
      setProgress(100);
      setOn((o) => ({ ...o, IG: !!accounts.IG, TT: type === "VIDEO" && !!accounts.TT }));
    } catch (e) {
      setProgress(null);
      setPreview(null);
      setMediaError(`بارکردن سەرکەوتوو نەبوو: ${e instanceof Error ? e.message : "هەڵە"}`);
    }
  }

  function clearMedia() {
    if (preview) URL.revokeObjectURL(preview.src);
    setPreview(null);
    setMedia(null);
    setProgress(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  function suggest() {
    setCaptionError(null);
    startSuggest(async () => {
      const r = await suggestCaptionAction(caption);
      if (r.ok) setCaption(r.caption);
      else setCaptionError(friendlyError(r.error));
    });
  }

  const limit = targets.length ? Math.min(...targets.map((t) => CAPTION_LIMITS[t])) : CAPTION_LIMITS.IG;
  const captionIssues = captionProblems(caption, targets);
  const ttIssues = useMemo(
    () =>
      on.TT && tt
        ? tiktokProblems(
            { privacy, commercial, yourBrand, branded, durationSec: media?.durationSec },
            { privacyOptions: tt.privacyOptions, maxDurationSec: tt.maxDurationSec },
          )
        : [],
    [on.TT, tt, privacy, commercial, yourBrand, branded, media?.durationSec],
  );

  const blockers: string[] = [];
  if (!targets.length) blockers.push("لانیکەم یەک شوێن هەڵبژێرە.");
  if (!caption.trim() && !media) blockers.push("دەق یان وێنە/ڤیدیۆیەک زیاد بکە.");
  if (uploading) blockers.push("چاوەڕێ بکە تا بارکردن تەواو دەبێت.");
  if (captionIssues.length) blockers.push("دەقەکە بۆ یەکێک لە شوێنەکان درێژە.");
  if (on.TT && !tt) blockers.push("زانیاری تیکتۆک هێشتا نەهاتووە.");
  if (on.TT && ttIssues.includes("privacy")) blockers.push("لە تیکتۆک دیاری بکە کێ ڤیدیۆکە ببینێت.");
  if (on.TT && ttIssues.includes("commercial")) blockers.push("جۆری ناوەڕۆکی بازرگانی هەڵبژێرە.");
  if (on.TT && ttIssues.includes("branded-private")) blockers.push("ناوەڕۆکی براند ناتوانێت «تەنیا خۆم» بێت.");
  if (on.TT && ttIssues.includes("duration")) blockers.push("ڤیدیۆکە لە سنووری تیکتۆکی ئەم ئەکاونتە درێژترە.");

  function publish() {
    setPublishError(null);
    setResults(null);
    setTtStatus(null);
    startPublish(async () => {
      const r = await publishAction({
        caption,
        targets,
        media: media ?? undefined,
        tiktok: on.TT ? { privacy, allowComment, allowDuet, allowStitch, commercial, yourBrand, branded } : undefined,
      });
      if (!r.ok) {
        setPublishError(r.error);
        return;
      }
      setResults(r.results);
      const ttResult = r.results.find((x) => x.target === "TT" && x.ok && x.publishId);
      if (ttResult?.publishId) pollTikTok(ttResult.publishId);
    });
  }

  function pollTikTok(publishId: string, attempt = 0) {
    setTtStatus("PROCESSING");
    tiktokStatusAction(publishId).then((s) => {
      if (!s.ok) return setTtStatus(`ERROR:${s.error}`);
      if (s.status === "PUBLISH_COMPLETE") return setTtStatus("PUBLISH_COMPLETE");
      if (s.status === "FAILED") return setTtStatus(`ERROR:${s.failReason ?? "failed"}`);
      if (attempt < 24) setTimeout(() => pollTikTok(publishId, attempt + 1), 5000);
      else setTtStatus("SLOW");
    });
  }

  function reset() {
    clearMedia();
    setCaption("");
    setResults(null);
    setTtStatus(null);
    setPrivacy(null);
    setAllowComment(false);
    setAllowDuet(false);
    setAllowStitch(false);
    setCommercial(false);
    setYourBrand(false);
    setBranded(false);
  }

  if (results) {
    return (
      <div>
        <h2 className="gm-title kufi">ئەنجامی بڵاوکردنەوە</h2>
        <div className="gm-card" style={{ marginTop: 12 }}>
          {results.map((r) => (
            <div key={r.target} className="gm-target">
              <div>
                <p>{PLATFORM_NAME[r.target]}</p>
                {r.ok ? (
                  <small>
                    {r.target === "TT"
                      ? ttStatus === "PUBLISH_COMPLETE"
                        ? "بڵاو کرایەوە لە تیکتۆک."
                        : ttStatus?.startsWith("ERROR:")
                          ? `تیکتۆک ڕەتی کردەوە: ${friendlyError(ttStatus.slice(6))}`
                          : ttStatus === "SLOW"
                            ? "تیکتۆک هێشتا ڤیدیۆکە پرۆسێس دەکات — چەند خولەکێکی تر لە پرۆفایلەکەت دەردەکەوێت."
                            : "تیکتۆک ڤیدیۆکە وەردەگرێت و پرۆسێسی دەکات…"
                      : "بڵاو کرایەوە."}
                  </small>
                ) : (
                  <small className="gm-err" style={{ margin: 0 }}>{friendlyError(r.error)}</small>
                )}
              </div>
              {r.ok && r.url ? (
                <a href={r.url} target="_blank" rel="noreferrer" className="gm-btn quiet small">بینین</a>
              ) : (
                <span className={`gm-badge ${r.ok ? "" : "warn"}`}>{r.ok ? "سەرکەوتوو" : "نەکرا"}</span>
              )}
            </div>
          ))}
        </div>
        <button type="button" className="gm-btn block" style={{ marginTop: 14 }} onClick={reset}>
          پۆستێکی نوێ
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2 className="gm-title kufi">بڵاوکردنەوە</h2>
      <p className="gm-sub">یەک جار — بۆ فەیسبووک، ئینستاگرام و تیکتۆک پێکەوە.</p>

      {/* media */}
      {preview ? (
        <div className="gm-card">
          {preview.type === "VIDEO" ? (
            <video src={preview.src} className="gm-preview" controls playsInline muted />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.src} alt="" className="gm-preview" />
          )}
          {progress !== null && progress < 100 && (
            <div className="gm-progress" aria-label="بارکردن">
              <i style={{ width: `${progress}%` }} />
            </div>
          )}
          <div className="gm-between" style={{ marginTop: 10 }}>
            <span className="gm-time">
              {media ? (isVideo && media.durationSec ? `ڤیدیۆ · ${num(Math.round(media.durationSec))} چرکە` : "ئامادەیە") : `بارکردن… ${num(progress ?? 0)}٪`}
            </span>
            <button type="button" className="gm-btn quiet small" onClick={clearMedia} disabled={uploading}>
              <X size={14} aria-hidden="true" /> لابردن
            </button>
          </div>
        </div>
      ) : (
        <label className="gm-drop" htmlFor="gm-media">
          <ImagePlus size={26} aria-hidden="true" />
          <b>وێنە یان ڤیدیۆ هەڵبژێرە</b>
          JPG، PNG، MP4 — تا ٢٥٠ مێگابایت
        </label>
      )}
      <input
        ref={fileInput}
        id="gm-media"
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pickFile(f);
        }}
      />
      {mediaError && <p className="gm-err">{mediaError}</p>}

      {/* caption */}
      <p className="gm-sec">دەق</p>
      <textarea
        id="gm-caption"
        className="gm-textarea"
        rows={5}
        dir="auto"
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        placeholder="دەربارەی بەرهەمەکە بنووسە… یان چەند وشەیەک بنووسە و AI دەقەکەت بۆ دەنووسێت."
        aria-label="دەقی پۆست"
      />
      <div className="gm-between" style={{ marginTop: 8, flexWrap: "wrap" }}>
        <div className="gm-row" style={{ gap: 6, flexWrap: "wrap" }}>
          <button type="button" className="gm-btn quiet small" onClick={suggest} disabled={suggesting}>
            <Sparkles size={14} aria-hidden="true" />
            {suggesting ? "دەنووسێت…" : "دەقێکم بۆ بنووسە"}
          </button>
          <button type="button" className="gm-btn quiet small" onClick={() => setCaption((c) => mergeHashtags(c, CITY_TAGS))}>
            + هاشتاگی شارەکان
          </button>
        </div>
        <span className={`gm-time ${captionIssues.length ? "gm-err" : ""}`} style={{ margin: 0 }}>
          {num([...caption].length)} / {num(limit)}
        </span>
      </div>
      {captionError && <p className="gm-err">{captionError}</p>}

      {/* targets */}
      <p className="gm-sec">بۆ کوێ</p>
      <div className="gm-card">
        {(["FB", "IG", "TT"] as Target[]).map((t) => {
          const account = accounts[t];
          const needsMedia = (t === "IG" || t === "TT") && !media;
          const needsVideo = t === "TT" && !!media && !isVideo;
          const disabled = !account || needsMedia || needsVideo;
          return (
            <div key={t} className="gm-target">
              <div>
                <p>{PLATFORM_NAME[t]}</p>
                <small>
                  {!account ? (
                    <Link href="/app/settings" className="gm-link">پەیوەست نەکراوە — پەیوەستی بکە</Link>
                  ) : needsMedia ? (
                    "وێنە یان ڤیدیۆی دەوێت"
                  ) : needsVideo ? (
                    "تیکتۆک تەنیا ڤیدیۆ وەردەگرێت"
                  ) : (
                    account
                  )}
                </small>
              </div>
              <button
                type="button"
                role="switch"
                className="gm-knob"
                aria-checked={on[t] && !disabled}
                aria-label={PLATFORM_NAME[t]}
                disabled={disabled}
                onClick={() => setOn((o) => ({ ...o, [t]: !o[t] }))}
              >
                <i />
              </button>
            </div>
          );
        })}
      </div>

      {/* tiktok — the audited elements, all of them */}
      {on.TT && (
        <div className="gm-tt">
          {ttError && <p className="gm-err" style={{ marginTop: 0 }}>{ttError}</p>}
          {!tt && !ttError && <p className="gm-sub" style={{ margin: 0 }}>زانیاری تیکتۆک دێت…</p>}
          {tt && (
            <>
              <div className="gm-row">
                {tt.avatarUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={tt.avatarUrl} alt="" className="gm-avatar" />
                )}
                <div>
                  <div className="gm-time">بڵاو دەکرێتەوە لە</div>
                  <div className="gm-who">{tt.nickname ?? "ئەکاونتی تیکتۆک"}</div>
                </div>
              </div>

              <p className="gm-sec">کێ ڤیدیۆکە ببینێت</p>
              <div role="radiogroup" aria-label="کێ ڤیدیۆکە ببینێت">
                {tt.privacyOptions.map((opt) => (
                  <label key={opt} className="gm-radio">
                    <input type="radio" name="tt-privacy" value={opt} checked={privacy === opt} onChange={() => setPrivacy(opt)} />
                    {PRIVACY_LABEL[opt] ?? opt}
                  </label>
                ))}
              </div>
              {!privacy && <p className="gm-hint">یەکێکیان هەڵبژێرە — هیچ هەڵبژاردنێکی پێشوەختە نییە.</p>}

              <p className="gm-sec">ڕێگە بە خەڵک بدە</p>
              {(
                [
                  ["کۆمێنت", allowComment, setAllowComment, tt.commentDisabled],
                  ["Duet", allowDuet, setAllowDuet, tt.duetDisabled],
                  ["Stitch", allowStitch, setAllowStitch, tt.stitchDisabled],
                ] as const
              ).map(([label, value, set, lockedOff]) => (
                <div key={label} className="gm-target">
                  <div>
                    <p>{label}</p>
                    {lockedOff && <small>لە ڕێکخستنی تیکتۆکەکەتدا کوژاوەتەوە</small>}
                  </div>
                  <button
                    type="button"
                    role="switch"
                    className="gm-knob"
                    aria-checked={value && !lockedOff}
                    aria-label={label}
                    disabled={lockedOff}
                    onClick={() => set(!value)}
                  >
                    <i />
                  </button>
                </div>
              ))}

              <p className="gm-sec">ناوەڕۆکی بازرگانی</p>
              <div className="gm-target">
                <div>
                  <p>ئەم ڤیدیۆیە ڕیکلامە</p>
                  <small>ئەگەر ڕیکلام بۆ خۆت، براندێک، بەرهەمێک یان خزمەتگوزارییەک دەکات.</small>
                </div>
                <button
                  type="button"
                  role="switch"
                  className="gm-knob"
                  aria-checked={commercial}
                  aria-label="ناوەڕۆکی بازرگانی"
                  onClick={() => {
                    const v = !commercial;
                    setCommercial(v);
                    if (!v) {
                      setYourBrand(false);
                      setBranded(false);
                    }
                  }}
                >
                  <i />
                </button>
              </div>
              {commercial && (
                <div style={{ paddingInlineStart: 4 }}>
                  <label className="gm-radio" style={{ alignItems: "flex-start" }}>
                    <input type="checkbox" checked={yourBrand} onChange={(e) => setYourBrand(e.target.checked)} />
                    <span>
                      <b>Your brand — براندی خۆت</b>
                      <br />
                      <small className="gm-time">ڕیکلام بۆ خۆت یان کاری خۆت. وەک «Promotional content» نیشان دەدرێت.</small>
                    </span>
                  </label>
                  <label className="gm-radio" style={{ alignItems: "flex-start" }}>
                    <input type="checkbox" checked={branded} onChange={(e) => setBranded(e.target.checked)} />
                    <span>
                      <b>Branded content — ناوەڕۆکی براند</b>
                      <br />
                      <small className="gm-time">هاوبەشی پارەدار لەگەڵ براندێکی تر. وەک «Paid partnership» نیشان دەدرێت.</small>
                    </span>
                  </label>
                </div>
              )}

              <p className="gm-hint" style={{ marginTop: 12 }}>
                بە بڵاوکردنەوە، ڕازیت بە{" "}
                {branded && (
                  <>
                    <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer" className="gm-link">
                      Branded Content Policy
                    </a>{" "}
                    و{" "}
                  </>
                )}
                <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer" className="gm-link">
                  Music Usage Confirmation
                </a>
                ـی تیکتۆک.
              </p>
            </>
          )}
        </div>
      )}

      {/* publish */}
      {blockers.length > 0 && targets.length > 0 && (
        <ul className="gm-hint" style={{ margin: "14px 0 0", paddingInlineStart: 18 }}>
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {publishError && <p className="gm-err">{friendlyError(publishError)}</p>}
      <button type="button" className="gm-btn block" style={{ marginTop: 14 }} onClick={publish} disabled={blockers.length > 0 || publishing}>
        {publishing ? "بڵاو دەکرێتەوە…" : `بڵاوی بکەرەوە${targets.length ? ` — ${targets.map((t) => PLATFORM_NAME[t]).join("، ")}` : ""}`}
      </button>
      {publishing && on.IG && isVideo && <p className="gm-hint">ڤیدیۆی ئینستاگرام تا یەک خولەک دەخایەنێت.</p>}
    </div>
  );
}
