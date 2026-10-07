// A desk's HIGHLIGHT reel: its own footage, full-bleed and muted, under our voice-over, with
// captions, lower thirds and the desk's brand. Footage shows in turn, one clip per segment.
import { AbsoluteFill, Audio, interpolate, OffthreadVideo, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";

import { FONT } from "./fonts";
import { Mark, reelTimeline, type ReelProps } from "./Reel";

const Footage: React.FC<{ src: string; frames: number; blur?: boolean }> = ({ src, frames, blur }) => {
  const f = useCurrentFrame();
  const zoom = interpolate(f, [0, frames], [1.05, 1.15], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <OffthreadVideo
        src={src}
        muted
        style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${zoom})`, filter: blur ? "blur(18px) brightness(0.55)" : "brightness(0.85)" }}
      />
    </AbsoluteFill>
  );
};

const Words: React.FC<{ text: string; size: number; delay?: number }> = ({ text, size, delay = 0 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ direction: "rtl", fontFamily: FONT, fontWeight: 700, fontSize: size, lineHeight: 1.35, color: "#fff", display: "flex", flexWrap: "wrap", gap: `0 ${size * 0.28}px`, textShadow: "0 3px 18px rgba(0,0,0,0.6)" }}>
      {text.split(/\s+/).map((w, i) => {
        const s = spring({ frame: f - delay - i * 3, fps, config: { damping: 200 } });
        return (
          <span key={i} style={{ opacity: s, transform: `translateY(${(1 - s) * 30}px)`, display: "inline-block" }}>
            {w}
          </span>
        );
      })}
    </div>
  );
};

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

export const Highlight: React.FC<ReelProps> = (props) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { starts, total } = reelTimeline(props.segments, fps);
  const clips = props.clips?.length ? props.clips : [];
  const accent = props.brand.accent;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {props.segments.map((seg, i) => {
        const from = starts[i];
        const len = (i + 1 < starts.length ? starts[i + 1] : total) - from;
        const outro = seg.kind === "outro";
        return (
          <Sequence key={i} from={from} durationInFrames={len}>
            {clips.length > 0 && <Footage src={clips[i % clips.length]} frames={len} blur={outro} />}
            <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 48%, rgba(0,0,0,0.85) 100%)" }} />
            <Audio src={seg.audio} />
            {outro ? (
              <AbsoluteFill style={{ display: "grid", placeItems: "center" }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <Mark size={220} brand={props.brand} />
                  </div>
                  <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 104, color: "#fff", marginTop: 36 }}>{props.brand.name}</div>
                  <div style={{ fontFamily: FONT, fontSize: 52, color: "rgba(255,255,255,0.85)" }}>{seg.show}</div>
                  {props.handle && <div style={{ fontFamily: "sans-serif", fontWeight: 700, fontSize: 46, color: "#fff", marginTop: 26, direction: "ltr" }}>{props.handle}</div>}
                </div>
              </AbsoluteFill>
            ) : (
              <>
                {/* Lower third: the headline first, then each fact. Clear of the apps' buttons. */}
                <div style={{ position: "absolute", left: 70, right: 150, bottom: 470 }}>
                  {seg.kind === "headline" ? (
                    <>
                      <div style={{ direction: "rtl", display: "flex", gap: 14, marginBottom: 22 }}>
                        {props.place && <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 34, color: "#fff", background: accent, padding: "6px 22px", borderRadius: 10 }}>{props.place}</span>}
                        <span style={{ fontFamily: FONT, fontSize: 32, color: "rgba(255,255,255,0.85)", padding: "6px 0" }}>{props.date}</span>
                      </div>
                      <Words text={seg.show} size={76} />
                    </>
                  ) : (
                    <div style={{ direction: "rtl", borderInlineStart: `10px solid ${accent}`, background: "rgba(10,20,60,0.72)", padding: "26px 34px", borderRadius: 18 }}>
                      {seg.kind === "stat" && <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 104, color: "#fff", lineHeight: 1.1 }}>{seg.stat}</div>}
                      {seg.label && <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 34, color: "rgba(255,255,255,0.8)", marginBottom: 8 }}>{seg.label}</div>}
                      <Words text={seg.show} size={56} />
                    </div>
                  )}
                </div>
                <div style={{ position: "absolute", left: 70, right: 150, bottom: 330, display: "flex", justifyContent: "center" }}>
                  <div style={{ direction: "rtl", fontFamily: FONT, fontWeight: 700, fontSize: 50, color: "#111", background: "#ffd23f", padding: "12px 28px", borderRadius: 16, textAlign: "center" }}>
                    {captionAt(seg.say, Math.min(1, (f - from) / Math.max(1, (seg.seconds ?? 3) * fps)))}
                  </div>
                </div>
              </>
            )}
          </Sequence>
        );
      })}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 10, background: "rgba(255,255,255,0.2)" }}>
        <div style={{ width: `${(f / total) * 100}%`, height: "100%", background: accent, marginInlineStart: "auto" }} />
      </div>
      <div style={{ position: "absolute", top: 80, left: 70, right: 70, display: "flex", alignItems: "center", gap: 18, direction: "rtl" }}>
        <Mark size={80} brand={props.brand} />
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 50, color: "#fff", textShadow: "0 2px 12px rgba(0,0,0,0.6)" }}>{props.brand.name}</div>
      </div>
      <div style={{ position: "absolute", bottom: 270, left: 70, right: 150, direction: "rtl", fontFamily: FONT, fontSize: 26, color: "rgba(255,255,255,0.75)" }}>{props.source}</div>
    </AbsoluteFill>
  );
};
