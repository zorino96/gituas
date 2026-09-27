import "@/app/app/app.css";
import "./newsroom.css";
import { gmFontVars } from "@/app/app/fonts";
import type { Workspace } from "@/app/app/data";
import { BottomNav, HelpLink, SideNav } from "./desk-nav";

/** The newsroom's root element: the shop's design system, re-tokened by .nr. */
export function NewsroomRoot({ children }: { children: React.ReactNode }) {
  return (
    <div className={`gm nr ${gmFontVars}`} dir="rtl" lang="ckb">
      {children}
    </div>
  );
}

/** A signed-in channel's frame: sidebar on desktop, top bar with the "?" guide link, phone bar. */
export function DeskShell({ ws, children }: { ws: Workspace; children: React.ReactNode }) {
  return (
    <NewsroomRoot>
      <div className="nr-frame">
        <SideNav />
        <div className="nr-body">
          <header className="nr-top">
            <div className="nr-desk">
              <h1 className="kufi">{ws.name}</h1>
              <span className="gm-badge ghost">نیوزڕووم</span>
            </div>
            <HelpLink />
          </header>
          <main className="nr-main">{children}</main>
        </div>
      </div>
      <BottomNav />
    </NewsroomRoot>
  );
}
