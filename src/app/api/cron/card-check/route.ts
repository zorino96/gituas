import { NextResponse } from "next/server";

import { renderCardServer } from "@/lib/cards/server-render";
import { db } from "@/lib/db";
import { renderOrigin, safeError } from "@/lib/news/autopilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Proves the server card renderer works where it runs: renders the newest draft's card with
 * headless Chromium and answers with its size and time. Nothing is stored, attached or posted.
 * Run by hand from GitHub Actions (card-check.yml) with `Authorization: Bearer $CRON_SECRET`.
 * `?draft=<id>` renders that draft instead; `?image=1` answers with the JPEG itself, to look at.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const params = new URL(req.url).searchParams;
  const asked = params.get("draft");
  const draft = await db.newsDraft.findFirst({
    where: asked ? { id: asked } : {},
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (!draft) return NextResponse.json({ ok: false, error: "no draft to render" });

  const started = Date.now();
  try {
    const jpeg = await renderCardServer(draft.id, renderOrigin());
    const jpegOk = jpeg[0] === 0xff && jpeg[1] === 0xd8;
    if (jpegOk && params.get("image") === "1") {
      return new Response(new Uint8Array(jpeg), { headers: { "content-type": "image/jpeg", "cache-control": "no-store" } });
    }
    return NextResponse.json({ ok: jpegOk, draft: draft.id, bytes: jpeg.length, ms: Date.now() - started });
  } catch (e) {
    return NextResponse.json({ ok: false, draft: draft.id, error: safeError(e), ms: Date.now() - started });
  }
}
