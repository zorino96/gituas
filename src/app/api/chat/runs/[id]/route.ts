import { NextResponse } from "next/server";
import { z } from "zod";

import { decideRun } from "@/lib/chat/confirm";
import { indexTools, toolsFor } from "@/lib/chat/registry";
import { actorFromSession } from "@/lib/chat/session";
import { errorText } from "@/lib/chat/text";
import { ALL_TOOLS } from "@/lib/chat/tools";
import type { RunDecisionResponse } from "@/lib/chat/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A picture takes up to a minute: the card's own request gets the platform's full limit.
export const maxDuration = 60;

const Body = z.object({ action: z.enum(["confirm", "cancel"]), workspaceId: z.string().min(1).max(60), review: z.boolean().optional() });

/** The person presses Confirm or Cancel on a card. What runs is what the server holds for that run, never what the browser sends. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse<RunDecisionResponse>> {
  const who = await actorFromSession();
  if (!who.ok) return NextResponse.json({ ok: false, code: who.code, message: errorText(who.code, who.lang) });
  const { actor } = who;
  if (!req.headers.get("content-type")?.includes("application/json")) return NextResponse.json({ ok: false, code: "badrequest", message: errorText("badrequest", actor.lang) });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, code: "badrequest", message: errorText("badrequest", actor.lang) });
  if (parsed.data.workspaceId !== actor.tenantId) return NextResponse.json({ ok: false, code: "workspace", message: errorText("workspace", actor.lang) });
  const { id } = await ctx.params;
  const result = await decideRun({
    runId: id,
    action: parsed.data.action,
    actor,
    tools: indexTools(toolsFor(ALL_TOOLS, actor.kind, actor.role)),
    review: parsed.data.review !== false,
    deadline: Date.now() + 57_000,
  });
  return NextResponse.json(result);
}
