"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useT } from "@/lib/i18n/client";
import { friendlyError } from "../format";
import type { ActionResult } from "./actions";

/** Plain, serialisable views of the store — Dates arrive as ISO strings. */
export interface StoreSettings {
  automationEnabled: boolean;
  expiryDays: number;
  stopBefore: string;
  likeComments: boolean;
  autoHideSpam: boolean;
  deliveryFee: string;
  deliveryTime: string;
  defaultDm: string;
}

export interface StoreView extends StoreSettings {
  id: string;
  defaultTemplateId: string | null;
  pausedReason: string | null;
  webhooksAt: string | null;
}

export interface TemplateView {
  id: string;
  name: string;
  publicSamples: string[];
  thanksSamples: string[];
  dmGreeting: boolean;
  whatsappAlways: boolean;
}

export interface PostAutoView {
  enabled: boolean;
  productId: string | null;
  templateId: string | null;
  activeUntil: string;
}

export interface PostView {
  platform: "FB" | "IG";
  id: string;
  caption: string;
  thumbUrl: string | null;
  createdAt: string | null;
}

export interface Usage {
  plan: string;
  activePosts: number;
  postSlots: number | null;
  sentToday: number;
  cap: number;
  aiUsed: number;
  aiLimit: number;
}

export type Message = { ok: boolean; text: string } | null;

/** One save at a time: pending flag, inline gm-ok / gm-err message, and a refresh of the server data on success. */
export function useSaver() {
  const router = useRouter();
  const t = useT();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<Message>(null);

  function run(fn: () => Promise<ActionResult>, onOk?: () => void, onFail?: () => void) {
    setMessage(null);
    start(async () => {
      let r: ActionResult;
      try {
        r = await fn();
      } catch {
        r = { ok: false, error: friendlyError(undefined, t) };
      }
      if (r.ok) {
        setMessage({ ok: true, text: t.automation.saved });
        onOk?.();
        router.refresh();
      } else {
        setMessage({ ok: false, text: r.error });
        onFail?.();
      }
    });
  }

  return { pending, message, setMessage, run };
}

export function SaveMessage({ message }: { message: Message }) {
  return message ? <p className={message.ok ? "gm-ok" : "gm-err"}>{message.text}</p> : null;
}

export function Knob({ checked, label, disabled, onClick }: { checked: boolean; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="gm-knob" disabled={disabled} onClick={onClick}>
      <i />
    </button>
  );
}

export function SwitchRow({ label, hint, checked, disabled, onToggle }: { label: string; hint?: string; checked: boolean; disabled?: boolean; onToggle: () => void }) {
  return (
    <div className="gm-target">
      <div>
        <p>{label}</p>
        {hint && <small>{hint}</small>}
      </div>
      <Knob checked={checked} label={label} disabled={disabled} onClick={onToggle} />
    </div>
  );
}
