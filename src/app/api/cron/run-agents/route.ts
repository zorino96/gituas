import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retired. This route ran the nine agents of the first product (the old /dashboard, now redirected to
 * /app) with Gemini, outside every plan's AI allowance. Nothing schedules it any more, and it answers
 * "gone" so nothing can start those agents by mistake. Gituas writes with Claude Haiku and Opus only.
 */
export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || got !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ error: "retired" }, { status: 410 });
}
