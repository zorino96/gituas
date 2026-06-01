"use client";

import { useState, useTransition } from "react";
import { Calendar, RefreshCw, Sparkles, ArrowUpRight, Target, AlertTriangle, Zap } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { generatePlan } from "@/app/dashboard/projects/[id]/marketing-plan-actions";
import type { MarketingPlan } from "@/lib/marketing-plan";

export interface MarketingPlanPanelProps {
  projectId: string;
  plan: MarketingPlan | null;
  generatedAt: Date | null;
  hasPersonality: boolean;
  enabled: boolean;
}

type Tab = "Calendar" | "Ads" | "KPIs" | "Risks";

export function MarketingPlanPanel({
  projectId,
  plan,
  generatedAt,
  hasPersonality,
  enabled,
}: MarketingPlanPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>("Calendar");

  const handleGenerate = () => {
    if (!enabled) {
      toast.error("GOOGLE_AI_API_KEY not configured");
      return;
    }
    if (!hasPersonality) {
      toast.error("Generate the Project Personality first");
      return;
    }
    startTransition(async () => {
      const toastId = toast.loading("Gemini is drafting your 30-day plan… (20–40s)");
      try {
        await generatePlan(projectId);
        toast.success("Marketing plan generated", { id: toastId });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Generation failed", { id: toastId });
      }
    });
  };

  if (!plan) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="h-4 w-4" />
            30-day marketing plan
          </CardTitle>
          <CardDescription>
            Gemini turns the Personality into a weekly theme calendar, 12 content posts, and ad campaigns.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={handleGenerate}
            disabled={isPending || !enabled || !hasPersonality}
            className="w-full"
          >
            {isPending ? (
              <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Generating…</>
            ) : (
              <><Sparkles className="mr-2 h-4 w-4" /> Generate 30-day plan</>
            )}
          </Button>
          {!hasPersonality && (
            <p className="mt-3 text-xs text-muted-foreground">
              Generate the Project Personality above first.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="h-4 w-4" />
              30-day marketing plan
            </CardTitle>
            <p className="mt-2 font-medium">{plan.positioning}</p>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{plan.strategy}</p>
            {generatedAt && (
              <p className="mt-2 text-xs text-muted-foreground">
                Drafted {new Date(generatedAt).toLocaleDateString()}
              </p>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={handleGenerate} disabled={isPending}>
            <RefreshCw className={cn("h-4 w-4", isPending && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {plan.earlyWins?.length > 0 && (
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Zap className="h-3.5 w-3.5" /> Early wins this week
            </div>
            <ul className="space-y-1.5 text-sm">
              {plan.earlyWins.map((w, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/50" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="inline-flex w-full rounded-md border border-border p-1 bg-muted/30">
          {(["Calendar", "Ads", "KPIs", "Risks"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "flex-1 rounded-sm px-3 py-1.5 text-sm",
                tab === t ? "bg-background shadow-sm" : "hover:bg-background/60",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "Calendar" && (
          <div className="space-y-6">
            <div>
              <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Weekly themes
              </h4>
              <div className="grid gap-3 sm:grid-cols-2">
                {plan.weeklyThemes.map((w) => (
                  <div key={w.weekNumber} className="rounded-md border border-border p-3">
                    <div className="text-xs text-muted-foreground">Week {w.weekNumber}</div>
                    <div className="font-medium mt-0.5">{w.theme}</div>
                    <p className="mt-1.5 text-sm text-muted-foreground">{w.goal}</p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Content items ({plan.contentItems.length})
              </h4>
              <div className="space-y-3">
                {plan.contentItems.map((c, i) => (
                  <div key={i} className="rounded-md border border-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-muted-foreground">D{c.day}</span>
                        <Badge variant="secondary">{c.platform.toLowerCase().replace(/_/g, " ")}</Badge>
                        <Badge variant="outline">{c.format.toLowerCase()}</Badge>
                      </div>
                      <button className="inline-flex items-center text-xs hover:underline">
                        Use this <ArrowUpRight className="ml-0.5 h-3 w-3" />
                      </button>
                    </div>
                    <p className="mt-2 font-medium">{c.hook}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{c.brief}</p>
                    {c.hashtags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {c.hashtags.map((h) => (
                          <Badge key={h} variant="outline" className="font-mono font-normal">
                            #{h.replace(/^#/, "")}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <p className="mt-3 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">CTA:</span> {c.cta}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "Ads" && (
          <div className="space-y-4">
            {plan.adCampaigns.map((a) => (
              <div key={a.name} className="rounded-md border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{a.name}</div>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge variant="secondary">{a.platform.toLowerCase().replace(/_/g, " ")}</Badge>
                      <Badge variant="outline">{a.objective.toLowerCase().replace(/_/g, " ")}</Badge>
                    </div>
                  </div>
                  <div className="font-mono text-sm">${a.monthlyBudgetUsd}/mo</div>
                </div>
                <Section title="Targeting"><p className="text-sm">{a.audienceTargeting}</p></Section>
                <Section title="Copy">
                  <pre className="whitespace-pre-wrap rounded bg-muted/40 p-3 font-mono text-xs">{a.adCopy}</pre>
                </Section>
                <Section title="Creative direction"><p className="text-sm">{a.creativeDirection}</p></Section>
                <Section title="Target KPI"><p className="text-sm font-medium">{a.kpiTarget}</p></Section>
              </div>
            ))}
            <div className="rounded-md border border-border p-3 text-sm">
              Total monthly ad budget: <span className="font-mono font-medium">${plan.adCampaigns.reduce((s, a) => s + a.monthlyBudgetUsd, 0)}</span>
              <span className="text-muted-foreground"> Across {plan.adCampaigns.length} campaigns.</span>
            </div>
          </div>
        )}

        {tab === "KPIs" && (
          <div>
            <h4 className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Target className="h-3.5 w-3.5" /> Track these
            </h4>
            <div className="space-y-2">
              {plan.kpis.map((k) => (
                <div key={k} className="rounded-md border border-border px-3 py-2 text-sm">
                  <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-blue-500 align-middle" />
                  {k}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "Risks" && (
          <div>
            <h4 className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5" /> Risks to mitigate
            </h4>
            <div className="space-y-2">
              {plan.risks.map((r, i) => (
                <div key={i} className="rounded-md border border-border px-4 py-2.5 text-sm">
                  <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" />
                  {r}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <h5 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h5>
      <div className="mt-1">{children}</div>
    </div>
  );
}
