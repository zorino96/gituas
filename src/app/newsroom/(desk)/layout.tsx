import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Settings } from "lucide-react";

import "@/app/app/app.css";
import { claimKind, currentWorkspace } from "@/app/app/data";
import { gmFontVars } from "@/app/app/fonts";
import { Tabs } from "@/app/app/nav";
import { ShopNotice } from "../shop-notice";

export const metadata: Metadata = { title: "گیتواس نیوزڕووم", description: "هەواڵ، کارت و بڵاوکردنەوە بۆ کەناڵەکەت" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

export default async function NewsroomDeskLayout({ children }: { children: React.ReactNode }) {
  let ws = await currentWorkspace();
  if (!ws) redirect("/login?next=/newsroom/news");
  if (!ws.kindChosen) ws = await claimKind(ws, "NEWS");

  if (!ws.kindChosen) {
    return (
      <div className={`gm ${gmFontVars}`} dir="rtl" lang="ckb">
        <div className="gm-auth">
          <p className="gm-brand kufi">گیتواس نیوزڕووم</p>
          <div className="gm-card" style={{ marginTop: 18 }}>
            <p style={{ margin: 0 }}>هەژمارەکەت ئامادە نەکرا. پەڕەکە نوێ بکەرەوە.</p>
          </div>
          <Link href="/newsroom/news" className="gm-btn block" style={{ marginTop: 12 }}>
            دووبارە هەوڵ بدەرەوە
          </Link>
        </div>
      </div>
    );
  }

  if (ws.kind !== "NEWS") {
    return (
      <div className={`gm ${gmFontVars}`} dir="rtl" lang="ckb">
        <ShopNotice />
      </div>
    );
  }

  return (
    <div className={`gm ${gmFontVars}`} dir="rtl" lang="ckb">
      <div className="gm-shell">
        <header className="gm-head">
          <div>
            <div className="gm-row" style={{ gap: 6 }}>
              <h1 className="kufi">{ws.name}</h1>
              <span className="gm-badge ghost">نیوزڕووم</span>
            </div>
            <small>گیتواس</small>
          </div>
          <Link href="/newsroom/settings" className="gm-btn quiet small">
            <Settings size={15} aria-hidden="true" />
            ڕێکخستن
          </Link>
        </header>
        <main className="gm-main">{children}</main>
      </div>
      <Tabs kind="NEWS" />
    </div>
  );
}
