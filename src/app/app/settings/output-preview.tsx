"use client";

// "How it will look": the desk's card and reel as Facebook and Instagram will show them, drawn from the brand as it is
// on the screen. The card is the real card renderer; the post around it (name, avatar, caption, icons) is a stand-in
// for the platform's own screen. The reel is one still of reel/src/Reel.tsx, with the parts the apps cover marked.

import { useState } from "react";

import { useT } from "@/lib/i18n/client";
import { brandFrom, mediaSrc, type FrameText, type LogoCorner } from "@/lib/cards/brand";
import { CARD_H, CARD_W, NewsCard } from "@/lib/cards/templates";
import type { CardKind } from "@/lib/news/types";

export interface PreviewKit {
  logoPath: string | null;
  primary: string;
  accent: string;
  text: string;
  headingFont: "kufi" | "sans";
  framePath: string | null;
  frameText: FrameText;
  logoCorner: LogoCorner;
}

const REEL_W = 1080;
const REEL_H = 1920;
/** The top and bottom of a reel that Instagram's own buttons and captions cover (a guide, not an exact line). */
const REEL_TOP_COVER = 270;
const REEL_BOTTOM_COVER = 480;
const SAMPLE_PHOTO = "/brand/sample-photo.jpg";

function shade(hex: string, f: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#071233";
  const n = parseInt(m[1], 16);
  const c = (v: number) => Math.round(v * f).toString(16).padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/** The real card at any width. */
function ScaledCard({ width, kind, kit, photo, headline, stat }: { width: number; kind: CardKind; kit: PreviewKit; photo: string | null; headline: string; stat: string | null }) {
  const scale = width / CARD_W;
  return (
    <div dir="ltr" style={{ width, height: CARD_H * scale, overflow: "hidden", flex: "none" }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: CARD_W, height: CARD_H }}>
        <NewsCard
          kind={kind}
          brand={brandFrom(kit, "")}
          content={{ headline, stat, quote: null, speaker: null, stamp: "١٠:٤٢", photoSrc: photo }}
        />
      </div>
    </div>
  );
}

function Avatar({ kit, name, size }: { kit: PreviewKit; name: string; size: number }) {
  const logo = mediaSrc(kit.logoPath);
  return (
    <span
      style={{ width: size, height: size, borderRadius: "50%", background: "#fff", overflow: "hidden", display: "grid", placeItems: "center", flex: "none", color: kit.primary, fontWeight: 700, fontSize: size * 0.45 }}
    >
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", padding: size * 0.1 }} />
      ) : (
        [...name][0] ?? "H"
      )}
    </span>
  );
}

const Icon = ({ d }: { d: string }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const HEART = "M12 21s-7-4.6-9.5-9A5.5 5.5 0 0 1 12 6.5 5.5 5.5 0 0 1 21.5 12c-2.5 4.4-9.5 9-9.5 9z";
const COMMENT = "M21 12a8 8 0 0 1-11.8 7L3 21l2-5.2A8 8 0 1 1 21 12z";
const SEND = "M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z";

function InstagramPost({ width, kit, name, caption, children }: { width: number; kit: PreviewKit; name: string; caption: string; children: React.ReactNode }) {
  return (
    <div style={{ width, background: "#000", color: "#fff", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)", flex: "none" }}>
      <div dir="ltr" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}>
        <Avatar kit={kit} name={name} size={32} />
        <strong style={{ fontSize: 14 }}>{name}</strong>
      </div>
      {children}
      <div dir="ltr" style={{ display: "flex", gap: 14, padding: "10px 12px 4px" }}>
        <Icon d={HEART} />
        <Icon d={COMMENT} />
        <Icon d={SEND} />
      </div>
      <p dir="auto" style={{ margin: 0, padding: "2px 12px 14px", fontSize: 14, lineHeight: 1.5 }}>
        <strong>{name} </strong>
        {caption}
      </p>
    </div>
  );
}

function FacebookPost({ width, kit, name, caption, now, children }: { width: number; kit: PreviewKit; name: string; caption: string; now: string; children: React.ReactNode }) {
  return (
    <div style={{ width, background: "#fff", color: "#1c1e21", borderRadius: 12, overflow: "hidden", flex: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px" }}>
        <Avatar kit={kit} name={name} size={40} />
        <div>
          <strong style={{ fontSize: 15 }}>{name}</strong>
          <div style={{ fontSize: 12.5, color: "#65676b" }}>{now}</div>
        </div>
      </div>
      <p dir="auto" style={{ margin: 0, padding: "0 14px 10px", fontSize: 15, lineHeight: 1.5 }}>{caption}</p>
      {children}
      <div dir="ltr" style={{ display: "flex", justifyContent: "space-around", padding: "10px 6px", fontSize: 13, color: "#65676b", borderTop: "1px solid #e4e6eb" }}>
        <span>Like</span>
        <span>Comment</span>
        <span>Share</span>
      </div>
    </div>
  );
}

function ReelSample({ kit, headline, category, place, name }: { kit: PreviewKit; headline: string; category: string; place: string; name: string }) {
  const width = 200;
  const scale = width / REEL_W;
  const logo = mediaSrc(kit.logoPath);
  const mark = 92;
  return (
    <div dir="ltr" style={{ width, height: REEL_H * scale, overflow: "hidden", borderRadius: 16, flex: "none", position: "relative" }}>
      <div
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          width: REEL_W,
          height: REEL_H,
          position: "relative",
          background: `linear-gradient(160deg, ${kit.primary} 0%, ${shade(kit.primary, 0.45)} 55%, ${shade(kit.primary, 0.22)} 100%)`,
          fontFamily: "var(--gm-kufi), var(--gm-sans), system-ui, sans-serif",
          color: "#fff",
        }}
      >
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(700px 700px at 30% 28%, rgba(255,255,255,0.18), transparent 70%), radial-gradient(600px 600px at 75% 78%, ${kit.accent}33, transparent 70%)` }} />
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 10, background: "rgba(255,255,255,0.15)" }}>
          <div style={{ width: "35%", height: "100%", background: kit.accent, marginInlineStart: "auto" }} />
        </div>
        <div style={{ position: "absolute", top: 90, left: 80, right: 80, display: "flex", alignItems: "center", justifyContent: "space-between", direction: "rtl" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" style={{ width: mark, height: mark, borderRadius: mark * 0.29, objectFit: "contain", padding: 8, background: "#fff" }} />
            ) : (
              <div style={{ width: mark, height: mark, borderRadius: mark * 0.29, background: "#fff", display: "grid", placeItems: "center" }}>
                <div style={{ width: mark * 0.42, height: mark * 0.42, borderRadius: "50%", background: kit.accent, boxShadow: `0 0 0 ${mark * 0.1}px ${kit.primary}` }} />
              </div>
            )}
            <div style={{ fontWeight: 700, fontSize: 54, maxWidth: 560, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{name}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, background: "rgba(0,0,0,0.25)", padding: "12px 26px", borderRadius: 999 }}>
            <div style={{ width: 20, height: 20, borderRadius: "50%", background: kit.accent }} />
            <div style={{ fontWeight: 700, fontSize: 36 }}>{category}</div>
          </div>
        </div>
        <div style={{ position: "absolute", left: 80, right: 160, top: 420, direction: "rtl" }}>
          <div style={{ display: "flex", gap: 16, marginBottom: 36 }}>
            <span style={{ fontWeight: 700, fontSize: 34, background: kit.accent, padding: "8px 24px", borderRadius: 12 }}>{place}</span>
          </div>
          <div style={{ fontWeight: 700, fontSize: 88, lineHeight: 1.35 }}>{headline}</div>
        </div>
        <div style={{ position: "absolute", left: 80, right: 160, top: 1300, display: "flex", justifyContent: "center" }}>
          <div style={{ direction: "rtl", fontWeight: 700, fontSize: 54, color: "#111", background: "#ffd23f", padding: "14px 30px", borderRadius: 18 }}>{headline.split(" ").slice(0, 4).join(" ")}</div>
        </div>
        {/* What the app's own buttons and caption cover. */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: REEL_TOP_COVER, background: "repeating-linear-gradient(135deg, rgba(0,0,0,.55) 0 18px, rgba(0,0,0,.35) 18px 36px)" }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: REEL_BOTTOM_COVER, background: "repeating-linear-gradient(135deg, rgba(0,0,0,.55) 0 18px, rgba(0,0,0,.35) 18px 36px)" }} />
      </div>
    </div>
  );
}

type Tab = "ig" | "fb" | "grid" | "reel";

export function ChannelPreview({
  kit,
  libraryPhoto,
  photoCardsOnly,
  pageName,
  hasInstagram,
}: {
  kit: PreviewKit;
  /** The first photo of the desk's library, if any (the sample uses its own picture otherwise). */
  libraryPhoto: string | null;
  photoCardsOnly: boolean;
  pageName: string;
  hasInstagram: boolean;
}) {
  const t = useT();
  const tn = t.settings.news;
  const topics: Record<string, string> = t.nr.news.topics;
  const [tab, setTab] = useState<Tab>("ig");
  const [long, setLong] = useState(false);
  const [withPhoto, setWithPhoto] = useState(true);
  const [kind, setKind] = useState<CardKind>("STANDARD");
  const name = pageName || tn.bdPageName;
  const headline = long ? tn.bdSampleLong : tn.cardSample;
  const photo = withPhoto ? (libraryPhoto ? mediaSrc(libraryPhoto) : SAMPLE_PHOTO) : null;
  const stat = kind === "STAT" ? "٥٣٪" : null;
  const caption = `${headline}\n\n${tn.bdSampleBody}`;
  const shortCaption = headline.length > 70 ? `${headline.slice(0, 70)}…` : headline;
  const tabs: Array<[Tab, string]> = [
    ["ig", tn.bdTabIg],
    ["fb", tn.bdTabFb],
    ["grid", tn.bdTabGrid],
    ["reel", tn.bdTabReel],
  ];
  const kinds: Array<[CardKind, string]> = [
    ["STANDARD", tn.bdKindNews],
    ["BREAKING", tn.bdKindBreaking],
    ["STAT", tn.bdKindNumber],
  ];

  return (
    <div className="gm-card gm-stack">
      <div className="gm-chips" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className="gm-chip" aria-pressed={tab === k} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab !== "reel" && (
        <div className="gm-chips">
          <button type="button" className="gm-chip" aria-pressed={!long} onClick={() => setLong(false)}>{tn.bdShort}</button>
          <button type="button" className="gm-chip" aria-pressed={long} onClick={() => setLong(true)}>{tn.bdLong}</button>
          <button type="button" className="gm-chip" aria-pressed={withPhoto} onClick={() => setWithPhoto((v) => !v)}>{withPhoto ? tn.bdWithPhoto : tn.bdNoPhoto}</button>
          {!photoCardsOnly && !kit.framePath &&
            kinds.map(([k, label]) => (
              <button key={k} type="button" className="gm-chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {label}
              </button>
            ))}
        </div>
      )}

      <div className="gm-row" style={{ gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        {tab === "ig" && (
          <InstagramPost width={320} kit={kit} name={name} caption={shortCaption}>
            <ScaledCard width={320} kind={kind} kit={kit} photo={photo} headline={headline} stat={stat} />
          </InstagramPost>
        )}
        {tab === "fb" && (
          <FacebookPost width={340} kit={kit} name={name} caption={caption} now={tn.bdNow}>
            <ScaledCard width={340} kind={kind} kit={kit} photo={photo} headline={headline} stat={stat} />
          </FacebookPost>
        )}
        {tab === "grid" && (
          <div dir="ltr" style={{ display: "grid", gridTemplateColumns: "repeat(3, 106px)", gap: 2, background: "#000", padding: 2, borderRadius: 8, flex: "none" }}>
            {[0, 1, 2, 3, 4, 5].map((i) =>
              i === 1 ? (
                <div key={i} style={{ width: 106, height: 141, overflow: "hidden", position: "relative" }}>
                  <div style={{ position: "absolute", left: "50%", top: 0, transform: "translateX(-50%)" }}>
                    <ScaledCard width={(141 * CARD_W) / CARD_H} kind={kind} kit={kit} photo={photo} headline={headline} stat={stat} />
                  </div>
                </div>
              ) : (
                <div key={i} style={{ width: 106, height: 141, background: `linear-gradient(${150 + i * 20}deg, #2a2d34, #15171c)` }} />
              ),
            )}
          </div>
        )}
        {tab === "reel" && (
          <ReelSample kit={kit} headline={tn.cardSample} category={topics.politics ?? "سیاسەت"} place={tn.previewPlace} name={name} />
        )}
        <div className="gm-stack" style={{ flex: 1, minWidth: 200, gap: 8 }}>
          <p className="gm-hint" style={{ margin: 0 }}>
            {tab === "ig" ? tn.bdIgNote : tab === "fb" ? tn.bdFbNote : tab === "grid" ? tn.bdGridNote : tn.bdReelNote}
          </p>
          {tab === "reel" && !hasInstagram && <p className="gm-hint" style={{ margin: 0 }}>{tn.bdReelNoIg}</p>}
          {tab !== "reel" && kit.framePath && <p className="gm-hint" style={{ margin: 0 }}>{tn.bdFramedNote}</p>}
        </div>
      </div>
    </div>
  );
}
