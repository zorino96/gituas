"use client";

import { useState, useTransition } from "react";
import { Sparkles, PencilLine, Power, Megaphone, MessageSquare, MessagesSquare, TrendingUp, FileText } from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { updateMode } from "@/app/dashboard/projects/[id]/mode-actions";
import type { AgentMode, MasterMode } from "@/generated/prisma/client";

export interface ModeSwitchProps {
  projectId: string;
  initial: {
    masterMode: MasterMode;
    adsMode: AgentMode;
    contentMode: AgentMode;
    replyMode: AgentMode;
    commentMode: AgentMode;
    scalingMode: AgentMode;
    requireApproval: boolean;
  };
}

const AGENT_OPTIONS: AgentMode[] = ["OFF", "MANUAL", "AUTO"];

export function ModeSwitch({ projectId, initial }: ModeSwitchProps) {
  const [state, setState] = useState(initial);
  const [, startTransition] = useTransition();

  const apply = (patch: Partial<typeof state>) => {
    setState((s) => ({ ...s, ...patch }));
    startTransition(async () => {
      try {
        await updateMode(projectId, patch);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update mode");
        setState(initial);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base">Operating mode</CardTitle>
            <CardDescription>
              {state.masterMode === "AUTO"
                ? "Gituas is in the driver's seat. AI initiates and executes everything."
                : "You're in the driver's seat. AI amplifies and distributes what you create."}
            </CardDescription>
          </div>
          <Badge variant={state.masterMode === "AUTO" ? "default" : "secondary"}>
            {state.masterMode === "AUTO" ? <Sparkles className="h-3 w-3 mr-1" /> : <PencilLine className="h-3 w-3 mr-1" />}
            {state.masterMode}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-3">
          <MasterCard
            mode="MANUAL"
            icon={<PencilLine className="h-4 w-4" />}
            label="Manual"
            tagline="Prompt it, we spread it"
            selected={state.masterMode === "MANUAL"}
            onClick={() => apply({ masterMode: "MANUAL" })}
          />
          <MasterCard
            mode="AUTO"
            icon={<Sparkles className="h-4 w-4" />}
            label="Auto"
            tagline="Give it to us and sleep"
            selected={state.masterMode === "AUTO"}
            onClick={() => apply({ masterMode: "AUTO" })}
          />
        </div>

        <div className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
          <div>
            <div className="text-sm font-medium">Require approval before publishing</div>
            <div className="text-xs text-muted-foreground">
              Every outbound action waits for your green light. Recommended for Manual mode.
            </div>
          </div>
          <Switch
            checked={state.requireApproval}
            onCheckedChange={(v) => apply({ requireApproval: v })}
          />
        </div>

        <div>
          <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Per-agent controls
          </h4>
          <div className="space-y-2">
            <AgentRow
              icon={<FileText className="h-4 w-4" />}
              label="Content"
              hint="Posts, captions, multi-format publisher"
              value={state.contentMode}
              onChange={(v) => apply({ contentMode: v })}
            />
            <AgentRow
              icon={<Megaphone className="h-4 w-4" />}
              label="Ads"
              hint="Meta, TikTok, Google Ads campaigns"
              value={state.adsMode}
              onChange={(v) => apply({ adsMode: v })}
            />
            <AgentRow
              icon={<MessageSquare className="h-4 w-4" />}
              label="Replies"
              hint="DMs, emails, voice messages"
              value={state.replyMode}
              onChange={(v) => apply({ replyMode: v })}
            />
            <AgentRow
              icon={<MessagesSquare className="h-4 w-4" />}
              label="Comments"
              hint="Comment threads on your posts"
              value={state.commentMode}
              onChange={(v) => apply({ commentMode: v })}
            />
            <AgentRow
              icon={<TrendingUp className="h-4 w-4" />}
              label="Scaling"
              hint="Budget reallocation, growth decisions"
              value={state.scalingMode}
              onChange={(v) => apply({ scalingMode: v })}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MasterCard({
  mode,
  icon,
  label,
  tagline,
  selected,
  onClick,
}: {
  mode: MasterMode;
  icon: React.ReactNode;
  label: string;
  tagline: string;
  selected: boolean;
  onClick: () => void;
}) {
  void mode;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border p-3 text-left transition-colors",
        selected ? "border-foreground bg-muted/50" : "border-border hover:bg-muted/30",
      )}
    >
      <div className="flex items-center gap-2 font-medium">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">{tagline}</div>
    </button>
  );
}

function AgentRow({
  icon,
  label,
  hint,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  value: AgentMode;
  onChange: (v: AgentMode) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-md bg-muted grid place-items-center">{icon}</div>
        <div>
          <div className="text-sm font-medium">{label}</div>
          <div className="text-xs text-muted-foreground">{hint}</div>
        </div>
      </div>
      <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
        {AGENT_OPTIONS.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={cn(
              "px-2.5 py-1 inline-flex items-center gap-1 transition-colors",
              value === opt ? "bg-muted font-medium" : "hover:bg-muted/30",
            )}
          >
            {opt === "OFF" && <Power className="h-3 w-3" />}
            {opt === "MANUAL" && <PencilLine className="h-3 w-3" />}
            {opt === "AUTO" && <Sparkles className="h-3 w-3" />}
            {opt.charAt(0) + opt.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
    </div>
  );
}
