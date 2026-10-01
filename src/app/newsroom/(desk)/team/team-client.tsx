"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { num } from "@/app/app/format";
import { INVITABLE_ROLES, ROLE_LABEL, type Role } from "@/lib/newsroom/roles";
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

const ROLE_HELP: Record<Role, string> = {
  OWNER: "هەموو شتێک، لەوانە تیم و پلان.",
  ADMIN: "بڵاوکردنەوە، وەڵامی کۆمێنت و نامە، و ڕێکخستنی سەرچاوە و براند.",
  MEMBER: "هەواڵ و کارت ئامادە دەکات، بەڵام بڵاوی ناکاتەوە.",
};

export function TeamClient(props: { canManage: boolean; seats: number; left: number; members: Member[]; invites: Invite[] }) {
  const { canManage, seats, left, members, invites } = props;
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
        <h2 className="gm-title kufi">تیم</h2>
        <small className="gm-sub" style={{ margin: 0 }}>
          {num(seats - left)} / {num(seats)} شوێن
        </small>
      </div>

      <div className="nr-split">
        <div className="nr-split-aside gm-stack">
          <div className="gm-card">
            {(["OWNER", "ADMIN", "MEMBER"] as Role[]).map((r) => (
              <p key={r} style={{ margin: "4px 0" }}>
                <b>{ROLE_LABEL[r]}</b>: <span className="gm-sub">{ROLE_HELP[r]}</span>
              </p>
            ))}
          </div>

          {canManage && (
            <form
              className="gm-card gm-stack"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => inviteMemberAction({ email, role }), "بانگهێشتەکە دروست کرا.");
              }}
            >
              <div className="gm-field">
                <label htmlFor="invite-email">ئیمەیڵ</label>
                <input id="invite-email" className="gm-input gm-ltr" dir="ltr" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="gm-field">
                <label htmlFor="invite-role">ڕۆڵ</label>
                <select id="invite-role" className="gm-input" value={role} onChange={(e) => setRole(e.target.value)}>
                  {INVITABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="gm-btn" disabled={pending || !email || left === 0}>
                بانگهێشت بکە
              </button>
              {left === 0 && <p className="gm-hint">هەموو شوێنەکانی پلانەکەت پڕن.</p>}
            </form>
          )}

          {link && (
            <div className="gm-card gm-stack" role="status">
              <p style={{ margin: 0 }}>
                {link.emailed ? "ئیمەیڵ نێردرا. دەتوانیت بەستەرەکەش خۆت بنێریت:" : "ئیمەیڵ نەنێردرا. بەستەرەکە خۆت بنێرە، بۆ نموونە لە وەتسئەپ:"}
              </p>
              <input className="gm-input gm-ltr" dir="ltr" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} aria-label="بەستەری بانگهێشت" />
              <button type="button" className="gm-btn quiet small" onClick={() => void navigator.clipboard?.writeText(link.url).then(() => setMsg({ ok: true, text: "کۆپی کرا." }))}>
                کۆپی بکە
              </button>
            </div>
          )}

          {msg && <p className={msg.ok ? "gm-ok" : "gm-err"} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
        </div>

        <div className="nr-split-main gm-stack">
          <h3 className="gm-sec">ئەندامەکان</h3>
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
                      aria-label={`ڕۆڵی ${m.name || m.email}`}
                      value={m.role}
                      disabled={pending}
                      onChange={(e) => run(() => changeRoleAction(m.id, e.target.value), "ڕۆڵەکە گۆڕدرا.")}
                    >
                      {INVITABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="gm-btn quiet small"
                      disabled={pending}
                      onClick={() => confirm(`${m.name || m.email} لە تیمەکە لاببرێت؟`) && run(() => removeMemberAction(m.id), "لابرا.")}
                    >
                      لابردن
                    </button>
                  </div>
                ) : (
                  <span className="gm-badge ghost">{ROLE_LABEL[m.role]}</span>
                )}
              </div>
            ))}
          </div>

          {invites.length > 0 && (
            <>
              <h3 className="gm-sec">بانگهێشتە چاوەڕوانەکان</h3>
              <div className="gm-card">
                {invites.map((i) => (
                  <div key={i.id} className="gm-target">
                    <div>
                      <p className="gm-ltr" dir="ltr">{i.email}</p>
                      <small>
                        {ROLE_LABEL[i.role]} {i.expired && <span className="gm-badge warn">بەسەرچووە</span>}
                      </small>
                    </div>
                    {canManage && (
                      <div className="gm-row" style={{ gap: 6 }}>
                        <button type="button" className="gm-btn quiet small" disabled={pending} onClick={() => run(() => resendInviteAction(i.id), "دووبارە نێردرا.")}>
                          دووبارە بنێرە
                        </button>
                        <button type="button" className="gm-btn quiet small" disabled={pending} onClick={() => run(() => revokeInviteAction(i.id), "هەڵوەشێنرایەوە.")}>
                          هەڵوەشاندنەوە
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
