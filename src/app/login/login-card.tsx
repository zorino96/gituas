"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

import { GithubIcon } from "@/components/icons/github";

export function LoginCard() {
  const [busy, setBusy] = useState(false);

  return (
    <div className="min-h-screen grid place-items-center px-6 bg-bg text-fg">
      <div className="w-full max-w-sm rounded-xl border border-line bg-panel p-8 shadow-money-lg">
        <div className="flex flex-col items-center gap-2">
          <div className="h-10 w-10 rounded-md bg-money grid place-items-center font-bold text-bg">G</div>
          <h1 className="text-2xl font-light tracking-tight mt-3">give it to us and sleep</h1>
          <p className="text-sm text-fg-dim text-center font-mono">
            sign in with github · we'll read your repo so gemini can write the plan.
          </p>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void signIn("github", { callbackUrl: "/dashboard" });
          }}
          className="mt-8 w-full rounded-md bg-money text-bg px-4 py-2.5 font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50 shadow-money"
        >
          <GithubIcon className="h-4 w-4" />
          {busy ? "redirecting…" : "continue with github"}
        </button>

        <div className="mt-6 text-center font-mono text-[10px] text-fg-dim uppercase tracking-wider">
          no credit card · 7-day shadow mode
        </div>
      </div>
    </div>
  );
}
