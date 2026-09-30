import "@/app/app/app.css";
import "./newsroom.css";
import { gmFontVars } from "@/app/app/fonts";
import { listWorkspaces, type Workspace } from "@/app/app/data";
import { newsroomAccess } from "@/lib/billing/trial";
import { db } from "@/lib/db";
import { getLang } from "@/lib/i18n";
import { LangProvider } from "@/lib/i18n/client";
import { ROLE_LABEL } from "@/lib/newsroom/roles";
import { BottomNav, HelpLink, SideNav } from "./desk-nav";
import { DeskSwitcher } from "./desk-switcher";

/**
 * The newsroom's root element: the shop's design system, re-tokened by .nr.
 * The newsroom's own screens stay Sorani; the provider is for the shop pages it re-exports
 * (comments, messages, publish, insights, settings), which follow the gm_lang cookie.
 */
export async function NewsroomRoot({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <div className={`gm nr ${gmFontVars}`} dir="rtl" lang="ckb">
      <LangProvider lang={lang}>{children}</LangProvider>
    </div>
  );
}

/** Tells a newsroom how long its free trial has left, or that it is frozen (read-only) until a plan is bought. */
async function TrialBanner({ tenantId }: { tenantId: string }) {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { kind: true, plan: true, planPaidUntil: true, trialEndsAt: true } });
  if (!t) return null;
  const access = newsroomAccess(t, new Date());
  if (access.reason === "trial") {
    return (
      <p className="gm-note" style={{ marginBottom: 12 }}>
        {access.daysLeft} ڕۆژ لە تاقیکردنەوەی بەخۆڕایی ماوە —{" "}
        <a href="/newsroom/billing" className="gm-link">
          پلان هەڵبژێرە
        </a>
      </p>
    );
  }
  if (access.reason === "frozen") {
    return (
      <p className="gm-note warn" style={{ marginBottom: 12 }}>
        ماوەی تاقیکردنەوە تەواو بووە. هەواڵەکان دەبینیت، بەڵام نووسین و بڵاوکردنەوە ڕاگیراوە.{" "}
        <a href="/newsroom/billing" className="gm-link">
          پلان هەڵبژێرە
        </a>
      </p>
    );
  }
  return null;
}

/** A signed-in channel's frame: sidebar on desktop, top bar with the "?" guide link, phone bar. */
export async function DeskShell({ ws, children }: { ws: Workspace; children: React.ReactNode }) {
  const desks = (await listWorkspaces()).filter((w) => w.kind === "NEWS" && w.kindChosen);
  return (
    <NewsroomRoot>
      <div className="nr-frame">
        <SideNav />
        <div className="nr-body">
          <header className="nr-top">
            <DeskSwitcher
              currentId={ws.id}
              currentName={ws.name}
              desks={desks.map((d) => ({ id: d.id, name: d.name, role: ROLE_LABEL[d.role] }))}
            />
            <div className="gm-row" style={{ gap: 8 }}>
              <span className="gm-badge ghost">{ROLE_LABEL[ws.role]}</span>
              <HelpLink />
            </div>
          </header>
          <main className="nr-main">
            <TrialBanner tenantId={ws.id} />
            {children}
          </main>
        </div>
      </div>
      <BottomNav />
    </NewsroomRoot>
  );
}
