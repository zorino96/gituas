"use client";

import { useActionState } from "react";
import { signOut } from "next-auth/react";

import { acceptInviteAction, type JoinResult } from "./actions";

export function JoinButton({ token }: { token: string }) {
  const [state, action, pending] = useActionState<JoinResult | null, FormData>(acceptInviteAction, null);
  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />
      <button type="submit" className="gm-btn block" disabled={pending}>
        {pending ? "چاوەڕێ بکە…" : "بچۆ ناو مێزەکە"}
      </button>
      {state && <p className="gm-err" role="alert">{state.error}</p>}
    </form>
  );
}

export function SwitchAccountButton({ next }: { next: string }) {
  return (
    <button type="button" className="gm-btn quiet block" onClick={() => signOut({ callbackUrl: `/login?next=${encodeURIComponent(next)}` })}>
      بە هەژمارێکی تر بچۆ ژوورەوە
    </button>
  );
}
