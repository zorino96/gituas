"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { checkTikTokPostStatus, postToTikTok } from "./actions";

// TikTok returns these as raw enum values; these are the labels TikTok's own
// app uses, so the creator recognises what they are choosing.
const PRIVACY_LABELS: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends (mutual followers)",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};

interface Props {
  contentPostId: string;
  caption: string;
  videoUrl: string;
  creator: { nickname?: string; username?: string; avatarUrl?: string };
  privacyOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxDurationSec?: number;
}

export function TikTokPostForm({
  contentPostId,
  caption,
  videoUrl,
  creator,
  privacyOptions,
  commentDisabled,
  duetDisabled,
  stitchDisabled,
  maxDurationSec,
}: Props) {
  // The caption Gituas drafted is only a starting point — the guidelines
  // require preset text and hashtags to be editable before publishing, so this
  // is the value that actually gets posted.
  const [title, setTitle] = useState(caption);
  // Measured off the real file once the browser has the metadata, so the
  // creator's max_video_post_duration_sec can be enforced before we call TikTok.
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // Deliberately empty: TikTok requires the privacy level to start unselected,
  // so the creator makes an actual choice rather than accepting our default.
  const [privacy, setPrivacy] = useState("");
  // Same reason — every interaction toggle starts off.
  const [allowComment, setAllowComment] = useState(false);
  const [allowDuet, setAllowDuet] = useState(false);
  const [allowStitch, setAllowStitch] = useState(false);
  const [isCommercial, setIsCommercial] = useState(false);
  const [yourBrand, setYourBrand] = useState(false);
  const [brandedContent, setBrandedContent] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  // TikTok's rule, enforced in the UI as well as on the server: branded content
  // may not be posted privately.
  const brandedPrivateClash = brandedContent && privacy === "SELF_ONLY";
  const commercialUnchosen = isCommercial && !yourBrand && !brandedContent;
  const tooLong =
    maxDurationSec != null && durationSec != null && durationSec > maxDurationSec;
  const canPost =
    !!privacy &&
    !!title.trim() &&
    !brandedPrivateClash &&
    !commercialUnchosen &&
    !tooLong &&
    !pending &&
    !done;

  function submit() {
    setError(null);
    start(async () => {
      const r = await postToTikTok(
        contentPostId,
        {
          privacyLevel: privacy,
          disableComment: !allowComment,
          disableDuet: !allowDuet,
          disableStitch: !allowStitch,
          brandOrganicToggle: isCommercial && yourBrand,
          brandContentToggle: isCommercial && brandedContent,
        },
        { title, durationSec: durationSec ?? undefined },
      );
      if (!r.ok) {
        setError(r.error ?? "Posting failed.");
        return;
      }
      setDone(true);
      router.refresh();
      // Publishing is asynchronous — keep asking TikTok until it settles, so
      // the creator sees whether it actually went up rather than just "sent".
      if (r.publishId) {
        for (let i = 0; i < 10; i++) {
          await new Promise((res) => setTimeout(res, 3000));
          const s = await checkTikTokPostStatus(contentPostId, r.publishId);
          if (s.status) setStatus(s.failReason ? `${s.status} — ${s.failReason}` : s.status);
          if (s.error || (s.status && s.status !== "PROCESSING_UPLOAD" && s.status !== "PROCESSING_DOWNLOAD")) break;
        }
      }
    });
  }

  const label = creator.nickname || creator.username || "your TikTok account";

  return (
    <div className="space-y-5">
      {/* Which account — TikTok requires the creator to see this before posting. */}
      <section className="rounded-xl border border-line bg-panel p-5">
        <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim mb-3">
          posting to
        </div>
        <div className="flex items-center gap-3">
          {creator.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={creator.avatarUrl}
              alt=""
              className="h-11 w-11 rounded-full object-cover border border-line"
            />
          ) : (
            <div className="h-11 w-11 rounded-full bg-line" />
          )}
          <div>
            <div className="font-mono text-sm">{label}</div>
            {creator.username && creator.username !== creator.nickname && (
              <div className="font-mono text-xs text-fg-dim">@{creator.username}</div>
            )}
          </div>
        </div>
      </section>

      {/* Preview — so the creator knows exactly what is going out.
          preload="metadata" matters: without it the player renders an empty box
          until someone presses play, which is not a preview of anything. */}
      <section className="rounded-xl border border-line bg-panel p-5 space-y-4">
        <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">preview</div>
        <video
          src={`${videoUrl}#t=0.1`}
          controls
          playsInline
          muted
          preload="metadata"
          onLoadedMetadata={(e) => setDurationSec(e.currentTarget.duration)}
          className="w-full max-w-[240px] rounded-lg border border-line bg-black"
        />
        <div className="space-y-2">
          <label className="block font-mono text-[10px] uppercase tracking-wider text-fg-dim">
            caption
          </label>
          {/* Gituas drafts this, but the creator has the last word on it. */}
          <textarea
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 2200))}
            rows={4}
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm leading-relaxed resize-y focus:outline-none focus:border-money"
          />
          <div className="flex items-center justify-between font-mono text-xs text-fg-dim">
            <span>edit the caption and hashtags before posting</span>
            <span>{title.length}/2200</span>
          </div>
          {!title.trim() && (
            <p className="font-mono text-xs text-red-400">a caption is required</p>
          )}
        </div>
        {maxDurationSec ? (
          <p className={`font-mono text-xs ${tooLong ? "text-red-400" : "text-fg-dim"}`}>
            {durationSec != null
              ? `video is ${Math.round(durationSec)}s · this account may post up to ${maxDurationSec}s`
              : `this account may post videos up to ${maxDurationSec}s`}
          </p>
        ) : null}
      </section>

      {/* Privacy — options come from creator_info, nothing pre-selected. */}
      <section className="rounded-xl border border-line bg-panel p-5 space-y-3">
        <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">
          who can see this video
        </div>
        {privacyOptions.length === 0 ? (
          <p className="text-sm text-fg-dim">
            TikTok returned no privacy options for this account.
          </p>
        ) : (
          <div className="space-y-2">
            {privacyOptions.map((opt) => (
              <label key={opt} className="flex items-center gap-3 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="privacy"
                  value={opt}
                  checked={privacy === opt}
                  onChange={() => setPrivacy(opt)}
                  className="accent-money"
                />
                <span>{PRIVACY_LABELS[opt] ?? opt}</span>
              </label>
            ))}
          </div>
        )}
        {!privacy && (
          <p className="font-mono text-xs text-fg-dim">select one to enable posting</p>
        )}
      </section>

      {/* Interaction settings — all off, and greyed out where the creator has
          turned them off in TikTok itself. */}
      <section className="rounded-xl border border-line bg-panel p-5 space-y-3">
        <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">
          allow users to
        </div>
        <Toggle
          label="Comment"
          checked={allowComment}
          disabled={commentDisabled}
          onChange={setAllowComment}
        />
        <Toggle label="Duet" checked={allowDuet} disabled={duetDisabled} onChange={setAllowDuet} />
        <Toggle
          label="Stitch"
          checked={allowStitch}
          disabled={stitchDisabled}
          onChange={setAllowStitch}
        />
      </section>

      {/* Commercial content disclosure. */}
      <section className="rounded-xl border border-line bg-panel p-5 space-y-3">
        <Toggle
          label="Disclose video content"
          checked={isCommercial}
          onChange={(v) => {
            setIsCommercial(v);
            if (!v) {
              setYourBrand(false);
              setBrandedContent(false);
            }
          }}
        />
        <p className="text-xs text-fg-dim leading-relaxed">
          Turn this on if this video promotes yourself, a brand, a product or a service.
        </p>
        {isCommercial && (
          <div className="space-y-2 pt-1">
            <label className="flex items-start gap-3 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={yourBrand}
                onChange={(e) => setYourBrand(e.target.checked)}
                className="mt-1 accent-money"
              />
              <span>
                <span className="block">Your brand</span>
                <span className="block text-xs text-fg-dim">
                  You are promoting yourself or your own business. This video will be labelled as
                  Promotional content.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={brandedContent}
                onChange={(e) => setBrandedContent(e.target.checked)}
                className="mt-1 accent-money"
              />
              <span>
                <span className="block">Branded content</span>
                <span className="block text-xs text-fg-dim">
                  You are in a paid partnership with a brand. This video will be labelled as Paid
                  partnership.
                </span>
              </span>
            </label>
            {commercialUnchosen && (
              // TikTok's own wording for this prompt.
              <p className="font-mono text-xs text-red-400">
                You need to indicate if your content promotes yourself, a third party, or both.
              </p>
            )}
            {brandedPrivateClash && (
              <p className="font-mono text-xs text-red-400">
                branded content cannot be visible to only you — choose another audience
              </p>
            )}
          </div>
        )}
      </section>

      {/* Mandatory declaration — TikTok requires this exact consent line, and
          the branded-content wording when that box is ticked. */}
      <p className="text-xs text-fg-dim leading-relaxed">
        By posting, you agree to{" "}
        {brandedContent ? (
          <>
            <a
              href="https://www.tiktok.com/legal/page/global/bc-policy/en"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-fg"
            >
              TikTok&apos;s Branded Content Policy
            </a>{" "}
            and{" "}
          </>
        ) : null}
        <a
          href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-fg"
        >
          TikTok&apos;s Music Usage Confirmation
        </a>
        .
      </p>

      {error && (
        <p className="font-mono text-xs text-red-400 leading-relaxed">{error}</p>
      )}
      {done && (
        <div className="space-y-1">
          <p className="font-mono text-xs text-money">
            Sent to TikTok. It may take a few minutes for TikTok to process the video before it
            appears on the account.
          </p>
          <p className="font-mono text-xs text-fg-dim">
            {status ? `tiktok status: ${status}` : "checking status with tiktok…"}
          </p>
        </div>
      )}

      <button
        type="button"
        disabled={!canPost}
        onClick={submit}
        className="font-mono text-sm px-5 py-3 rounded-lg bg-money text-bg disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {pending ? "posting…" : done ? "posted" : "post to tiktok"}
      </button>
    </div>
  );
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={`flex items-center justify-between text-sm ${
        disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      <span>
        {label}
        {disabled && (
          <span className="ml-2 font-mono text-xs text-fg-dim">off in tiktok</span>
        )}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-money h-4 w-4"
      />
    </label>
  );
}
