import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { runContentAgent } from "@/lib/agents/content-agent";
import { runPlanRefresher } from "@/lib/agents/plan-refresher";
import { runReplyAgent } from "@/lib/agents/reply-agent";
import { runAdCampaignAgent } from "@/lib/agents/ad-campaign-agent";
import { runPersonalityRefresher } from "@/lib/agents/personality-refresher";
import { runHibernationAgent } from "@/lib/agents/hibernation-agent";
import { runMarketIntelligence } from "@/lib/agents/market-intelligence";
import { runRedditInboxAgent } from "@/lib/agents/reddit-inbox-agent";
import { runSeoAgent } from "@/lib/agents/seo-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron endpoint — schedule this every hour (Vercel cron, GitHub Actions, etc.):
 *
 *   GET /api/cron/run-agents
 *   Authorization: Bearer ${CRON_SECRET}
 *
 * It iterates every AUTO project for the tenant and runs the 9 agents.
 * Skipped reasons are returned in the response for observability.
 */
export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (got !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const projects = await db.project.findMany({
    where: { mode: { masterMode: "AUTO" }, status: "ACTIVE" },
    select: { id: true, name: true },
  });

  type AgentResult = { agent: string } & Record<string, unknown>;
  const results: Array<{ project: { id: string; name: string }; runs: AgentResult[] }> = [];

  for (const project of projects) {
    const runs: AgentResult[] = [];
    const safe = async (name: string, fn: () => Promise<unknown>) => {
      try {
        const r = await fn();
        runs.push({ agent: name, ok: true, ...(r as object) });
      } catch (err) {
        runs.push({ agent: name, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    };

    await safe("personality-refresher", () => runPersonalityRefresher(project.id));
    await safe("plan-refresher", () => runPlanRefresher(project.id));
    await safe("market-intelligence", () => runMarketIntelligence(project.id));
    await safe("content-agent", () => runContentAgent(project.id));
    await safe("seo-agent", () => runSeoAgent(project.id));
    await safe("ad-campaign-agent", () => runAdCampaignAgent(project.id));
    await safe("reddit-inbox-agent", () => runRedditInboxAgent(project.id));
    await safe("reply-agent", () => runReplyAgent(project.id));
    await safe("hibernation-agent", () => runHibernationAgent(project.id));

    results.push({ project, runs });
  }

  return NextResponse.json({ tickedAt: new Date().toISOString(), projects: results });
}
