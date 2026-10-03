import type { Metadata, Viewport } from "next";
import Link from "next/link";

import { currentWorkspace } from "@/app/app/data";
import { dict, getLang } from "@/lib/i18n";
import { DeskShell, NewsroomRoot } from "../desk-shell";
import { GuideArticle } from "./guide-article";

export async function generateMetadata(): Promise<Metadata> {
  const t = dict(await getLang()).nr.shell;
  return { title: t.guide.metaTitle, description: t.guide.metaDescription };
}
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
  const t = dict(await getLang()).nr.shell;
  return (
    <NewsroomRoot>
      <div className="nr-land">
        <header className="nr-land-bar">
          <div className="nr-wrap">
            <Link href="/newsroom" className="nr-brand kufi" style={{ padding: 0 }}>
              <span className="nr-live" aria-hidden="true" />
              {t.name}
            </Link>
            {!ws && (
              <Link href="/login?next=/newsroom/news" className="gm-btn quiet small">
                {t.signIn}
              </Link>
            )}
          </div>
        </header>
        <main className="nr-land-main nr-wrap">
          <GuideArticle />
        </main>
      </div>
    </NewsroomRoot>
  );
}
