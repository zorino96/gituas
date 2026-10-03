import "@/app/app/app.css";
import "./newsroom.css";
import { gmFontVars } from "@/app/app/fonts";
import { listWorkspaces, type Workspace } from "@/app/app/data";
import { newsroomAccess } from "@/lib/billing/trial";
import { db } from "@/lib/db";
import { dict, getLang } from "@/lib/i18n";
import { LangProvider } from "@/lib/i18n/client";
import { BottomNav, HelpLink, SideNav } from "./desk-nav";
import { DeskSwitcher } from "./desk-switcher";

/**
 * The newsroom's root element: the shop's design system, re-tokened by .nr.
 * Every screen inside it, the newsroom's own and the shop pages it re-exports
 * (comments, messages, publish, insights, settings), follows the gm_lang cookie.
 */
export async function NewsroomRoot({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <div className={`gm nr ${gmFontVars}`} dir="rtl" lang={lang}>
      <LangProvider lang={lang}>{children}</LangProvider>
    </div>
  );
}

/** Tells a newsroom how long its free trial has left, or that it is frozen (read-only) until a plan is bought. */
async function TrialBanner({ tenantId }: { tenantId: string }) {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { kind: true, plan: true, planPaidUntil: true, trialEndsAt: true } });
  if (!tenant) return null;
  const access = newsroomAccess(tenant, new Date());
  const t = dict(await getLang()).nr.shell.desk;
  if (access.reason === "trial" && access.daysLeft != null) {
    return (
      <p className="gm-note nr-trial">
        {t.trialLeft(access.daysLeft)}{" "}
        <a href="/newsroom/billing" className="gm-link">
          {t.choosePlan}
        </a>
      </p>
    );
  }
  if (access.reason === "frozen") {
    return (
      <p className="gm-note warn nr-trial">
        {t.frozen}{" "}
        <a href="/newsroom/billing" className="gm-link">
          {t.choosePlan}
        </a>
      </p>
    );
  }
  return null;
}

/** A signed-in channel's frame: sidebar on desktop, top bar with the "?" guide link, phone bar. */
export async function DeskShell({ ws, children }: { ws: Workspace; children: React.ReactNode }) {
  const desks = (await listWorkspaces()).filter((w) => w.kind === "NEWS" && w.kindChosen);
  const roles = dict(await getLang()).nr.team.roles.label;
  return (
    <NewsroomRoot>
      <SideNav />
      <div className="gm-shell">
        <header className="nr-top">
          <DeskSwitcher
            currentId={ws.id}
            currentName={ws.name}
            desks={desks.map((d) => ({ id: d.id, name: d.name, role: roles[d.role] }))}
          />
          <div className="gm-row" style={{ gap: 8 }}>
            <span className="gm-badge ghost">{roles[ws.role]}</span>
            <HelpLink />
          </div>
        </header>
        <main className="gm-main">
          <TrialBanner tenantId={ws.id} />
          {children}
        </main>
      </div>
      <BottomNav />
    </NewsroomRoot>
  );
}
