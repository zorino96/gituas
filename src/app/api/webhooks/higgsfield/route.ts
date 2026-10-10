// Higgsfield calls this when a Studio picture reaches a final state (completed, failed, nsfw).
// It does not sign its webhooks, so the URL carries our own token (src/lib/studio/higgsfield.ts),
// and the payload is only a hint: advanceAsset asks Higgsfield for the real state. Answers 2xx at
// once (Higgsfield retries for two hours otherwise) and does the work after the response.

import { after, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { isWebhookToken } from "@/lib/studio/higgsfield";
import { advanceAsset } from "@/lib/studio/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isWebhookToken(new URL(req.url).searchParams.get("t"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { request_id?: unknown } | null;
  const requestId = typeof body?.request_id === "string" ? body.request_id : null;
  if (!requestId) return NextResponse.json({ ok: true });
  const asset = await db.studioAsset.findUnique({ where: { requestId }, select: { id: true } });
  if (asset) {
    after(() => advanceAsset(asset.id).catch((e) => console.error("[studio] webhook advance failed:", e instanceof Error ? e.message : "unknown error")));
  }
  return NextResponse.json({ ok: true });
}
