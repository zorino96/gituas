"use client";

import { useState, useTransition } from "react";
import { Key, Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { saveAiKeys } from "./settings-actions";

export function AiKeysForm({
  hasAnthropic,
  hasGoogle,
  hasOpenAi,
}: {
  hasAnthropic: boolean;
  hasGoogle: boolean;
  hasOpenAi: boolean;
}) {
  const [anthropic, setAnthropic] = useState("");
  const [google, setGoogle] = useState("");
  const [openai, setOpenai] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleSave = () => {
    startTransition(async () => {
      try {
        await saveAiKeys({
          anthropic: anthropic || undefined,
          google: google || undefined,
          openai: openai || undefined,
        });
        toast.success("Keys saved (encrypted)");
        setAnthropic("");
        setGoogle("");
        setOpenai("");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  };

  return (
    <div className="space-y-4">
      <KeyField
        label="Anthropic API key"
        placeholder="sk-ant-..."
        value={anthropic}
        onChange={setAnthropic}
        configured={hasAnthropic}
      />
      <KeyField
        label="Google AI (Gemini) API key"
        placeholder="AIza..."
        value={google}
        onChange={setGoogle}
        configured={hasGoogle}
      />
      <KeyField
        label="OpenAI API key"
        placeholder="sk-..."
        value={openai}
        onChange={setOpenai}
        configured={hasOpenAi}
      />
      <Button onClick={handleSave} disabled={isPending} className="w-full">
        <Key className="mr-2 h-4 w-4" />
        {isPending ? "Saving…" : "Save keys"}
      </Button>
    </div>
  );
}

function KeyField({
  label,
  placeholder,
  value,
  onChange,
  configured,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  configured: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">{label}</label>
        {configured && (
          <span className="inline-flex items-center gap-1 text-xs text-green-600">
            <Check className="h-3 w-3" /> Configured
          </span>
        )}
      </div>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={configured ? "(leave blank to keep current)" : placeholder}
        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
      />
    </div>
  );
}
