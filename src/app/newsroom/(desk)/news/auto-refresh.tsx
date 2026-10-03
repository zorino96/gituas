"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

import { useT } from "@/lib/i18n/client";

/**
 * Re-reads the page every `refreshSec` seconds while the tab is in front, so new stories show up
 * without a click. It pauses while the tab is hidden, catches up once when it comes back, and
 * never starts a refresh while the last one is still running. `label` is the interval in words
 * ("هەر خولەکێک"), worked out on the server in the desk's language.
 */
export function AutoRefresh({ refreshSec, label }: { refreshSec: number; label: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const busy = useRef(false);
  useEffect(() => {
    busy.current = pending;
  }, [pending]);

  useEffect(() => {
    const every = Math.max(5, refreshSec) * 1000;
    let timer: ReturnType<typeof setInterval> | undefined;
    let last = Date.now();

    const run = () => {
      if (document.visibilityState !== "visible" || busy.current) return;
      last = Date.now();
      start(() => router.refresh());
    };
    const disarm = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const arm = () => {
      disarm();
      timer = setInterval(run, every);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (Date.now() - last >= every) run();
        arm();
      } else {
        disarm();
      }
    };

    if (document.visibilityState === "visible") arm();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disarm();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshSec, router, start]);

  return <p className="gm-hint">{t.nr.news.list.autoRefresh(label)}</p>;
}
