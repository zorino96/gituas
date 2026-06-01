import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { auth } from "@/auth";
import { db } from "@/lib/db";
// Personality now uses Gemini (see lib/personality.ts) — keep the import for
// other panels but check Gemini for personality enablement.
import { isAnthropicConfigured } from "@/lib/anthropic";
void isAnthropicConfigured;
import { isGeminiConfigured } from "@/lib/gemini";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ModeSwitch } from "@/components/mode-switch";
import { PersonalityPanel } from "@/components/personality-panel";
import { MarketingPlanPanel } from "@/components/marketing-plan-panel";
import { AutoModeRunner } from "@/components/auto-mode-runner";
import { GithubIcon } from "@/components/icons/github";
import { getPlanProgress } from "@/lib/agents/content-agent";
import type { ProjectPersonality } from "@/lib/personality";
import type { MarketingPlan } from "@/lib/marketing-plan";

type PageProps = { params: Promise<{ id: string }> };

export default async function ProjectDetailPage({ params }: PageProps) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const project = await db.project.findFirst({
    where: { id, tenant: { ownerId: session.user.id } },
    include: {
      mode: true,
      personality: true,
      marketingPlans: {
        where: { status: { in: ["DRAFT", "ACTIVE"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!project) notFound();

  // Ensure a ProjectMode row exists with defaults.
  const mode = project.mode ?? (await db.projectMode.create({
    data: { projectId: project.id },
  }));

  const personality = project.personality?.data as unknown as ProjectPersonality | undefined;
  const latestPlan = project.marketingPlans[0];
  const plan = latestPlan?.data as unknown as MarketingPlan | undefined;

  // Auto-mode-only sidecar data
  const isAuto = mode.masterMode === "AUTO";
  const [planProgress, recentRuns] = isAuto
    ? await Promise.all([
        getPlanProgress(project.id),
        db.auditLog.findMany({
          where: {
            projectId: project.id,
            actor: { in: ["AI_GEMINI", "AI_CLAUDE", "AI_ROUTER", "SYSTEM"] },
            action: { startsWith: "content.auto_" },
          },
          orderBy: { createdAt: "desc" },
          take: 5,
        }),
      ])
    : [null, []];

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/dashboard/projects" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All projects
      </Link>

      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{project.name}</h1>
          <p className="mt-1 text-muted-foreground">
            {project.description ?? "No description yet."}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline">{project.status.toLowerCase()}</Badge>
            {project.githubRepoUrl && (
              <a
                href={project.githubRepoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 hover:bg-muted"
              >
                <GithubIcon className="h-3 w-3" />
                {project.githubRepoOwner}/{project.githubRepoName}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {project.productionUrl && (
              <a
                href={project.productionUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 hover:bg-muted"
              >
                {new URL(project.productionUrl).hostname}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {isAuto && (
            <AutoModeRunner
              projectId={project.id}
              contentMode={mode.contentMode}
              requireApproval={mode.requireApproval}
              planProgress={
                planProgress
                  ? {
                      consumed: planProgress.consumed,
                      total: planProgress.total,
                      remaining: planProgress.remaining,
                      nextItemHook: planProgress.nextItem?.hook ?? null,
                      nextItemDay: planProgress.nextItem?.day ?? null,
                    }
                  : null
              }
              recentRuns={recentRuns.map((r) => ({
                id: r.id,
                action: r.action,
                reasoning: r.reasoning,
                createdAt: r.createdAt,
                contentPostId:
                  (r.metadata as { contentPostId?: string } | null)?.contentPostId ?? null,
              }))}
            />
          )}

          <ModeSwitch
            projectId={project.id}
            initial={{
              masterMode: mode.masterMode,
              adsMode: mode.adsMode,
              contentMode: mode.contentMode,
              replyMode: mode.replyMode,
              commentMode: mode.commentMode,
              scalingMode: mode.scalingMode,
              requireApproval: mode.requireApproval,
            }}
          />

          <PersonalityPanel
            projectId={project.id}
            personality={personality ?? null}
            generatedAt={project.personality?.updatedAt ?? null}
            enabled={isGeminiConfigured()}
          />

          <MarketingPlanPanel
            projectId={project.id}
            plan={plan ?? null}
            generatedAt={latestPlan?.updatedAt ?? null}
            hasPersonality={!!personality}
            enabled={isGeminiConfigured()}
          />
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Content</CardTitle>
              <CardDescription>
                One asset → 4 aspect ratios → every platform.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`/dashboard/projects/${project.id}/content`}>
                <Button variant="outline" size="sm" className="w-full">
                  Open content library
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ad campaigns</CardTitle>
              <CardDescription>
                Realized from the marketing plan.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`/dashboard/projects/${project.id}/campaigns`}>
                <Button variant="outline" size="sm" className="w-full">
                  View campaigns
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Connected platforms</CardTitle>
              <CardDescription>
                Where Gituas can publish, run ads, and read analytics.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/dashboard/integrations">
                <Button variant="outline" size="sm" className="w-full">
                  Manage integrations
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Activity</CardTitle>
              <CardDescription>
                Every AI action with reasoning.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`/dashboard/activity?projectId=${project.id}`}>
                <Button variant="outline" size="sm" className="w-full">
                  View activity
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
