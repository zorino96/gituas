import Link from "next/link";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { dict, getLang } from "@/lib/i18n";
import { currentWorkspace } from "@/app/app/data";

const DAYS = 3;

/**
 * The desk's reels of the last three days. The autopilot posts them to Facebook and Instagram
 * itself; TikTok and YouTube need a person per post, so each reel has a one-click link to the
 * publish page with the video, its caption and only that platform ready.
 */
export default async function VideosPage() {
  const ws = (await currentWorkspace())!;
  if (ws.kindChosen && ws.kind !== "NEWS") redirect("/newsroom");
  const t = dict(await getLang());
  const te = t.nr.news.editor;
  const videos = await db.newsVideo.findMany({
    where: { tenantId: ws.id, createdAt: { gte: new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000) }, status: { in: ["RENDERED", "POSTED", "POSTING", "QUEUED", "VOICED", "RENDERING"] } },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: { id: true, draftId: true, status: true, autoPost: true, videoUrl: true, createdAt: true },
  });
  const drafts = await db.newsDraft.findMany({ where: { id: { in: videos.map((v) => v.draftId) } }, select: { id: true, headline: true } });
  const headline = new Map(drafts.map((d) => [d.id, d.headline]));

  return (
    <>
      <h1 className="gm-sec" style={{ fontSize: 22 }}>{te.listTitle}</h1>
      <p className="gm-hint">{te.listHint}</p>
      {videos.length === 0 && <p className="gm-note">{te.listEmpty}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
        {videos.map((v) => {
          const ready = !!v.videoUrl && (v.status === "RENDERED" || v.status === "POSTED" || v.status === "POSTING");
          const href = (to: string) => `/newsroom/publish?draft=${v.draftId}&video=${v.id}&to=${to}`;
          return (
            <div key={v.id} className="gm-card gm-stack" style={{ padding: 12, gap: 8 }}>
              {ready ? (
                <video src={v.videoUrl!} controls playsInline preload="metadata" style={{ width: "100%", aspectRatio: "9 / 16", borderRadius: 10, background: "#000" }} />
              ) : (
                <div style={{ width: "100%", aspectRatio: "9 / 16", borderRadius: 10, background: "var(--line, #222)", display: "grid", placeItems: "center" }}>
                  <small className="gm-sub">{te.listWorking}</small>
                </div>
              )}
              <p style={{ margin: 0, fontWeight: 700, fontSize: 14, lineHeight: 1.4 }} dir="auto">{headline.get(v.draftId) ?? ""}</p>
              {v.autoPost && v.status === "POSTED" && <span className="gm-badge">{te.listAuto} ✓</span>}
              {ready && (
                <div className="gm-row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <Link href={href("TT")} className="gm-btn small">{te.listToTikTok}</Link>
                  <Link href={href("YT")} className="gm-btn quiet small">{te.listToYouTube}</Link>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
