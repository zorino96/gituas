import { Composition } from "remotion";
import { getAudioDurationInSeconds } from "@remotion/media-utils";

import { Reel, REEL_FPS, REEL_H, REEL_W, reelTimeline, type ReelProps } from "./Reel";

const defaults: ReelProps = {
  brand: { name: "", primary: "#1f4fd6", accent: "#e0262f", logoUrl: null },
  category: "",
  place: "",
  date: "",
  source: "",
  handle: "",
  segments: [],
};

export const Root: React.FC = () => (
  <Composition
    id="NewsReel"
    component={Reel}
    width={REEL_W}
    height={REEL_H}
    fps={REEL_FPS}
    durationInFrames={30}
    defaultProps={defaults}
    // Every scene lasts exactly as long as its voice clip.
    calculateMetadata={async ({ props }) => {
      const segments = await Promise.all(
        props.segments.map(async (s) => ({ ...s, seconds: s.seconds ?? (await getAudioDurationInSeconds(s.audio)) })),
      );
      return { durationInFrames: Math.max(30, reelTimeline(segments).total), props: { ...props, segments } };
    }}
  />
);
