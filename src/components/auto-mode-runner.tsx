"use client";

import { Sparkles, Activity, Clock } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AgentMode } from "@/generated/prisma/client";

export interface AutoModeRunnerProps {
  projectId: string;
  contentMode: AgentMode;
  requireApproval: boolean;
  planProgress: {
    consumed: number;
    total: number;
    remaining: number;
    nextItemHook: string | null;
    nextItemDay: number | null;
  } | null;
  recentRuns: Array<{
    id: string;
    action: string;
    reasoning: string | null;
    createdAt: Date;
    contentPostId: string | null;
  }>;
}

export function AutoModeRunner({
  projectId,
  contentMode,
  requireApproval,
  planProgress,
  recentRuns,
}: AutoModeRunnerProps) {
  void projectId;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4" />
              Auto-mode runner
            </CardTitle>
            <CardDescription>
              Content agent picks the next plan item, produces a post, and {requireApproval ? "queues it for approval." : "publishes it."}
            </CardDescription>
          </div>
          <Badge variant={contentMode === "AUTO" ? "default" : "secondary"}>{contentMode}</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {planProgress ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Consumed" value={planProgress.consumed} />
            <Stat label="Remaining" value={planProgress.remaining} />
            <Stat label="Total" value={planProgress.total} />
          </div>
        ) : (
          <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
            No active marketing plan — generate one to give the content agent something to do.
          </div>
        )}

        {planProgress?.nextItemHook && (
          <div className="rounded-md border border-border p-3">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Next up · Day {planProgress.nextItemDay}
            </div>
            <div className="mt-1 text-sm">{planProgress.nextItemHook}</div>
          </div>
        )}

        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <Activity className="h-3.5 w-3.5" /> Recent auto-runs
          </h4>
          {recentRuns.length === 0 ? (
            <div className="rounded-md border border-border p-3 text-sm text-muted-foreground">
              No auto-runs yet. The cron will pick this up on the next tick.
            </div>
          ) : (
            <ul className="space-y-2">
              {recentRuns.map((r) => (
                <li key={r.id} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono">{r.action}</span>
                    <span className="text-muted-foreground inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(r.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  {r.reasoning && (
                    <p className="mt-1 text-sm text-muted-foreground">{r.reasoning}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-xl font-semibold">{value}</div>
    </div>
  );
}
