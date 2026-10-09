"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { ImagePlus, Sparkles, X } from "lucide-react";

import { CAPTION_LIMITS, CITY_TAGS, captionProblems, mergeHashtags, YT_DESCRIPTION_MAX, YT_PRIVACY, YT_TITLE_MAX, youtubeOptionProblems, youtubeTitle, type Target, type YtPrivacy } from "@/lib/merchant/caption";
import type { PublishOutcome } from "@/lib/merchant/publish-core";
import { tiktokProblems } from "@/lib/merchant/tiktok-rules";
import { useT } from "@/lib/i18n/client";
import { useBase } from "../use-base";
import { publishAction, suggestCaptionAction, tiktokContextAction, tiktokStatusAction, type TikTokContext } from "../actions";
import { friendlyError, kuDateTime } from "../format";
import { browserStore, clearDraft, readDraft, writeDraft } from "./draft";
import { cancelScheduledAction, listScheduled, schedulePublishAction, type ScheduledRow } from "./schedule-actions";
import { imageToJpeg } from "./to-jpeg";

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
  accountLists,
  products,
  initial,
  scheduled: initialScheduled,
}: {
  workspaceId: string;
  accounts: Record<Target, string | null>;
  /** Every connected account per platform; with more than one the person picks which. */
  accountLists: Record<Target, { id: string; name: string; avatarUrl: string | null }[]>;
  products: { id: string; name: string }[];
  /** A news draft to post; `targets`, when given, are the only platforms switched on (e.g. TikTok from the videos list). */
  initial?: { newsDraftId: string; caption: string; media: Media; targets?: Target[] };
  scheduled: ScheduledRow[];
}) {
  const router = useRouter();
  const base = useBase();
  const t = useT();
  const isNewsroom = base === "/newsroom";

  // media
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ src: string; type: "IMAGE" | "VIDEO" } | null>(
    initial ? { src: initial.media.url, type: initial.media.type } : null,
  );
  const [media, setMedia] = useState<Media | null>(initial?.media ?? null);
  const [progress, setProgress] = useState<number | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  // news draft — dropped the moment the post stops being that draft's post
  const [newsDraftId, setNewsDraftId] = useState<string | null>(initial?.newsDraftId ?? null);

  // caption
  const [caption, setCaption] = useState(initial?.caption ?? "");
  const [suggesting, startSuggest] = useTransition();
  const [captionError, setCaptionError] = useState<string | null>(null);

  // shop product card — price questions on the published post get this product's card
  const [productId, setProductId] = useState("");

  // targets
  const [on, setOn] = useState<Record<Target, boolean>>(
    initial?.targets?.length
      ? { FB: false, IG: false, TT: false, YT: false, ...Object.fromEntries(initial.targets.filter((k) => !!accounts[k]).map((k) => [k, true])) }
      : { FB: !!accounts.FB, IG: !!initial && !!accounts.IG, TT: false, YT: false },
  );

  // tiktok
  // Which accounts each platform posts to, when there are several (the first, oldest, by default).
  const [sel, setSel] = useState<Record<Target, string[]>>(() => ({
    FB: accountLists.FB.slice(0, 1).map((a) => a.id),
    IG: accountLists.IG.slice(0, 1).map((a) => a.id),
    TT: accountLists.TT.slice(0, 1).map((a) => a.id),
    YT: accountLists.YT.slice(0, 1).map((a) => a.id),
  }));
  const multi = (tg: Target) => accountLists[tg].length > 1;
  const chosenAccounts = (): Partial<Record<Target, string[]>> | undefined => {
    const out: Partial<Record<Target, string[]>> = {};
    for (const tg of ["FB", "IG", "TT", "YT"] as Target[]) if (on[tg] && multi(tg)) out[tg] = sel[tg];
    return Object.keys(out).length ? out : undefined;
  };
  const toggleAccount = (tg: Target, id: string) =>
    setSel((s) => {
      // TikTok posts to one account at a time (its rules show one creator's settings).
      if (tg === "TT") return { ...s, TT: [id] };
      const has = s[tg].includes(id);
      return { ...s, [tg]: has ? s[tg].filter((x) => x !== id) : [...s[tg], id] };
    });
  const [tt, setTt] = useState<TikTokContext | null>(null);
  const [ttError, setTtError] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState<string | null>(null);
  const [allowComment, setAllowComment] = useState(false);
  const [allowDuet, setAllowDuet] = useState(false);
  const [allowStitch, setAllowStitch] = useState(false);
  const [commercial, setCommercial] = useState(false);
  const [yourBrand, setYourBrand] = useState(false);
  const [branded, setBranded] = useState(false);
  // youtube — title and description follow the caption until the person edits them; privacy has no default
  const [ytTitle, setYtTitle] = useState<string | null>(null);
  const [ytDescription, setYtDescription] = useState<string | null>(null);
  const [ytPrivacy, setYtPrivacy] = useState<YtPrivacy | null>(null);

  // publish
  const [publishing, startPublish] = useTransition();
  const [results, setResults] = useState<PublishOutcome[] | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [ttStatus, setTtStatus] = useState<string | null>(null);

  // scheduling — Facebook and Instagram only; TikTok is always posted live
  const [mode, setMode] = useState<"now" | "later">("now");
  const [runAtLocal, setRunAtLocal] = useState("");
  const [scheduled, setScheduled] = useState<ScheduledRow[]>(initialScheduled);
  const [scheduledMsg, setScheduledMsg] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelling, startCancel] = useTransition();
  const later = mode === "later";

  // draft — the work survives leaving the page (./draft.ts); restored once on arrival, then kept as it changes
  const [draftReady, setDraftReady] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);

  const targets = (Object.keys(on) as Target[]).filter((t) => on[t]);
  const isVideo = media?.type === "VIDEO";
  const uploading = progress !== null && !media;

  // Bring back this workspace's unpublished draft, unless the page opened with a news draft of its own.
  useEffect(() => {
    const d = initial ? null : readDraft(browserStore(), workspaceId);
    if (d) {
      setCaption(d.caption);
      if (d.media) {
        setMedia(d.media);
        setPreview({ src: d.media.url, type: d.media.type });
        setProgress(100);
      }
      setOn({
        FB: d.targets.includes("FB") && !!accounts.FB,
        IG: d.targets.includes("IG") && !!accounts.IG && !!d.media,
        TT: d.targets.includes("TT") && !!accounts.TT && !!d.media && d.mode === "now",
        YT: d.targets.includes("YT") && !!accounts.YT && d.media?.type === "VIDEO",
      });
      setProductId(products.some((p) => p.id === d.productId) ? d.productId : "");
      setMode(d.mode);
      setRunAtLocal(d.runAtLocal);
      setDraftRestored(true);
    }
    setDraftReady(true);
    // Once, on arrival: what changes afterwards is saved by the effect below, never restored over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the work as it changes. A news draft's post is not kept: its card belongs to that draft.
  useEffect(() => {
    if (!draftReady || newsDraftId) return;
    writeDraft(browserStore(), workspaceId, {
      caption,
      media,
      targets: (Object.keys(on) as Target[]).filter((k) => on[k]),
      productId,
      mode,
      runAtLocal,
      savedAt: Date.now(),
    });
  }, [draftReady, newsDraftId, workspaceId, caption, media, on, productId, mode, runAtLocal]);

  // Instagram and TikTok need media (photo or video); YouTube needs a video. Switch them off when that stops being true.
  useEffect(() => {
    setOn((o) => ({ ...o, IG: o.IG && !!media, TT: o.TT && !!media, YT: o.YT && isVideo }));
  }, [media, isVideo]);

  // TikTok is never scheduled: scheduled mode switches it off, and a finished upload cannot switch it back on.
  useEffect(() => {
    if (later && on.TT) setOn((o) => ({ ...o, TT: false }));
  }, [later, on.TT]);

  // Load TikTok's creator_info the moment TikTok is switched on — its privacy
  // options and interaction switches must come from TikTok, not from us.
  useEffect(() => {
    if (!on.TT || tt) return;
    let cancelled = false;
    setTtError(null);
    tiktokContextAction(multi("TT") ? sel.TT[0] : undefined).then((r) => {
      if (cancelled) return;
      if (r.ok) setTt(r.ctx);
      else setTtError(friendlyError(r.error, t));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on.TT, tt, t, sel.TT[0]]);

  // The composer stops being "this news draft's post" the moment its media
  // changes — its card belonged to that exact image.
  function dropNewsDraft() {
    if (!newsDraftId) return;
    setNewsDraftId(null);
    router.replace(`${base}/publish`);
  }

  async function pickFile(file: File) {
    setMediaError(null);
    setResults(null);
    if (!ACCEPT.split(",").includes(file.type)) {
      setMediaError(t.publish.badType);
      return;
    }
    if (file.size > MAX_BYTES) {
      setMediaError(t.publish.tooBig);
      return;
    }
    dropNewsDraft();
    const type = file.type.startsWith("video/") ? "VIDEO" : "IMAGE";
    if (preview) URL.revokeObjectURL(preview.src);
    setPreview({ src: URL.createObjectURL(file), type });
    setMedia(null);
    setProgress(0);
    try {
      const durationSec = type === "VIDEO" ? await readDuration(file) : undefined;
      // Instagram accepts only JPEG, and TikTok's photo posts accept JPEG/WebP — convert everything else.
      const upFile = type === "IMAGE" && file.type !== "image/jpeg" ? await imageToJpeg(file, t.publish) : file;
      const ext = type === "IMAGE" ? "jpg" : (file.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "");
      const blob = await upload(`merchant/${workspaceId}/${Date.now()}.${ext}`, upFile, {
        access: "public",
        handleUploadUrl: "/api/app/upload",
        contentType: upFile.type,
        onUploadProgress: ({ percentage }) => setProgress(Math.round(percentage)),
      });
      setMedia({ url: blob.url, pathname: blob.pathname, type, durationSec });
      setProgress(100);
      setOn((o) => ({ ...o, IG: !!accounts.IG, TT: !!accounts.TT }));
    } catch (e) {
      setProgress(null);
      setPreview(null);
      setMediaError(t.publish.uploadFailed(e instanceof Error ? e.message : t.common.error));
    }
  }

  function clearMedia() {
    if (preview) URL.revokeObjectURL(preview.src);
    setPreview(null);
    setMedia(null);
    setProgress(null);
    if (fileInput.current) fileInput.current.value = "";
    dropNewsDraft();
  }

  function suggest() {
    setCaptionError(null);
    startSuggest(async () => {
      const r = await suggestCaptionAction(caption);
      if (r.ok) setCaption(r.caption);
      else setCaptionError(friendlyError(r.error, t));
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

  const youtube = { title: ytTitle ?? youtubeTitle(caption), description: ytDescription ?? caption, privacy: ytPrivacy };
  const ytIssues = on.YT ? youtubeOptionProblems(youtube) : [];
  const blockers: string[] = [];
  if (!targets.length) blockers.push(t.publish.blockPickTarget);
  if (!caption.trim() && !media) blockers.push(t.publish.blockNeedContent);
  if (uploading) blockers.push(t.publish.blockUploading);
  if (captionIssues.length) blockers.push(t.publish.blockCaptionLong);
  if ((["FB", "IG", "TT", "YT"] as Target[]).some((tg) => on[tg] && multi(tg) && !sel[tg].length)) blockers.push(t.publish.blockPickAccount);
  if (on.YT && !isVideo) blockers.push(t.publish.ytVideoOnly);
  if (ytIssues.includes("title") || ytIssues.includes("description")) blockers.push(t.publish.blockYtTitle);
  if (ytIssues.includes("brackets")) blockers.push(t.publish.blockYtBrackets);
  if (ytIssues.includes("privacy")) blockers.push(t.publish.blockYtPrivacy);
  if (on.TT && !tt) blockers.push(t.publish.blockTtInfo);
  if (on.TT && ttIssues.includes("privacy"))
    blockers.push(isVideo ? t.publish.blockTtPrivacyVideo : t.publish.blockTtPrivacyPost);
  if (on.TT && ttIssues.includes("commercial")) blockers.push(t.publish.blockTtCommercial);
  if (on.TT && ttIssues.includes("branded-private")) blockers.push(t.publish.blockTtBranded);
  if (on.TT && ttIssues.includes("duration")) blockers.push(t.publish.blockTtDuration);
  if (later && !runAtLocal) blockers.push(t.publish.blockPickTime);

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
        accounts: chosenAccounts(),
        youtube: on.YT ? youtube : undefined,
        newsDraftId: newsDraftId ?? undefined,
        productId: productId || undefined,
      });
      if (!r.ok) {
        setPublishError(r.error);
        return;
      }
      setResults(r.results);
      // Out on at least one platform: the draft is done. If everything failed it stays, to try again.
      if (r.results.some((x) => x.ok)) clearDraft(browserStore(), workspaceId);
      const ttResult = r.results.find((x) => x.target === "TT" && x.ok && x.publishId);
      if (ttResult?.publishId) pollTikTok(ttResult.publishId, ttResult.accountId);
    });
  }

  function schedule() {
    setPublishError(null);
    setScheduledMsg(null);
    startPublish(async () => {
      const r = await schedulePublishAction(
        { caption, targets, media: media ?? undefined, newsDraftId: newsDraftId ?? undefined, productId: productId || undefined, youtube: on.YT ? youtube : undefined, accounts: chosenAccounts() },
        runAtLocal,
      );
      if (!r.ok) {
        setPublishError(r.error);
        return;
      }
      reset();
      setRunAtLocal("");
      clearDraft(browserStore(), workspaceId);
      setScheduledMsg(t.publish.scheduledMsg(kuDateTime(r.runAt, t)));
      setScheduled(await listScheduled());
    });
  }

  function cancelScheduled(id: string) {
    setCancelError(null);
    startCancel(async () => {
      const r = await cancelScheduledAction(id);
      if (!r.ok) setCancelError(r.error);
      setScheduled(await listScheduled());
    });
  }

  function chooseMode(m: "now" | "later") {
    setMode(m);
    setPublishError(null);
    setScheduledMsg(null);
  }

  function pollTikTok(publishId: string, accountId?: string, attempt = 0) {
    setTtStatus("PROCESSING");
    tiktokStatusAction(publishId, accountId).then((s) => {
      if (!s.ok) return setTtStatus(`ERROR:${s.error}`);
      if (s.status === "PUBLISH_COMPLETE") return setTtStatus("PUBLISH_COMPLETE");
      if (s.status === "FAILED") return setTtStatus(`ERROR:${s.failReason ?? "failed"}`);
      if (attempt < 24) setTimeout(() => pollTikTok(publishId, accountId, attempt + 1), 5000);
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
    setProductId("");
    setYtTitle(null);
    setYtDescription(null);
    setYtPrivacy(null);
  }

  function discardDraft() {
    reset();
    setOn({ FB: !!accounts.FB, IG: false, TT: false, YT: false });
    setMode("now");
    setRunAtLocal("");
    clearDraft(browserStore(), workspaceId);
    setDraftRestored(false);
  }

  if (results) {
    return (
      <div className="gm-narrow">
        <h2 className="gm-title kufi">{t.publish.resultsTitle}</h2>
        <div className="gm-card" style={{ marginTop: 12 }}>
          {results.map((r) => (
            <div key={`${r.target}-${r.accountId ?? ""}`} className="gm-target">
              <div>
                <p>
                  {t.platform[r.target]}
                  {r.accountName && <small dir="auto"> · {r.accountName}</small>}
                </p>
                {r.ok ? (
                  <small>
                    {r.target === "TT"
                      ? ttStatus === "PUBLISH_COMPLETE"
                        ? t.publish.ttPosted
                        : ttStatus?.startsWith("ERROR:")
                          ? t.publish.ttRejected(friendlyError(ttStatus.slice(6), t))
                          : ttStatus === "SLOW"
                            ? isVideo
                              ? t.publish.ttSlowVideo
                              : t.publish.ttSlowPost
                            : isVideo
                              ? t.publish.ttBusyVideo
                              : t.publish.ttBusyPost
                      : t.publish.posted}
                  </small>
                ) : (
                  <small className="gm-err" style={{ margin: 0 }}>{friendlyError(r.error, t)}</small>
                )}
              </div>
              {r.ok && r.url ? (
                <a href={r.url} target="_blank" rel="noreferrer" className="gm-btn quiet small">{t.common.view}</a>
              ) : (
                <span className={`gm-badge ${r.ok ? "" : "warn"}`}>{r.ok ? t.publish.succeeded : t.publish.failed}</span>
              )}
            </div>
          ))}
        </div>
        <button type="button" className="gm-btn block" style={{ marginTop: 14 }} onClick={reset}>
          {t.publish.newPost}
        </button>
      </div>
    );
  }

  return (
    <div className="gm-narrow">
      <h2 className="gm-title kufi">{t.publish.title}</h2>
      <p className="gm-sub">{t.publish.sub}</p>
      {isNewsroom && !newsDraftId && !media && (
        <p className="gm-note">
          {t.publish.newsHintPre}{" "}
          <Link href="/newsroom/news" className="gm-link">{t.publish.newsHintLink}</Link>{" "}
          {t.publish.newsHintPost}
        </p>
      )}
      {draftRestored && (caption.trim() || media) && (
        <p className="gm-note">
          {t.publish.draftRestored}{" "}
          <button type="button" className="gm-link gm-linkbtn" onClick={discardDraft}>
            {t.publish.discardDraft}
          </button>
        </p>
      )}

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
            <div className="gm-progress" aria-label={t.publish.uploadAria}>
              <i style={{ width: `${progress}%` }} />
            </div>
          )}
          <div className="gm-between" style={{ marginTop: 10 }}>
            <span className="gm-time">
              {media ? (isVideo && media.durationSec ? t.publish.videoSecs(Math.round(media.durationSec)) : t.publish.ready) : t.publish.uploading(progress ?? 0)}
            </span>
            <button type="button" className="gm-btn quiet small" onClick={clearMedia} disabled={uploading}>
              <X size={14} aria-hidden="true" /> {t.publish.remove}
            </button>
          </div>
        </div>
      ) : (
        <label className="gm-drop" htmlFor="gm-media">
          <ImagePlus size={26} aria-hidden="true" />
          <b>{t.publish.dropTitle}</b>
          {t.publish.dropHint}
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
      <p className="gm-sec">{t.publish.captionSec}</p>
      <textarea
        id="gm-caption"
        className="gm-textarea"
        rows={5}
        dir="auto"
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        placeholder={
          isNewsroom ? t.publish.captionPlaceholderNews : t.publish.captionPlaceholderShop
        }
        aria-label={t.publish.captionAria}
      />
      <div className="gm-between" style={{ marginTop: 8, flexWrap: "wrap" }}>
        <div className="gm-row" style={{ gap: 6, flexWrap: "wrap" }}>
          {/* Both are shop tools: the product-caption writer and the shops' city hashtags. */}
          {!newsDraftId && !isNewsroom && (
            <button type="button" className="gm-btn quiet small" onClick={suggest} disabled={suggesting}>
              <Sparkles size={14} aria-hidden="true" />
              {suggesting ? t.common.writing : t.publish.writeForMe}
            </button>
          )}
          {!isNewsroom && (
            <button type="button" className="gm-btn quiet small" onClick={() => setCaption((c) => mergeHashtags(c, CITY_TAGS))}>
              {t.publish.cityTags}
            </button>
          )}
        </div>
        <span className={`gm-time ${captionIssues.length ? "gm-err" : ""}`} style={{ margin: 0 }}>
          {t.fmt.num([...caption].length)} / {t.fmt.num(limit)}
        </span>
      </div>
      {captionError && <p className="gm-err">{captionError}</p>}

      {/* product card */}
      {products.length > 0 && (
        <div className="gm-field" style={{ marginTop: 14 }}>
          <label htmlFor="gm-product">{t.publish.productLabel}</label>
          <select id="gm-product" className="gm-input" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">{t.publish.noProduct}</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="gm-hint">{t.publish.productHint}</p>
        </div>
      )}

      {/* targets */}
      <p className="gm-sec">{t.publish.whereSec}</p>
      <div className="gm-card">
        {(["FB", "IG", "TT", "YT"] as Target[]).map((tg) => {
          const account = accounts[tg];
          const needsMedia = tg === "YT" ? !isVideo : (tg === "IG" || tg === "TT") && !media;
          const disabled = !account || needsMedia || (later && tg === "TT");
          return (
            <Fragment key={tg}>
            <div className="gm-target">
              <div>
                <p>{t.platform[tg]}</p>
                <small>
                  {later && tg === "TT" ? (
                    t.publish.ttLiveOnly
                  ) : !account ? (
                    <Link href={`${base}/settings`} className="gm-link">{t.publish.notConnected}</Link>
                  ) : needsMedia && tg === "YT" && media ? (
                    // A photo is attached: YouTube will not take it.
                    <>{account} · {t.publish.ytVideoOnly}</>
                  ) : needsMedia ? (
                    // Connected, but Instagram and TikTok can'tg post text alone: say
                    // which account it is and offer the missing step right here.
                    <>
                      {account} ·{" "}
                      <button type="button" className="gm-link gm-linkbtn" onClick={() => fileInput.current?.click()}>
                        {tg === "YT" ? t.publish.addVideoFirst : t.publish.addMediaFirst}
                      </button>
                    </>
                  ) : (
                    account
                  )}
                </small>
              </div>
              <button
                type="button"
                role="switch"
                className="gm-knob"
                aria-checked={on[tg] && !disabled}
                aria-label={t.platform[tg]}
                disabled={disabled}
                onClick={() => setOn((o) => ({ ...o, [tg]: !o[tg] }))}
              >
                <i />
              </button>
            </div>
            {on[tg] && multi(tg) && (
              <div className="gm-stack" style={{ gap: 2, paddingInlineStart: 14, marginBottom: 8 }}>
                <small className="gm-hint" style={{ margin: 0 }}>{tg === "TT" ? t.publish.pickOneAccount : t.publish.pickAccounts}</small>
                {accountLists[tg].map((a) => (
                  <label key={a.id} className="gm-radio" style={{ padding: "4px 0" }}>
                    <input
                      type={tg === "TT" ? "radio" : "checkbox"}
                      name={`acc-${tg}`}
                      checked={sel[tg].includes(a.id)}
                      onChange={() => {
                        toggleAccount(tg, a.id);
                        if (tg === "TT") setTt(null);
                      }}
                    />
                    <span dir="auto">{a.name}</span>
                  </label>
                ))}
              </div>
            )}
            {tg === "YT" && <p className="gm-hint">{t.publish.ytPrivate}</p>}
            </Fragment>
          );
        })}
      </div>

      {/* youtube — the person sets title, description and privacy for every upload */}
      {on.YT && (
        <div className="gm-tt">
          <p className="gm-sec" style={{ marginTop: 0 }}>{t.publish.ytSec}</p>
          <div className="gm-field">
            <label htmlFor="yt-title">{t.publish.ytTitle}</label>
            <input
              id="yt-title"
              className="gm-input"
              dir="auto"
              maxLength={YT_TITLE_MAX}
              value={youtube.title}
              onChange={(e) => setYtTitle(e.target.value)}
            />
            <small className="gm-hint">
              {Array.from(youtube.title).length} / {YT_TITLE_MAX}
            </small>
          </div>
          <div className="gm-field">
            <label htmlFor="yt-description">{t.publish.ytDescription}</label>
            <textarea
              id="yt-description"
              className="gm-textarea"
              dir="auto"
              rows={4}
              maxLength={YT_DESCRIPTION_MAX}
              value={youtube.description}
              onChange={(e) => setYtDescription(e.target.value)}
            />
            {ytTitle === null && ytDescription === null && <small className="gm-hint">{t.publish.ytFromCaption}</small>}
          </div>
          <div role="radiogroup" aria-label={t.publish.ytPrivacy}>
            <p className="gm-sub" style={{ margin: "4px 0 0", fontWeight: 600 }}>{t.publish.ytPrivacy}</p>
            {YT_PRIVACY.map((p) => (
              <label key={p} className="gm-radio">
                <input type="radio" name="yt-privacy" value={p} checked={ytPrivacy === p} onChange={() => setYtPrivacy(p)} />
                <span>{t.publish.ytPrivacyOptions[p]}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* tiktok — the audited elements, all of them */}
      {on.TT && (
        <div className="gm-tt">
          {ttError && <p className="gm-err" style={{ marginTop: 0 }}>{ttError}</p>}
          {!tt && !ttError && <p className="gm-sub" style={{ margin: 0 }}>{t.publish.ttLoading}</p>}
          {tt && (
            <>
              <div className="gm-row">
                {tt.avatarUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={tt.avatarUrl} alt="" className="gm-avatar" />
                )}
                <div>
                  <div className="gm-time">{t.publish.ttPostingTo}</div>
                  <div className="gm-who">{tt.nickname ?? t.publish.ttAccount}</div>
                </div>
              </div>

              <p className="gm-sec">{isVideo ? t.publish.ttWhoVideo : t.publish.ttWhoPost}</p>
              <div role="radiogroup" aria-label={isVideo ? t.publish.ttWhoVideo : t.publish.ttWhoPost}>
                {tt.privacyOptions.map((opt) => (
                  <label key={opt} className="gm-radio">
                    <input type="radio" name="tt-privacy" value={opt} checked={privacy === opt} onChange={() => setPrivacy(opt)} />
                    {(t.privacy as Record<string, string>)[opt] ?? opt}
                  </label>
                ))}
              </div>
              {!privacy && <p className="gm-hint">{t.publish.ttPickOne}</p>}

              <p className="gm-sec">{t.publish.ttAllow}</p>
              {(
                [
                  [t.publish.ttComment, allowComment, setAllowComment, tt.commentDisabled],
                  ["Duet", allowDuet, setAllowDuet, tt.duetDisabled],
                  ["Stitch", allowStitch, setAllowStitch, tt.stitchDisabled],
                ] as const
              )
                // Duet and Stitch exist only for videos; a photo post offers comments alone.
                .filter(([, , set]) => isVideo || set === setAllowComment)
                .map(([label, value, set, lockedOff]) => (
                <div key={label} className="gm-target">
                  <div>
                    <p>{label}</p>
                    {lockedOff && <small>{t.publish.ttDisabled}</small>}
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

              <p className="gm-sec">{t.publish.ttCommercialSec}</p>
              <div className="gm-target">
                <div>
                  <p>{isVideo ? t.publish.ttAdVideo : t.publish.ttAdPost}</p>
                  <small>{t.publish.ttAdHint}</small>
                </div>
                <button
                  type="button"
                  role="switch"
                  className="gm-knob"
                  aria-checked={commercial}
                  aria-label={t.publish.ttCommercialSec}
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
                      <b>{t.publish.ttYourBrand}</b>
                      <br />
                      <small className="gm-time">{t.publish.ttYourBrandHint}</small>
                    </span>
                  </label>
                  <label className="gm-radio" style={{ alignItems: "flex-start" }}>
                    <input type="checkbox" checked={branded} onChange={(e) => setBranded(e.target.checked)} />
                    <span>
                      <b>{t.publish.ttBranded}</b>
                      <br />
                      <small className="gm-time">{t.publish.ttBrandedHint}</small>
                    </span>
                  </label>
                </div>
              )}

              <p className="gm-hint" style={{ marginTop: 12 }}>
                {t.publish.ttConsentPre}{" "}
                {branded && (
                  <>
                    <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer" className="gm-link">
                      Branded Content Policy
                    </a>{" "}
                    {t.publish.ttAnd}{" "}
                  </>
                )}
                <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer" className="gm-link">
                  Music Usage Confirmation
                </a>
                {t.publish.ttConsentPost}
              </p>
            </>
          )}
        </div>
      )}

      {/* when */}
      <div className="gm-card" style={{ marginTop: 14 }}>
        <div className="gm-target">
          <p>{t.publish.whenSec}</p>
          <div className="gm-chips" role="group" aria-label={t.publish.whenSec}>
            <button type="button" className="gm-chip" aria-pressed={!later} onClick={() => chooseMode("now")}>
              {t.publish.now}
            </button>
            <button type="button" className="gm-chip" aria-pressed={later} onClick={() => chooseMode("later")}>
              {t.publish.later}
            </button>
          </div>
        </div>
        {later && (
          <div className="gm-field" style={{ marginTop: 4 }}>
            <label htmlFor="gm-runat">{t.publish.runAt}</label>
            <input id="gm-runat" type="datetime-local" className="gm-input" value={runAtLocal} onChange={(e) => setRunAtLocal(e.target.value)} />
          </div>
        )}
      </div>

      {/* publish */}
      {blockers.length > 0 && targets.length > 0 && (
        <ul className="gm-hint" style={{ margin: "14px 0 0", paddingInlineStart: 18 }}>
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {publishError && <p className="gm-err">{friendlyError(publishError, t)}</p>}
      {scheduledMsg && <p className="gm-ok">{scheduledMsg}</p>}
      <button type="button" className="gm-btn block" style={{ marginTop: 14 }} onClick={later ? schedule : publish} disabled={blockers.length > 0 || publishing}>
        {later
          ? publishing
            ? t.publish.scheduling
            : t.publish.schedule
          : publishing
            ? t.publish.publishing
            : targets.length
              ? t.publish.publishTo(targets.map((x) => t.platform[x]).join(t.fmt.listSep))
              : t.publish.publishBtn}
      </button>
      {publishing && !later && on.IG && isVideo && <p className="gm-hint">{t.publish.igVideoWait}</p>}

      {/* scheduled posts */}
      {scheduled.length > 0 && (
        <>
          <p className="gm-sec">{t.publish.scheduledSec}</p>
          <div className="gm-card">
            {scheduled.map((p) => (
              <div key={p.id} className="gm-target" style={{ alignItems: "flex-start" }}>
                <div>
                  <p dir="auto">{p.caption || "—"}</p>
                  <small>
                    {kuDateTime(p.runAt, t)} · {p.targets.map((x) => t.platform[x]).join(t.fmt.listSep)}
                  </small>
                  {p.status === "FAILED" && p.lastError && (
                    <small className="gm-err" style={{ display: "block", margin: 0 }}>{friendlyError(p.lastError, t)}</small>
                  )}
                </div>
                {p.status === "PENDING" ? (
                  <button type="button" className="gm-btn quiet small" onClick={() => cancelScheduled(p.id)} disabled={cancelling}>
                    {t.publish.cancel}
                  </button>
                ) : (
                  <span className={`gm-badge ${p.status === "FAILED" ? "warn" : ""}`}>{p.status === "FAILED" ? t.publish.failed : t.publish.sendingNow}</span>
                )}
              </div>
            ))}
          </div>
          {cancelError && <p className="gm-err">{cancelError}</p>}
        </>
      )}
    </div>
  );
}
