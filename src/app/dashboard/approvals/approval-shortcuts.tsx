"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { approveRequest, rejectRequest } from "./actions";

export function ApprovalShortcuts({ ids }: { ids: string[] }) {
  const [cursor, setCursor] = useState(0);
  const [, startTransition] = useTransition();
  const idsRef = useRef(ids);
  useEffect(() => { idsRef.current = ids; }, [ids]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement) {
        const tag = e.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
      }
      const list = idsRef.current;
      if (list.length === 0) return;
      const id = list[cursor];

      if (e.key === "a" || e.key === "A") {
        startTransition(async () => {
          try { await approveRequest(id); toast.success("approved"); }
          catch (err) { toast.error(err instanceof Error ? err.message : "fail"); }
        });
      } else if (e.key === "r" || e.key === "R") {
        startTransition(async () => {
          try { await rejectRequest(id); toast.success("rejected"); }
          catch (err) { toast.error(err instanceof Error ? err.message : "fail"); }
        });
      } else if (e.key === "j" || e.key === "ArrowDown") {
        setCursor((c) => Math.min(c + 1, list.length - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        setCursor((c) => Math.max(c - 1, 0));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cursor]);

  return null;
}
