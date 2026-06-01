"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { approveRequest, rejectRequest } from "./actions";

export function ApprovalActions({ approvalId }: { approvalId: string }) {
  const [isPending, startTransition] = useTransition();

  const onApprove = () => {
    startTransition(async () => {
      try { await approveRequest(approvalId); toast.success("approved"); }
      catch (err) { toast.error(err instanceof Error ? err.message : "fail"); }
    });
  };
  const onReject = () => {
    startTransition(async () => {
      try { await rejectRequest(approvalId); toast.success("rejected"); }
      catch (err) { toast.error(err instanceof Error ? err.message : "fail"); }
    });
  };

  return (
    <div className="mt-4 flex gap-2 font-mono text-xs">
      <button
        onClick={onApprove}
        disabled={isPending}
        className="px-3 py-1.5 rounded bg-money text-bg disabled:opacity-50"
      >
        ✓ approve
      </button>
      <button
        onClick={onReject}
        disabled={isPending}
        className="px-3 py-1.5 rounded border border-line text-fg-dim hover:text-fg disabled:opacity-50"
      >
        ✕ reject
      </button>
      <button className="px-3 py-1.5 rounded border border-line text-fg-dim hover:text-fg">
        ✎ edit
      </button>
    </div>
  );
}
