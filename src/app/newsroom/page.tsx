import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3, LayoutTemplate, ShieldCheck, Sparkles, Send, Users } from "lucide-react";

import { currentWorkspace, listWorkspaces } from "@/app/app/data";
import { dict, getLang } from "@/lib/i18n";
import { NewsroomRoot } from "./desk-shell";
import { ShopNotice } from "./shop-notice";

export async function generateMetadata(): Promise<Metadata> {
  const t = dict(await getLang()).nr.shell;
  return { title: t.name, description: t.landing.metaDescription };
}
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

const FEATURES = [
  { key: "cards", Icon: LayoutTemplate },
  { key: "ai", Icon: Sparkles },
  { key: "platforms", Icon: Send },
  { key: "audience", Icon: BarChart3 },
  { key: "team", Icon: Users },
] as const;

export default async function NewsroomLandingPage() {
  const t = dict(await getLang()).nr.shell;
  const ws = await currentWorkspace();
  if (ws) {
    if (!ws.kindChosen || ws.kind === "NEWS") redirect("/newsroom/news");
    const desks = (await listWorkspaces()).filter((w) => w.kind === "NEWS" && w.kindChosen).map((w) => ({ id: w.id, name: w.name }));
    return (
      <NewsroomRoot>
        <ShopNotice desks={desks} />
      </NewsroomRoot>
    );
  }

  return (
    <NewsroomRoot>
      <div className="nr-land">
        <header className="nr-land-bar">
          <div className="nr-wrap">
            <p className="nr-brand kufi" style={{ padding: 0 }}>
              <span className="nr-live" aria-hidden="true" />
              {t.name}
            </p>
            <Link href="/login?next=/newsroom/news" className="gm-btn quiet small">
              {t.signIn}
            </Link>
          </div>
        </header>

        <main className="nr-land-main nr-wrap">
          <section className="nr-hero">
            <div className="nr-hero-copy">
              <h1 className="kufi">{t.landing.title}</h1>
              <p>{t.landing.lead}</p>

              <div className="nr-cta">
                <Link href="/signup?next=/newsroom/news" className="gm-btn">
                  {t.landing.start}
                </Link>
                <Link href="/newsroom/guide" className="gm-btn quiet">
                  {t.landing.how}
                </Link>
              </div>
              <p className="nr-promise">
                <ShieldCheck aria-hidden="true" />
                {t.landing.promise}
              </p>
            </div>

            {/* decoration only: a news card on its way to three platforms */}
            <div className="nr-art" aria-hidden="true">
              <div className="nr-art-card back" />
              <div className="nr-art-card">
                <div className="nr-art-top">
                  <span className="nr-live" />
                  <i />
                  <i />
                </div>
                <div className="nr-art-photo" />
                <div className="nr-art-lines">
                  <i />
                  <i />
                  <i />
                </div>
                <div className="nr-art-plats">
                  <b />
                  <b />
                  <b />
                  <i />
                </div>
              </div>
            </div>
          </section>

          <div className="nr-features">
            {FEATURES.map(({ key, Icon }) => (
              <div key={key} className="nr-feature">
                <span className="nr-feature-icon" aria-hidden="true">
                  <Icon />
                </span>
                <h3 className="kufi">{t.landing.features[key].title}</h3>
                <p>{t.landing.features[key].body}</p>
              </div>
            ))}
          </div>
        </main>
      </div>
    </NewsroomRoot>
  );
}
