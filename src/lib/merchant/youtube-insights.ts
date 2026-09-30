// Shapes the YouTube numbers the insights page shows. Pure, so the ranking and
// the partial-failure rules are tested without calling Google.

import type { YtMetric, YtResult, YtVideo } from "@/lib/publishers/youtube-engage";

/** The metric names fetchChannelStats returns → what the owner calls them, in tile order. */
export const YT_LABEL: Record<string, string> = {
  subscribers: "بەشداربوو",
  views: "بینین",
  videos: "ڤیدیۆ",
};

export interface YouTubeBlock {
  tiles: { key: string; label: string; value: number }[];
  /** The three most-viewed of the recent uploads. */
  top: YtVideo[];
  /** Set only when neither call returned anything; otherwise the block shows what arrived. */
  error: string | null;
}

export function youtubeBlock(stats: YtResult<YtMetric[]>, recent: YtResult<YtVideo[]>): YouTubeBlock {
  const metrics = stats.ok ? (stats.data ?? []) : [];
  const tiles = Object.keys(YT_LABEL).flatMap((k) => {
    const m = metrics.find((x) => x.name === k);
    return m ? [{ key: k, label: YT_LABEL[k], value: m.value }] : [];
  });
  const top = recent.ok ? [...(recent.data ?? [])].sort((a, b) => b.views - a.views).slice(0, 3) : [];
  const error = !stats.ok && !recent.ok ? (stats.error ?? recent.error ?? "YouTube failed") : null;
  return { tiles, top, error };
}
