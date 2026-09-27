import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { claimKind, currentWorkspace } from "@/app/app/data";
import { DeskShell, NewsroomRoot } from "../desk-shell";
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
      <NewsroomRoot>
        <div className="gm-auth">
          <p className="gm-brand kufi">گیتواس نیوزڕووم</p>
          <div className="gm-card" style={{ marginTop: 18 }}>
            <p style={{ margin: 0 }}>هەژمارەکەت ئامادە نەکرا. پەڕەکە نوێ بکەرەوە.</p>
          </div>
          <Link href="/newsroom/news" className="gm-btn block" style={{ marginTop: 12 }}>
            دووبارە هەوڵ بدەرەوە
          </Link>
        </div>
      </NewsroomRoot>
    );
  }

  if (ws.kind !== "NEWS") {
    return (
      <NewsroomRoot>
        <ShopNotice />
      </NewsroomRoot>
    );
  }

  return <DeskShell ws={ws}>{children}</DeskShell>;
}
