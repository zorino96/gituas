import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Settings } from "lucide-react";

import "./app.css";
import { currentWorkspace } from "./data";
import { gmFontVars } from "./fonts";
import { Tabs } from "./nav";

export const metadata: Metadata = { title: "گیتواس", description: "وەڵامدانەوە و بڵاوکردنەوە بۆ دووکانەکەت" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const ws = await currentWorkspace();
  if (!ws) redirect("/login?next=/app");

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
      <Tabs />
    </div>
  );
}
