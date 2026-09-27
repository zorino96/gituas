import type { Metadata, Viewport } from "next";
import Link from "next/link";

import { currentWorkspace } from "@/app/app/data";
import { DeskShell, NewsroomRoot } from "../desk-shell";
import { GuideArticle } from "./guide-article";

export const metadata: Metadata = {
  title: "ڕێنمایی — گیتواس نیوزڕووم",
  description: "چۆن کەناڵەکەت لە نیوزڕووم دەست پێ بکات: پەیج بەستنەوە، براند، سەرچاوە، کارت و بڵاوکردنەوە.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

export default async function GuidePage() {
  const ws = await currentWorkspace();
  if (ws?.kindChosen && ws.kind === "NEWS") {
    return (
      <DeskShell ws={ws}>
        <GuideArticle />
      </DeskShell>
    );
  }
  return (
    <NewsroomRoot>
      <div className="nr-land">
        <div className="gm-between" style={{ marginBottom: 18 }}>
          <Link href="/newsroom" className="nr-brand kufi" style={{ padding: 0 }}>
            <span className="nr-live" aria-hidden="true" />
            گیتواس نیوزڕووم
          </Link>
          <Link href="/login?next=/newsroom/news" className="gm-btn quiet small">
            چوونەژوورەوە
          </Link>
        </div>
        <GuideArticle />
      </div>
    </NewsroomRoot>
  );
}
