import { Composition, staticFile, type CalculateMetadataFunction } from "remotion";
import { getAudioDurationInSeconds } from "@remotion/media-utils";

import { Highlight } from "./Highlight";
import { Reel, REEL_FPS, REEL_H, REEL_W, reelTimeline, type ReelProps } from "./Reel";
import { Story, type StoryProps } from "./Story";

const defaults: ReelProps = {
  brand: { name: "", primary: "#1f4fd6", accent: "#e0262f", logoUrl: null },
  category: "",
  place: "",
  date: "",
  source: "",
  handle: "",
  segments: [],
};

// Every scene lasts exactly as long as its voice clip.
const timed: CalculateMetadataFunction<ReelProps> = async ({ props }) => {
  const segments = await Promise.all(props.segments.map(async (s) => ({ ...s, seconds: s.seconds ?? (await getAudioDurationInSeconds(s.audio)) })));
  return { durationInFrames: Math.max(30, reelTimeline(segments).total), props: { ...props, segments } };
};

const storyDefaults: StoryProps = { title: "", tag: "", credit: "", segments: [] };

// A story scene lasts exactly as long as its voice clip (the clips are files in the public folder).
const storyTimed: CalculateMetadataFunction<StoryProps> = async ({ props }) => {
  const segments = await Promise.all(props.segments.map(async (s) => ({ ...s, seconds: s.seconds ?? (await getAudioDurationInSeconds(staticFile(s.audio))) })));
  return { durationInFrames: Math.max(30, reelTimeline(segments).total), props: { ...props, segments } };
};

export const Root: React.FC = () => (
  <>
    <Composition id="NewsReel" component={Reel} width={REEL_W} height={REEL_H} fps={REEL_FPS} durationInFrames={30} defaultProps={defaults} calculateMetadata={timed} />
    <Composition id="Highlight" component={Highlight} width={REEL_W} height={REEL_H} fps={REEL_FPS} durationInFrames={30} defaultProps={defaults} calculateMetadata={timed} />
    <Composition id="Story" component={Story} width={REEL_W} height={REEL_H} fps={REEL_FPS} durationInFrames={30} defaultProps={storyDefaults} calculateMetadata={storyTimed} />
  </>
);
