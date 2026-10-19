import { NextResponse } from "next/server";

import { coachEnabled } from "@/lib/coach/enabled";
import { generateNote } from "@/lib/coach/weekly";
import { baghdadClock, inCoachWindow, isoWeekKey } from "@/lib/coach/week";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** One workspace's note may take this long at most (the route has 60 s; the AI call inside has its own 25 s). */
const GUARD_MS = 40_000;
/** How many due workspaces are looked at to pick one from. */
const CANDIDATES = 5;

/**
 * The weekly growth-coach note. The Cloudflare clock calls it every minute (cloudflare/clock/worker.js); it does nothing except on
 * Sunday between 09:00 and 12:00 in Baghdad, and then it makes the note of ONE workspace that has none for this week, so a call is
 * short and a failing workspace cannot hold up the others for long (the candidate is picked by the minute). Safe to call as often as
 * the clock likes: a workspace with a note for the week is never due, and the database refuses a second one.
 * `Authorization: Bearer $CRON_SECRET`, like the other cron routes.
 *
 * To try it outside the Sunday window (on a test shop), the holder of the secret can add `?force=1` (skips the window only) and
 * `&tenant=<workspace id>` (that one shop workspace instead of the next due one). Nothing else changes: the switch, the one-per-week
 * rule and the 40 s guard all apply.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const now = Date.now();
  const params = new URL(req.url).searchParams;
  const force = params.get("force") === "1";
  if (!force && !inCoachWindow(now)) return NextResponse.json({ skipped: "window" });
  if (!coachEnabled()) return NextResponse.json({ skipped: "off" });

  const week = isoWeekKey(now);
  const wanted = force ? params.get("tenant") : null;
  const due = wanted
    ? await db.tenant.findMany({ where: { id: wanted, kind: "MERCHANT" }, take: 1, select: { id: true } })
    : await db.tenant.findMany({
        where: {
          kind: "MERCHANT",
          coachNotes: { none: { week } },
          stores: { some: { OR: [{ fbPageId: { not: null } }, { igUserId: { not: null } }] } },
        },
        orderBy: { createdAt: "desc" },
        take: CANDIDATES,
        select: { id: true },
      });
  if (!due.length) return NextResponse.json({ week, due: 0 });

  const pick = due[baghdadClock(now).minute % due.length];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), GUARD_MS);
  });
  try {
    const done = await Promise.race([generateNote(pick.id, now), late]);
    if (done === "late") return NextResponse.json({ week, due: due.length, status: "late" });
    return NextResponse.json({ week, due: due.length, status: done.status, ...(done.status === "created" ? { source: done.source } : {}) });
  } catch (e) {
    // Only the error's name: its text may carry a piece of a record.
    console.error("[coach] note failed:", e instanceof Error ? e.name : "unknown error");
    return NextResponse.json({ week, due: due.length, status: "failed" });
  } finally {
    clearTimeout(timer);
  }
}
