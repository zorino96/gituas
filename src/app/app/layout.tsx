import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Settings } from "lucide-react";

import "./app.css";
import { claimKind, currentWorkspace, listWorkspaces } from "./data";
import { gmFontVars } from "./fonts";
import { Tabs } from "./nav";
import { switchWorkspaceAction } from "@/app/newsroom/desk-actions";

export const metadata: Metadata = { title: "گیتواس", description: "وەڵامدانەوە و بڵاوکردنەوە بۆ دووکانەکەت" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  let ws = await currentWorkspace();
  if (!ws) redirect("/login?next=/app");
  if (!ws.kindChosen) ws = await claimKind(ws, "MERCHANT");
  if (ws.kind === "NEWS") {
    const shops = (await listWorkspaces()).filter((w) => w.kind === "MERCHANT" && w.kindChosen);
    if (shops.length === 0) redirect("/newsroom/news");
    return (
      <div className={`gm ${gmFontVars}`} dir="rtl" lang="ckb">
        <div className="gm-auth">
          <p className="gm-brand kufi">گیتواس</p>
          <div className="gm-card" style={{ marginTop: 18 }}>
            <p style={{ margin: 0 }}>ئێستا لە مێزی هەواڵی «{ws.name}»یت.</p>
          </div>
          {shops.map((s) => (
            <form key={s.id} action={switchWorkspaceAction}>
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="next" value="/app" />
              <button type="submit" className="gm-btn block" style={{ marginTop: 10 }}>
                بچۆ دووکانی «{s.name}»
              </button>
            </form>
          ))}
          <Link href="/newsroom/news" className="gm-btn quiet block" style={{ marginTop: 10 }}>
            بگەڕێوە بۆ نیوزڕووم
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`gm ${gmFontVars}`} dir="rtl" lang="ckb">
      <div className="gm-shell">
        <header className="gm-head">
          <div>
            <h1 className="kufi">{ws.name}</h1>
            <small>گیتواس</small>
          </div>
          <Link href="/app/settings" className="gm-btn quiet small">
            <Settings size={15} aria-hidden="true" />
            ڕێکخستن
          </Link>
        </header>
        <main className="gm-main">{children}</main>
      </div>
      <Tabs kind={ws.kind} />
    </div>
  );
}
