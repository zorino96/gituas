"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { postToTikTok } from "./actions";

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
  const canPost = !!privacy && !brandedPrivateClash && !commercialUnchosen && !pending && !done;

  function submit() {
    setError(null);
    start(async () => {
      const r = await postToTikTok(contentPostId, {
        privacyLevel: privacy,
        disableComment: !allowComment,
        disableDuet: !allowDuet,
        disableStitch: !allowStitch,
        brandOrganicToggle: isCommercial && yourBrand,
        brandContentToggle: isCommercial && brandedContent,
      });
      if (r.ok) {
        setDone(true);
        router.refresh();
      } else {
        setError(r.error ?? "Posting failed.");
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

      {/* Preview — so the creator knows exactly what is going out. */}
      <section className="rounded-xl border border-line bg-panel p-5 space-y-4">
        <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">preview</div>
        <video
          src={videoUrl}
          controls
          playsInline
          className="w-full max-w-[240px] rounded-lg border border-line bg-black"
        />
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{caption}</p>
        {maxDurationSec ? (
          <p className="font-mono text-xs text-fg-dim">
            this account may post videos up to {maxDurationSec}s
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
              <p className="font-mono text-xs text-red-400">
                pick at least one: your brand, or branded content
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
        <p className="font-mono text-xs text-money">
          sent to tiktok — it appears in the account once tiktok finishes processing.
        </p>
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
