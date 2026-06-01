"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

import { GithubIcon } from "@/components/icons/github";

export function LoginCard() {
  const [busy, setBusy] = useState(false);

  return (
    <div className="relative min-h-screen grid place-items-center px-6 text-fg overflow-hidden">
      <div className="nightsky" aria-hidden>
        <div className="aurora" />
        <div className="stars" />
        <div className="stars-2" />
        <div className="grain" />
        <div className="vignette" />
      </div>

      {/* a low moon behind the card */}
      <div
        className="pointer-events-none absolute opacity-80"
        style={{ width: 260, height: 260, top: "9%", left: "50%", transform: "translateX(-50%)" }}
        aria-hidden
      >
        <span className="moon block w-full h-full" />
      </div>

      <div className="reveal relative z-10 w-full max-w-sm rounded-2xl border border-line bg-panel/80 backdrop-blur-xl p-9 shadow-money-lg">
        <div className="flex flex-col items-center text-center">
          <span className="moon" style={{ width: 40, height: 40 }} />
          <h1 className="font-display text-3xl mt-5 leading-tight">
            <span className="italic font-light">close the laptop.</span>
            <br />we&apos;ll take the night.
          </h1>
          <p className="text-sm text-fg-dim mt-3 font-mono">
            sign in with github · gemini reads the repo and writes the plan.
          </p>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void signIn("github", { callbackUrl: "/dashboard" });
          }}
          className="group mt-8 w-full rounded-full bg-money text-bg px-4 py-3 font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50 shadow-money hover:shadow-money-lg transition-all"
        >
          <GithubIcon className="h-4 w-4" />
          {busy ? "entering the night desk…" : "continue with github"}
          {!busy && <span className="transition-transform group-hover:translate-x-1">→</span>}
        </button>

        <div className="mt-6 text-center font-mono text-[10px] tracking-[0.2em] uppercase text-fg-dim">
          no card · 7-day shadow mode
        </div>
      </div>
    </div>
  );
}
