// ---------------------------------------------------------------------------
//  YouTube engagement — channel + video statistics (YouTube Data API v3)
// ---------------------------------------------------------------------------
//
//  Read-only counterpart to publishers/youtube.ts. Uses the `youtube.readonly`
//  scope that connect already grants but nothing was reading, so this needs no
//  new consent and no new Google approval.
//
//  Quota is the thing to watch: the default project allowance is 10,000 units
//  a day and a video upload alone costs 1,600, so keep these list calls cheap —
//  channels.list / playlistItems.list / videos.list are 1 unit each.

import { validYouTubeToken } from "./youtube";

const API = "https://www.googleapis.com/youtube/v3";

export interface YtResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface YtMetric {
  name: string;
  value: number;
}

export interface YtVideo {
  id: string;
  title?: string;
  publishedAt?: string;
  thumbnailUrl?: string;
  permalinkUrl: string;
  views: number;
  likes: number;
  comments: number;
}

/** YouTube returns counts as strings ("1234"); hidden counts are absent. */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fail(label: string, status: number, json: unknown): YtResult<never> {
  const j = json as { error?: { message?: string } } | null;
  const msg = j?.error?.message ?? JSON.stringify(json ?? {});
  return { ok: false, error: `${label} ${status}: ${String(msg).slice(0, 200)}` };
}

async function get(url: string, token: string) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, json };
}

/** Lifetime channel counters: views, subscribers, uploads. */
export async function fetchChannelStats(tenantId: string): Promise<YtResult<YtMetric[]>> {
  const token = await validYouTubeToken(tenantId);
  if (!token) return { ok: false, error: "YouTube not connected (or token refresh failed — reconnect)" };

  const r = await get(`${API}/channels?part=statistics&mine=true`, token);
  if (!r.ok) return fail("YouTube channel", r.status, r.json);

  const s = r.json?.items?.[0]?.statistics;
  if (!s) return { ok: false, error: "No channel on the connected account" };

  const out: YtMetric[] = [
    { name: "views", value: num(s.viewCount) },
    { name: "videos", value: num(s.videoCount) },
  ];
  // Creators can hide the subscriber count — omit rather than show a false 0.
  if (s.hiddenSubscriberCount !== true) {
    out.splice(1, 0, { name: "subscribers", value: num(s.subscriberCount) });
  }
  return { ok: true, data: out };
}

/** Most recent uploads with their view/like/comment counts. 3 units total. */
export async function fetchRecentVideos(tenantId: string, limit = 6): Promise<YtResult<YtVideo[]>> {
  const token = await validYouTubeToken(tenantId);
  if (!token) return { ok: false, error: "YouTube not connected (or token refresh failed — reconnect)" };

  // 1. The channel's "uploads" playlist holds every public+private upload.
  const chan = await get(`${API}/channels?part=contentDetails&mine=true`, token);
  if (!chan.ok) return fail("YouTube channel", chan.status, chan.json);
  const uploads = chan.json?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return { ok: true, data: [] }; // channel exists but has never uploaded

  // 2. Newest items in that playlist.
  const list = await get(
    `${API}/playlistItems?part=contentDetails&playlistId=${encodeURIComponent(uploads)}&maxResults=${Math.min(limit, 50)}`,
    token,
  );
  if (!list.ok) return fail("YouTube uploads", list.status, list.json);
  const ids = ((list.json?.items ?? []) as Array<{ contentDetails?: { videoId?: string } }>)
    .map((i) => i.contentDetails?.videoId)
    .filter((v): v is string => !!v);
  if (!ids.length) return { ok: true, data: [] };

  // 3. One batched call for snippets + statistics.
  const vids = await get(
    `${API}/videos?part=snippet,statistics&id=${ids.join(",")}`,
    token,
  );
  if (!vids.ok) return fail("YouTube videos", vids.status, vids.json);

  const data: YtVideo[] = (
    (vids.json?.items ?? []) as Array<{
      id: string;
      snippet?: { title?: string; publishedAt?: string; thumbnails?: Record<string, { url?: string }> };
      statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
    }>
  ).map((v) => ({
    id: v.id,
    title: v.snippet?.title,
    publishedAt: v.snippet?.publishedAt,
    thumbnailUrl: v.snippet?.thumbnails?.medium?.url ?? v.snippet?.thumbnails?.default?.url,
    permalinkUrl: `https://youtu.be/${v.id}`,
    views: num(v.statistics?.viewCount),
    likes: num(v.statistics?.likeCount),
    comments: num(v.statistics?.commentCount),
  }));

  return { ok: true, data };
}
