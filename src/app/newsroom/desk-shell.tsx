import "@/app/app/app.css";
import "./newsroom.css";
import { gmFontVars } from "@/app/app/fonts";
import { listWorkspaces, type Workspace } from "@/app/app/data";
import { ROLE_LABEL } from "@/lib/newsroom/roles";
import { BottomNav, HelpLink, SideNav } from "./desk-nav";
import { DeskSwitcher } from "./desk-switcher";

/** The newsroom's root element: the shop's design system, re-tokened by .nr. */
export function NewsroomRoot({ children }: { children: React.ReactNode }) {
  return (
    <div className={`gm nr ${gmFontVars}`} dir="rtl" lang="ckb">
      {children}
    </div>
  );
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
          <main className="nr-main">{children}</main>
        </div>
      </div>
      <BottomNav />
    </NewsroomRoot>
  );
}
