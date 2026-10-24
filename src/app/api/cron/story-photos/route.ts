import { NextResponse } from "next/server";

import { probeArticle, probeCommons } from "@/lib/advideo/commons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A Wikipedia title as the probe takes it: letters, digits, spaces and the few marks article titles have; no markup, no pipes. */
function cleanTitle(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{N} _().,'\-–:&!?]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * Does Wikimedia answer from this deployment's network, and which photographs would the story video accept? With the cron secret:
 *   GET ?q=<search phrase>      one Commons search and the verdict on every hit (licence, size, refusal reason).
 *   GET ?title=<article title>  the pictures of that English Wikipedia article, in the order of the page, and the verdict on each as
 *                               the story finder judges them (the case's own pictures); "about" says the file's text names the case.
 * Add `&format=wide` to see the pictures as a wide (16:9, 1920 px thumbnails) story would be offered them; the default is the vertical reel.
 * Nothing is downloaded or stored. After a deploy: /api/cron/story-photos?q=Hinterkaifeck+Hof or ?title=Hinterkaifeck+murders
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const params = new URL(req.url).searchParams;
  const enabled = process.env.STORY_PHOTOS_ENABLED !== "0";
  const format = params.get("format") === "wide" ? "wide" : "vertical";
  const title = cleanTitle(params.get("title") ?? "");
  if (title) return NextResponse.json({ enabled, format, ...(await (format === "wide" ? probeArticle(title, undefined, undefined, "wide") : probeArticle(title))) });
  const q = params.get("q")?.trim().slice(0, 120) ?? "";
  if (!q) return NextResponse.json({ error: "q or title is needed, for example ?q=Hinterkaifeck+Hof or ?title=Hinterkaifeck+murders" }, { status: 400 });
  return NextResponse.json({ enabled, format, ...(await (format === "wide" ? probeCommons(q, undefined, undefined, "wide") : probeCommons(q))) });
}
