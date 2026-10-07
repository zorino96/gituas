// A desk's 9:16 news reel, built only from our own text, the desk's brand and shapes (no footage or
// photos from other outlets). One voice clip per segment, so scenes and captions follow the voice.
// Props come from src/lib/news/video.ts (prepareVideo) in the app.
import { AbsoluteFill, Audio, Img, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { FONT } from "./fonts";

export const REEL_W = 1080;
export const REEL_H = 1920;
export const REEL_FPS = 30;
/** Silence between two voiced segments, and a short hold at the end. */
export const GAP_S = 0.35;
export const TAIL_S = 0.8;

export interface ReelSegment {
  kind: "headline" | "stat" | "fact" | "outro";
  show: string;
  say: string;
  stat?: string;
  label?: string;
  /** The voice clip's URL, and its length (filled in by calculateMetadata). */
  audio: string;
  seconds?: number;
}

// A type, not an interface: Remotion needs props it can treat as a plain record.
export type ReelProps = {
  /** TEMPLATE (this file) or HIGHLIGHT (Highlight.tsx, the desk's own clips). */
  style?: string;
  clips?: string[];
  brand: { name: string; primary: string; accent: string; logoUrl: string | null };
  category: string;
  place: string;
  date: string;
  source: string;
  handle: string;
  segments: ReelSegment[];
};

const INK = "#ffffff";
const SOFT = "rgba(255,255,255,0.78)";

/** Where each segment starts, in frames. */
export function reelTimeline(segments: { seconds?: number }[], fps = REEL_FPS) {
  let at = 0;
  const starts = segments.map((s) => {
    const start = at;
    at += Math.round(((s.seconds ?? 3) + GAP_S) * fps);
    return start;
  });
  return { starts, total: at + Math.round(TAIL_S * fps) };
}

/** The caption line at a moment: the spoken sentence in groups of four words, timed by their length. */
function captionAt(text: string, t: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  const groups: string[] = [];
  for (let i = 0; i < words.length; i += 4) groups.push(words.slice(i, i + 4).join(" "));
  const total = groups.reduce((a, g) => a + g.length, 0) || 1;
  let acc = 0;
  for (const g of groups) {
    acc += g.length;
    if (t <= acc / total) return g;
  }
  return groups[groups.length - 1] ?? "";
}

/** A darker shade of a #rrggbb colour, for the gradient. */
function shade(hex: string, f: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#071233";
  const n = parseInt(m[1], 16);
  const c = (v: number) => Math.round(v * f).toString(16).padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

const Background: React.FC<{ primary: string; accent: string }> = ({ primary, accent }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: `linear-gradient(160deg, ${primary} 0%, ${shade(primary, 0.45)} 55%, ${shade(primary, 0.22)} 100%)` }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(700px 700px at ${30 + Math.sin(f / 70) * 12}% ${28 + Math.cos(f / 90) * 8}%, rgba(255,255,255,0.18), transparent 70%),
                       radial-gradient(600px 600px at ${75 + Math.cos(f / 80) * 10}% ${78 + Math.sin(f / 60) * 6}%, ${accent}33, transparent 70%)`,
        }}
      />
      <AbsoluteFill
        style={{
          opacity: 0.08,
          backgroundImage: "repeating-linear-gradient(0deg, #fff 0 1px, transparent 1px 60px), repeating-linear-gradient(90deg, #fff 0 1px, transparent 1px 60px)",
          backgroundPosition: `0 ${(f / REEL_FPS) * 14}px`,
        }}
      />
    </AbsoluteFill>
  );
};

export const Mark: React.FC<{ size: number; brand: ReelProps["brand"] }> = ({ size, brand }) =>
  brand.logoUrl ? (
    <Img src={brand.logoUrl} style={{ width: size, height: size, borderRadius: size * 0.29, objectFit: "cover", background: "#fff", boxShadow: "0 12px 40px rgba(0,0,0,0.3)" }} />
  ) : (
    <div style={{ width: size, height: size, borderRadius: size * 0.29, background: "#fff", display: "grid", placeItems: "center", boxShadow: "0 12px 40px rgba(0,0,0,0.3)" }}>
      <div style={{ width: size * 0.42, height: size * 0.42, borderRadius: "50%", background: brand.accent, boxShadow: `0 0 0 ${size * 0.1}px ${brand.primary}` }} />
    </div>
  );

const TopBar: React.FC<{ props: ReelProps; progress: number }> = ({ props, progress }) => {
  const f = useCurrentFrame();
  const pulse = 0.55 + 0.45 * Math.abs(Math.sin(f / 9));
  return (
    <>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 10, background: "rgba(255,255,255,0.15)" }}>
        <div style={{ width: `${progress * 100}%`, height: "100%", background: props.brand.accent, marginInlineStart: "auto" }} />
      </div>
      <div style={{ position: "absolute", top: 90, left: 80, right: 80, display: "flex", alignItems: "center", justifyContent: "space-between", direction: "rtl" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <Mark size={92} brand={props.brand} />
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 54, color: INK, maxWidth: 560, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{props.brand.name}</div>
        </div>
        {props.category && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, background: "rgba(0,0,0,0.25)", padding: "12px 26px", borderRadius: 999 }}>
            <div style={{ width: 20, height: 20, borderRadius: "50%", background: props.brand.accent, opacity: pulse }} />
            <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 36, color: INK }}>{props.category}</div>
          </div>
        )}
      </div>
    </>
  );
};

/** Text that rises in word by word. */
const Rise: React.FC<{ text: string; size: number; weight?: number; color?: string; delay?: number }> = ({ text, size, weight = 700, color = INK, delay = 0 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ direction: "rtl", fontFamily: FONT, fontWeight: weight, fontSize: size, lineHeight: 1.35, color, display: "flex", flexWrap: "wrap", gap: `0 ${size * 0.28}px` }}>
      {text.split(/\s+/).map((w, i) => {
        const s = spring({ frame: f - delay - i * 3, fps, config: { damping: 200 } });
        return (
          <span key={i} style={{ opacity: s, transform: `translateY(${(1 - s) * 40}px)`, display: "inline-block" }}>
            {w}
          </span>
        );
      })}
    </div>
  );
};

const Scene: React.FC<{ seg: ReelSegment; props: ReelProps }> = ({ seg, props }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: f, fps, config: { damping: 200 } });
  // Clear of TikTok's and Reels' buttons on the right and the account line at the bottom.
  const box: React.CSSProperties = { position: "absolute", left: 80, right: 160, top: 420, transform: `translateY(${(1 - enter) * 60}px)`, opacity: enter };
  if (seg.kind === "headline") {
    return (
      <div style={box}>
        <div style={{ direction: "rtl", display: "flex", gap: 16, marginBottom: 36 }}>
          {props.place && (
            <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 34, color: INK, background: props.brand.accent, padding: "8px 24px", borderRadius: 12 }}>{props.place}</span>
          )}
          <span style={{ fontFamily: FONT, fontSize: 34, color: SOFT, padding: "8px 0" }}>{props.date}</span>
        </div>
        <Rise text={seg.show} size={88} />
      </div>
    );
  }
  if (seg.kind === "stat") {
    return (
      <div style={{ ...box, textAlign: "center" }}>
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 220, color: INK, lineHeight: 1.15, transform: `scale(${0.7 + 0.3 * enter})` }}>{seg.stat}</div>
        <div style={{ marginTop: 20, display: "flex", justifyContent: "center" }}>
          <Rise text={seg.show} size={62} weight={400} color={SOFT} delay={6} />
        </div>
      </div>
    );
  }
  if (seg.kind === "fact") {
    return (
      <div style={box}>
        <div style={{ direction: "rtl", background: "rgba(255,255,255,0.1)", border: "2px solid rgba(255,255,255,0.18)", borderRadius: 36, padding: "48px 52px" }}>
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 40, color: INK, opacity: 0.8, marginBottom: 18 }}>{seg.label}</div>
          <Rise text={seg.show} size={72} delay={4} />
        </div>
      </div>
    );
  }
  return (
    <AbsoluteFill style={{ display: "grid", placeItems: "center" }}>
      <div style={{ textAlign: "center", opacity: enter, transform: `scale(${0.85 + 0.15 * enter})` }}>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <Mark size={240} brand={props.brand} />
        </div>
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 104, color: INK, marginTop: 40 }}>{props.brand.name}</div>
        <div style={{ fontFamily: FONT, fontSize: 52, color: SOFT, marginTop: 10 }}>{seg.show}</div>
        {props.handle && <div style={{ fontFamily: "sans-serif", fontWeight: 700, fontSize: 46, color: INK, marginTop: 30, direction: "ltr" }}>{props.handle}</div>}
      </div>
    </AbsoluteFill>
  );
};

const Caption: React.FC<{ seg: ReelSegment }> = ({ seg }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (seg.kind === "outro") return null;
  const line = captionAt(seg.say, Math.min(1, f / Math.max(1, (seg.seconds ?? 3) * fps)));
  return (
    <div style={{ position: "absolute", left: 80, right: 160, top: 1300, display: "flex", justifyContent: "center" }}>
      <div style={{ direction: "rtl", fontFamily: FONT, fontWeight: 700, fontSize: 54, color: "#111", background: "#ffd23f", padding: "14px 30px", borderRadius: 18, textAlign: "center", lineHeight: 1.4 }}>
        {line}
      </div>
    </div>
  );
};

export const Reel: React.FC<ReelProps> = (props) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { starts, total } = reelTimeline(props.segments, fps);
  return (
    <AbsoluteFill style={{ backgroundColor: shade(props.brand.primary, 0.22) }}>
      <Background primary={props.brand.primary} accent={props.brand.accent} />
      {props.segments.map((seg, i) => {
        const from = starts[i];
        const until = i + 1 < starts.length ? starts[i + 1] : total;
        return (
          <Sequence key={i} from={from} durationInFrames={until - from}>
            <Audio src={seg.audio} />
            <Scene seg={seg} props={props} />
            <Caption seg={seg} />
          </Sequence>
        );
      })}
      <TopBar props={props} progress={f / total} />
      <div style={{ position: "absolute", bottom: 300, left: 80, right: 160, direction: "rtl", fontFamily: FONT, fontSize: 30, color: "rgba(255,255,255,0.7)" }}>
        {props.source}
      </div>
    </AbsoluteFill>
  );
};
