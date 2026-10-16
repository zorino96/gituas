// A narrated story video (9:16): one picture per narration chunk with a slow zoom, the spoken words as captions, one voice
// clip per chunk (so the picture and the caption follow the voice), the title over the first seconds. Test feature: made
// for workspaces on the UNLIMITED (test-code) plan; the renderer lane for it is not wired into the cron yet.
import { AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

import { FONT } from "./fonts";
import { captionAt, reelTimeline } from "./Reel";

export interface StorySegment {
  /** What is spoken (also the caption). */
  say: string;
  /** Files in the public folder: the voice clip, the sharp picture, and the same picture blurred to fill the frame. */
  audio: string;
  picture: string;
  bg: string;
  /** The voice clip's length (filled in by calculateMetadata). */
  seconds?: number;
}

// A type, not an interface: Remotion needs props it can treat as a plain record.
export type StoryProps = {
  title: string;
  tag: string;
  /** A small line at the bottom, for example that the pictures are AI illustrations. */
  credit: string;
  segments: StorySegment[];
};

const GOLD = "#ffd23f";
const PICTURE_TOP = 330;
const PICTURE_SIZE = 1080;

const SceneView: React.FC<{ seg: StorySegment; index: number; frames: number }> = ({ seg, index, frames }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = Math.min(1, f / Math.max(1, frames));
  const zoom = 1.04 + 0.14 * t;
  const pan = (index % 2 ? 1 : -1) * (t - 0.5) * 70;
  const fade = interpolate(f, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  const spoken = Math.min(1, f / Math.max(1, (seg.seconds ?? 3) * fps));
  const line = captionAt(seg.say, spoken);
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <Img src={staticFile(seg.bg)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <div style={{ position: "absolute", left: 0, top: PICTURE_TOP, width: PICTURE_SIZE, height: PICTURE_SIZE, overflow: "hidden", boxShadow: "0 0 90px rgba(0,0,0,0.65)" }}>
        <Img src={staticFile(seg.picture)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `translateX(${pan}px) scale(${zoom})` }} />
      </div>
      <div style={{ position: "absolute", left: 60, right: 60, top: 1480, display: "flex", justifyContent: "center" }}>
        <div
          style={{
            direction: "rtl",
            fontFamily: FONT,
            fontWeight: 700,
            fontSize: 68,
            lineHeight: 1.45,
            color: "#fff",
            textAlign: "center",
            background: "rgba(0,0,0,0.55)",
            padding: "16px 34px",
            borderRadius: 22,
            textShadow: "0 3px 12px rgba(0,0,0,0.8)",
          }}
        >
          {line}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const Story: React.FC<StoryProps> = (props) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { starts, total } = reelTimeline(props.segments, fps);
  const intro = interpolate(f, [0, 75, 105], [1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const introLift = interpolate(f, [0, 105], [0, -30], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ backgroundColor: "#05070d" }}>
      {props.segments.map((seg, i) => {
        const from = starts[i];
        const until = i + 1 < starts.length ? starts[i + 1] : total;
        return (
          <Sequence key={i} from={from} durationInFrames={until - from}>
            <Audio src={staticFile(seg.audio)} />
            <SceneView seg={seg} index={i} frames={until - from} />
          </Sequence>
        );
      })}

      {/* the title, always small at the top */}
      <div style={{ position: "absolute", left: 50, right: 50, top: 95, textAlign: "center", direction: "rtl" }}>
        <div style={{ display: "inline-block", fontFamily: FONT, fontWeight: 700, fontSize: 36, color: "#111", background: GOLD, padding: "6px 24px", borderRadius: 999 }}>{props.tag}</div>
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 56, color: "#fff", marginTop: 18, lineHeight: 1.3, textShadow: "0 3px 14px rgba(0,0,0,0.85)" }}>{props.title}</div>
      </div>

      {/* the title big, over the opening seconds */}
      <AbsoluteFill style={{ opacity: intro, background: "linear-gradient(180deg, rgba(0,0,0,0.78), rgba(0,0,0,0.5) 55%, rgba(0,0,0,0.78))", justifyContent: "center", alignItems: "center", direction: "rtl" }}>
        <div style={{ transform: `translateY(${introLift}px)`, textAlign: "center", padding: "0 80px" }}>
          <div style={{ display: "inline-block", fontFamily: FONT, fontWeight: 700, fontSize: 52, color: "#111", background: GOLD, padding: "10px 36px", borderRadius: 999 }}>{props.tag}</div>
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 112, color: "#fff", marginTop: 40, lineHeight: 1.25, textShadow: "0 4px 24px rgba(0,0,0,0.9)" }}>{props.title}</div>
        </div>
      </AbsoluteFill>

      <div style={{ position: "absolute", left: 0, bottom: 0, height: 10, width: `${(f / total) * 100}%`, background: GOLD }} />
      <div style={{ position: "absolute", left: 60, right: 60, bottom: 70, textAlign: "center", direction: "rtl", fontFamily: FONT, fontSize: 30, color: "rgba(255,255,255,0.7)" }}>{props.credit}</div>
    </AbsoluteFill>
  );
};
