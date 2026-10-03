"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useT } from "@/lib/i18n/client";
import { INVITABLE_ROLES, type Role } from "@/lib/newsroom/roles";
import {
  changeRoleAction,
  inviteMemberAction,
  removeMemberAction,
  resendInviteAction,
  revokeInviteAction,
  type TeamResult,
} from "./actions";

type Member = { id: string; name: string; email: string; role: Role };
type Invite = { id: string; email: string; role: Role; expired: boolean };

export function TeamClient(props: { canManage: boolean; seats: number; left: number; members: Member[]; invites: Invite[] }) {
  const { canManage, seats, left, members, invites } = props;
  const t = useT().nr.team;
  const label = t.roles.label;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("MEMBER");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [link, setLink] = useState<{ url: string; emailed: boolean } | null>(null);

  function run(task: () => Promise<TeamResult>, done?: string) {
    setMsg(null);
    start(async () => {
      const r = await task();
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      if (r.link) setLink({ url: r.link, emailed: !!r.emailed });
      if (done) setMsg({ ok: true, text: done });
      router.refresh();
    });
  }

  return (
    <div className="gm-stack">
      <div className="gm-between">
        <h2 className="gm-title kufi">{t.page.title}</h2>
        <small className="gm-sub" style={{ margin: 0 }}>
          {t.page.seats(seats - left, seats)}
        </small>
      </div>

      <div className="nr-split">
        <div className="nr-split-aside gm-stack">
          <div className="gm-card">
            {(["OWNER", "ADMIN", "MEMBER"] as Role[]).map((r) => (
              <p key={r} style={{ margin: "4px 0" }}>
                <b>{label[r]}</b>: <span className="gm-sub">{t.roles.help[r]}</span>
              </p>
            ))}
          </div>

          {canManage && (
            <form
              className="gm-card gm-stack"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => inviteMemberAction({ email, role }), t.invite.created);
              }}
            >
              <div className="gm-field">
                <label htmlFor="invite-email">{t.invite.email}</label>
                <input id="invite-email" className="gm-input gm-ltr" dir="ltr" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="gm-field">
                <label htmlFor="invite-role">{t.invite.role}</label>
                <select id="invite-role" className="gm-input" value={role} onChange={(e) => setRole(e.target.value)}>
                  {INVITABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {label[r]}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="gm-btn" disabled={pending || !email || left === 0}>
                {t.invite.submit}
              </button>
              {left === 0 && <p className="gm-hint">{t.errors.seatsFull}</p>}
            </form>
          )}

          {link && (
            <div className="gm-card gm-stack" role="status">
              <p style={{ margin: 0 }}>
                {link.emailed ? t.invite.emailed : t.invite.notEmailed}
              </p>
              <input className="gm-input gm-ltr" dir="ltr" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} aria-label={t.invite.linkLabel} />
              <button type="button" className="gm-btn quiet small" onClick={() => void navigator.clipboard?.writeText(link.url).then(() => setMsg({ ok: true, text: t.invite.copied }))}>
                {t.invite.copy}
              </button>
            </div>
          )}

          {msg && <p className={msg.ok ? "gm-ok" : "gm-err"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
        </div>

        <div className="nr-split-main gm-stack">
          <h3 className="gm-sec">{t.members.title}</h3>
          <div className="gm-card">
            {members.map((m) => (
              <div key={m.id} className="gm-target">
                <div>
                  <p>{m.name || m.email}</p>
                  <small className="gm-ltr" dir="ltr">{m.email}</small>
                </div>
                {canManage && m.role !== "OWNER" ? (
                  <div className="gm-row" style={{ gap: 6 }}>
                    <select
                      className="gm-input"
                      style={{ width: "auto" }}
                      aria-label={t.members.roleOf(m.name || m.email)}
                      value={m.role}
                      disabled={pending}
                      onChange={(e) => run(() => changeRoleAction(m.id, e.target.value), t.members.roleChanged)}
                    >
                      {INVITABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {label[r]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="gm-btn quiet small"
                      disabled={pending}
                      onClick={() => confirm(t.members.confirmRemove(m.name || m.email)) && run(() => removeMemberAction(m.id), t.members.removed)}
                    >
                      {t.members.remove}
                    </button>
                  </div>
                ) : (
                  <span className="gm-badge ghost">{label[m.role]}</span>
                )}
              </div>
            ))}
          </div>

          {invites.length > 0 && (
            <>
              <h3 className="gm-sec">{t.invites.title}</h3>
              <div className="gm-card">
                {invites.map((i) => (
                  <div key={i.id} className="gm-target">
                    <div>
                      <p className="gm-ltr" dir="ltr">{i.email}</p>
                      <small>
                        {label[i.role]} {i.expired && <span className="gm-badge warn">{t.invites.expired}</span>}
                      </small>
                    </div>
                    {canManage && (
                      <div className="gm-row" style={{ gap: 6 }}>
                        <button type="button" className="gm-btn quiet small" disabled={pending} onClick={() => run(() => resendInviteAction(i.id), t.invites.resent)}>
                          {t.invites.resend}
                        </button>
                        <button type="button" className="gm-btn quiet small" disabled={pending} onClick={() => run(() => revokeInviteAction(i.id), t.invites.revoked)}>
                          {t.invites.revoke}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
