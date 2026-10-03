"use client";

import { useActionState } from "react";
import { signOut } from "next-auth/react";

import { useT } from "@/lib/i18n/client";
import { acceptInviteAction, type JoinResult } from "./actions";

export function JoinButton({ token }: { token: string }) {
  const [state, action, pending] = useActionState<JoinResult | null, FormData>(acceptInviteAction, null);
  const t = useT().nr.shell.join;
  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />
      <button type="submit" className="gm-btn block" disabled={pending}>
        {pending ? t.wait : t.enter}
      </button>
      {state && <p className="gm-err" role="alert">{state.error}</p>}
    </form>
  );
}

export function SwitchAccountButton({ next }: { next: string }) {
  const t = useT().nr.shell.join;
  return (
    <button type="button" className="gm-btn quiet block" onClick={() => signOut({ callbackUrl: `/login?next=${encodeURIComponent(next)}` })}>
      {t.switchAccount}
    </button>
  );
}
