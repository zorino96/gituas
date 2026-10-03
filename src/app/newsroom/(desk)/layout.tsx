import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { claimKind, currentWorkspace, listWorkspaces } from "@/app/app/data";
import { dict, getLang } from "@/lib/i18n";
import { DeskShell, NewsroomRoot } from "../desk-shell";
import { ShopNotice } from "../shop-notice";

export async function generateMetadata(): Promise<Metadata> {
  const t = dict(await getLang()).nr.shell;
  return { title: t.name, description: t.desk.metaDescription };
}
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

export default async function NewsroomDeskLayout({ children }: { children: React.ReactNode }) {
  let ws = await currentWorkspace();
  if (!ws) redirect("/login?next=/newsroom/news");
  if (!ws.kindChosen) ws = await claimKind(ws, "NEWS");

  if (!ws.kindChosen) {
    const t = dict(await getLang()).nr.shell;
    return (
      <NewsroomRoot>
        <div className="gm-auth">
          <p className="gm-brand kufi">{t.name}</p>
          <div className="gm-card" style={{ marginTop: 18 }}>
            <p style={{ margin: 0 }}>{t.desk.notReady}</p>
          </div>
          <Link href="/newsroom/news" className="gm-btn block" style={{ marginTop: 12 }}>
            {t.desk.retry}
          </Link>
        </div>
      </NewsroomRoot>
    );
  }

  if (ws.kind !== "NEWS") {
    const desks = (await listWorkspaces()).filter((w) => w.kind === "NEWS" && w.kindChosen).map((w) => ({ id: w.id, name: w.name }));
    return (
      <NewsroomRoot>
        <ShopNotice desks={desks} />
      </NewsroomRoot>
    );
  }

  return <DeskShell ws={ws}>{children}</DeskShell>;
}
