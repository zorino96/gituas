"use client";

import { useState, useTransition } from "react";
import { Sparkles, RefreshCw, AlertTriangle, Megaphone, Lightbulb } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { generatePersonality } from "@/app/dashboard/projects/[id]/personality-actions";
import type { ProjectPersonality } from "@/lib/personality";

export interface PersonalityPanelProps {
  projectId: string;
  personality: ProjectPersonality | null;
  generatedAt: Date | null;
  enabled: boolean;
}

export function PersonalityPanel({
  projectId,
  personality,
  generatedAt,
  enabled,
}: PersonalityPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [optimisticPersonality, setOptimisticPersonality] = useState(personality);

  const handleGenerate = () => {
    if (!enabled) {
      toast.error("GOOGLE_AI_API_KEY not configured — add it to .env or Settings");
      return;
    }
    startTransition(async () => {
      const toastId = toast.loading("Claude is reading your repo… (20–60s)");
      try {
        await generatePersonality(projectId);
        toast.success("Personality generated", { id: toastId });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Generation failed", { id: toastId });
        setOptimisticPersonality(personality);
      }
    });
  };

  const display = optimisticPersonality ?? personality;

  if (!display) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4" />
            Project personality
          </CardTitle>
          <CardDescription>
            Gemini reads your repo and produces a profile that drives every downstream agent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleGenerate} disabled={isPending || !enabled} className="w-full">
            {isPending ? (
              <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Generating…</>
            ) : (
              <><Sparkles className="mr-2 h-4 w-4" /> Generate</>
            )}
          </Button>
          {!enabled && (
            <p className="mt-3 text-xs text-muted-foreground">
              Set <code className="rounded bg-muted px-1 font-mono">GOOGLE_AI_API_KEY</code> in <code className="rounded bg-muted px-1 font-mono">.env</code> to enable.
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
            <CardTitle className="text-2xl">{display.productName}</CardTitle>
            <CardDescription className="mt-1 text-base">{display.elevatorPitch}</CardDescription>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{display.category.replace(/_/g, " ").toLowerCase()}</Badge>
              <Badge variant="outline">{display.toneOfVoice.toLowerCase()}</Badge>
              {generatedAt && (
                <span className="text-xs text-muted-foreground">
                  Generated {new Date(generatedAt).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={handleGenerate} disabled={isPending}>
            {isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-8">
        {/* Value prop */}
        <Section title="Value proposition">
          <p className="text-sm">{display.valueProposition}</p>
        </Section>

        {/* Audience */}
        <Section title="Audience">
          <p className="text-sm font-medium">{display.audience.primary}</p>
          <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
            {display.audience.personas.map((p) => (
              <li key={p} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/40" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </Section>

        {/* Unique angle */}
        <Section title="Unique angle">
          <p className="text-sm text-muted-foreground">{display.uniqueAngle}</p>
        </Section>

        {/* Tech stack */}
        {display.techStack.length > 0 && (
          <Section title="Tech stack">
            <div className="flex flex-wrap gap-1.5">
              {display.techStack.map((tech) => (
                <Badge key={tech} variant="outline" className="font-normal">{tech}</Badge>
              ))}
            </div>
          </Section>
        )}

        {/* Brand colors */}
        {display.brandColors.length > 0 && (
          <Section title="Brand colors">
            <div className="flex flex-wrap gap-2">
              {display.brandColors.map((hex) => (
                <div key={hex} className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1">
                  <span className="h-4 w-4 rounded-sm border" style={{ backgroundColor: hex }} />
                  <span className="font-mono text-xs">{hex}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Pricing */}
        <Section title="Pricing">
          <p className="text-sm">
            <span className="font-medium">Model: </span>
            <Badge variant="outline" className="font-normal">{display.pricing.model.toLowerCase()}</Badge>
          </p>
          {display.pricing.detectedTiers.length > 0 && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {display.pricing.detectedTiers.map((tier) => (
                <div key={tier.name} className="rounded-md border p-3">
                  <div className="flex items-baseline justify-between">
                    <p className="font-medium">{tier.name}</p>
                    <p className="font-mono text-sm">
                      {tier.monthlyPriceUsd != null ? `$${tier.monthlyPriceUsd}/mo` : "—"}
                    </p>
                  </div>
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {tier.highlights.map((h) => <li key={h}>· {h}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Competitors */}
        {display.competitors.length > 0 && (
          <Section title="Likely competitors">
            <div className="flex flex-wrap gap-1.5">
              {display.competitors.map((c) => (
                <Badge key={c} variant="outline" className="font-normal">{c}</Badge>
              ))}
            </div>
          </Section>
        )}

        {/* Marketing channels */}
        <Section title="Best marketing channels" icon={<Megaphone className="h-4 w-4" />}>
          <div className="flex flex-wrap gap-1.5">
            {display.bestMarketingChannels.map((ch) => (
              <Badge key={ch} variant="secondary" className="font-normal">{ch.replace(/_/g, " ").toLowerCase()}</Badge>
            ))}
          </div>
        </Section>

        {/* Content ideas */}
        <Section title="Content ideas" icon={<Lightbulb className="h-4 w-4" />}>
          <ol className="space-y-2 text-sm">
            {display.contentIdeas.map((idea, i) => (
              <li key={i} className="flex gap-3">
                <span className="font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                <span>{idea}</span>
              </li>
            ))}
          </ol>
        </Section>

        {/* Risk flags */}
        {display.riskFlags.length > 0 && (
          <Section title="Risk flags" icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {display.riskFlags.map((r) => (
                <li key={r} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </CardContent>
    </Card>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  );
}
