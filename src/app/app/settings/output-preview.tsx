"use client";

// "How it will look": the desk's cards and its video as the channel will show them, drawn from the brand as it is
// on the screen right now (colours, logo, frames, photo). The cards are the real card renderer; the video is a still of
// the reel's layout (reel/src/Reel.tsx), so it is an approximation of one frame, not the render itself.

import { useT } from "@/lib/i18n/client";
import { brandFrom, mediaSrc, type FrameText } from "@/lib/cards/brand";
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
}

const CARD_PREVIEW_W = 150;
const REEL_W = 1080;
const REEL_H = 1920;
const REEL_PREVIEW_W = 170;

function shade(hex: string, f: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#071233";
  const n = parseInt(m[1], 16);
  const c = (v: number) => Math.round(v * f).toString(16).padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

function CardSample({ kind, kit, photo, headline, stat }: { kind: CardKind; kit: PreviewKit; photo: string | null; headline: string; stat: string | null }) {
  return (
    <div dir="ltr" style={{ width: CARD_PREVIEW_W, height: (CARD_H * CARD_PREVIEW_W) / CARD_W, overflow: "hidden", borderRadius: 10, flex: "none" }}>
      <div style={{ transform: `scale(${CARD_PREVIEW_W / CARD_W})`, transformOrigin: "top left", width: CARD_W, height: CARD_H }}>
        <NewsCard
          kind={kind}
          brand={brandFrom(kit, "")}
          content={{ headline, stat, quote: null, speaker: null, stamp: "١٠:٤٢", photoSrc: photo ? mediaSrc(photo) : null }}
        />
      </div>
    </div>
  );
}

function ReelSample({ kit, headline, category, place }: { kit: PreviewKit; headline: string; category: string; place: string }) {
  const logo = mediaSrc(kit.logoPath);
  const mark = 92;
  return (
    <div dir="ltr" style={{ width: REEL_PREVIEW_W, height: (REEL_H * REEL_PREVIEW_W) / REEL_W, overflow: "hidden", borderRadius: 14, flex: "none" }}>
      <div
        style={{
          transform: `scale(${REEL_PREVIEW_W / REEL_W})`,
          transformOrigin: "top left",
          width: REEL_W,
          height: REEL_H,
          position: "relative",
          background: `linear-gradient(160deg, ${kit.primary} 0%, ${shade(kit.primary, 0.45)} 55%, ${shade(kit.primary, 0.22)} 100%)`,
          fontFamily: kit.headingFont === "sans" ? "system-ui, sans-serif" : "var(--font-kufi), system-ui, sans-serif",
          color: "#fff",
        }}
      >
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(700px 700px at 30% 28%, rgba(255,255,255,0.18), transparent 70%), radial-gradient(600px 600px at 75% 78%, ${kit.accent}33, transparent 70%)` }} />
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 10, background: "rgba(255,255,255,0.15)" }}>
          <div style={{ width: "35%", height: "100%", background: kit.accent, marginInlineStart: "auto" }} />
        </div>
        <div style={{ position: "absolute", top: 90, left: 80, right: 80, display: "flex", alignItems: "center", justifyContent: "space-between", direction: "rtl" }}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" style={{ width: mark, height: mark, borderRadius: mark * 0.29, objectFit: "cover", background: "#fff" }} />
          ) : (
            <div style={{ width: mark, height: mark, borderRadius: mark * 0.29, background: "#fff", display: "grid", placeItems: "center" }}>
              <div style={{ width: mark * 0.42, height: mark * 0.42, borderRadius: "50%", background: kit.accent, boxShadow: `0 0 0 ${mark * 0.1}px ${kit.primary}` }} />
            </div>
          )}
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
      </div>
    </div>
  );
}

export function OutputPreview({ kit, photo }: { kit: PreviewKit; photo: string | null }) {
  const t = useT();
  const tn = t.settings.news;
  const topics: Record<string, string> = t.nr.news.topics;
  return (
    <div className="gm-card gm-stack">
      <p className="gm-sec" style={{ margin: 0 }}>{tn.previewSec}</p>
      <p className="gm-hint" style={{ margin: 0 }}>{tn.previewHint}</p>
      <small className="gm-sub">{tn.previewCards}</small>
      <div className="gm-row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <CardSample kind="STANDARD" kit={kit} photo={photo} headline={tn.cardSample} stat={null} />
        <CardSample kind="BREAKING" kit={kit} photo={null} headline={tn.cardSample} stat={null} />
        <CardSample kind="STAT" kit={kit} photo={photo} headline={tn.cardSample} stat="٥٣٪" />
      </div>
      <small className="gm-sub">{tn.previewVideo}</small>
      <div className="gm-row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <ReelSample kit={kit} headline={tn.cardSample} category={topics.politics ?? "سیاسەت"} place={tn.previewPlace} />
        <p className="gm-hint" style={{ margin: 0, flex: 1, minWidth: 200 }}>{tn.previewVideoNote}</p>
      </div>
    </div>
  );
}
