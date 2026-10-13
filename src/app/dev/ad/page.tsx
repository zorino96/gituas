import { notFound } from "next/navigation";
import { Settings } from "lucide-react";

import { gmFontVars } from "@/app/app/fonts";
import "@/app/app/app.css";
import { Tabs } from "@/app/app/nav";
import { ModeSwitch } from "@/app/app/mode-switch";
import { CommentsClient } from "@/app/app/comments/comments-client";
import { MessagesClient } from "@/app/app/messages/messages-client";
import { OrdersClient } from "@/app/app/orders/orders-client";
import { VideoClient } from "@/app/app/video/video-client";
import { PublishClient } from "@/app/app/publish/publish-client";
import { BoostClient } from "@/app/app/boost/boost-client";
import { AssistantClient } from "@/app/app/assistant/assistant-client";
import { ckb } from "@/lib/i18n/ckb";
import * as d from "./data";

export const dynamic = "force-dynamic";

/**
 * Dev only: the shop app's real screens (the same client components and styles) with a made-up shop, to film the
 * product for ads and tutorials. Nothing here reads a session or the database; buttons that call the server fail.
 *   /dev/ad?s=comments|spam|messages|orders|video|publish|publish-ready|boost|insights|assistant
 */
export default async function DevAdPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { s = "comments" } = await searchParams;
  const t = ckb;
  const title: Record<string, string> = {
    comments: t.nav.comments,
    spam: t.nav.comments,
    messages: t.nav.messages,
    orders: t.nav.orders,
    video: t.nav.video,
    publish: t.nav.publish,
    "publish-ready": t.nav.publish,
    boost: t.nav.boost,
    insights: t.nav.insights,
    assistant: t.assistant.title,
  };
  return (
    <div className={`gm ${gmFontVars}`} dir="rtl" lang="ckb">
      <div className="gm-shell">
        <header className="gm-head">
          <div>
            <h1 className="kufi">{d.SHOP}</h1>
            <small>{t.brand}</small>
          </div>
          <div className="gm-row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
            <ModeSwitch />
            <span className="gm-btn quiet small">
              <Settings size={15} />
              {t.layout.settings}
            </span>
          </div>
        </header>
        <main className="gm-main" data-screen={s}>
          {/* Every screen's client draws its own title, except Insights and the Assistant (drawn by their pages). */}
          {s === "insights" && <h2 className="gm-title kufi">{title[s]}</h2>}
          {(s === "comments" || s === "spam") && <CommentsClient {...(s === "spam" ? d.spam : d.comments)} />}
          {s === "messages" && <MessagesClient {...d.messages} />}
          {s === "orders" && <OrdersClient {...d.orders} />}
          {s === "video" && <VideoClient {...d.video} />}
          {s === "publish" && <PublishClient {...d.publish} />}
          {s === "publish-ready" && <PublishClient {...d.publishReady} />}
          {s === "boost" && <BoostClient {...d.boost} />}
          {s === "insights" && <Insights />}
          {s === "assistant" && (
            <>
              <h2 className="gm-title kufi">{t.assistant.title}</h2>
              <AssistantClient workspaceId="dev-ad" support={{ url: "https://gituas.com", display: "0771 010 6009" }} connections={{ facebook: true, instagram: true }} justConnected={false} />
            </>
          )}
        </main>
      </div>
      <Tabs kind="MERCHANT" video />
    </div>
  );
}

/** The Insights screen's own markup (it has no client component), with the shop's sample numbers. */
function Insights() {
  const t = ckb;
  const tiles = [
    { key: "fb", label: t.insights.fbFollowers, value: 8640 },
    { key: "ig", label: t.insights.ig.followers, value: 12380 },
    { key: "dms", label: t.insights.own.dms, value: 846 },
    { key: "comments", label: t.insights.own.comments, value: 1290 },
    { key: "orders", label: t.insights.own.orders, value: 173 },
    { key: "wa", label: t.insights.whatsapp7d, value: 96 },
  ];
  const top = [
    { id: "p1", platform: "IG" as const, caption: "پێڵاوی وەرزشی نوێ 🔥 قەبارە ٣٩ تا ٤٤", n: 58, img: "/demo/ai-shoe.jpg" },
    { id: "p2", platform: "FB" as const, caption: "کۆلێکشنی هاوین گەیشت", n: 34, img: d.thumb("👟", "#9fd3ff", "#1d3f7a") },
    { id: "p3", platform: "IG" as const, caption: "پێڵاوی چیا بۆ زستان", n: 21, img: d.thumb("🥾", "#e8b48a", "#5a2d12") },
  ];
  return (
    <div>
      <p className="gm-sub">{t.insights.subShop}</p>
      <div className="gm-kpis">
        {tiles.map((tile) => (
          <div key={tile.key} className="gm-kpi">
            <b>{t.fmt.num(tile.value)}</b>
            <span>{tile.label}</span>
          </div>
        ))}
      </div>
      <p className="gm-sec">{t.insights.topSec}</p>
      <div className="gm-card">
        {top.map((p) => (
          <div key={p.id} className="gm-rank">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.img} alt="" className="gm-thumb" style={{ width: 38, height: 38, flexBasis: 38 }} />
            <div style={{ minWidth: 0 }}>
              <div className="gm-row" style={{ gap: 6 }}>
                <span className={`gm-plat ${p.platform}`}>{t.platform[p.platform]}</span>
              </div>
              <div className="gm-time" dir="auto" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "52vw" }}>
                {p.caption}
              </div>
            </div>
            <b>{t.fmt.num(p.n)}</b>
          </div>
        ))}
      </div>
    </div>
  );
}
