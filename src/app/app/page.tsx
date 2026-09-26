import Link from "next/link";

import { currentWorkspace, loadConnections, loadConversations, loadInsights, loadPosts } from "./data";
import { commentState, countStates } from "@/lib/merchant/state";
import { PLATFORM_NAME, ago, num } from "./format";

export const maxDuration = 60;

export default async function TodayPage() {
  const ws = (await currentWorkspace())!;
  const conns = await loadConnections(ws.id);
  const anyConnected = conns.META_FACEBOOK.connected || conns.META_INSTAGRAM.connected;

  const [{ posts }, { conversations }, insights] = await Promise.all([
    loadPosts(ws.id, conns),
    loadConversations(ws.id, conns),
    loadInsights(ws.id, conns),
  ]);

  const counts = countStates(posts);
  const waitingConvs = conversations.filter(
    (c) => c.withinWindow && c.messages.length > 0 && !c.messages[c.messages.length - 1].fromUs,
  );
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const postsThisWeek = posts.filter((p) => (p.createdAt ?? "") >= weekAgo).length;
  const unanswered = posts
    .flatMap((p) => p.comments.filter((c) => commentState(c) === "unanswered").map((c) => ({ c, p })))
    .sort((a, b) => (b.c.createdAt ?? "").localeCompare(a.c.createdAt ?? ""))
    .slice(0, 5);

  return (
    <div>
      <h2 className="gm-title kufi">ئەمڕۆ</h2>
      <p className="gm-sub">ئەوەی چاوەڕێی تۆیە، لە یەک شوێندا.</p>

      {!anyConnected && (
        <div className="gm-card" style={{ marginBottom: 14 }}>
          <b className="kufi">سەرەتا پەیجەکانت پەیوەست بکە</b>
          <p className="gm-sub" style={{ margin: "4px 0 10px" }}>فەیسبووک، ئینستاگرام و تیکتۆک — پاشان کۆمێنت و نامەکانت لێرە دەبینیت.</p>
          <Link href="/app/settings" className="gm-btn">پەیوەستیان بکە</Link>
        </div>
      )}

      <div className="gm-strip">
        <Link href="/app/comments" className={`gm-cell ${counts.unanswered ? "hot" : ""}`}>
          <b>{num(counts.unanswered)}</b>
          <span>کۆمێنتی بێوەڵام</span>
        </Link>
        <Link href="/app/messages" className={`gm-cell ${waitingConvs.length ? "hot" : ""}`}>
          <b>{num(waitingConvs.length)}</b>
          <span>نامەی چاوەڕوان</span>
        </Link>
        <Link href="/app/publish" className="gm-cell">
          <b>{num(postsThisWeek)}</b>
          <span>پۆستی ئەم هەفتەیە</span>
        </Link>
        <Link href="/app/insights" className="gm-cell">
          <b>{num(insights.waTaps7d)}</b>
          <span>چوونە وەتسئەپ</span>
        </Link>
      </div>

      <p className="gm-sec">کۆمێنتی بێوەڵام</p>
      {unanswered.length === 0 ? (
        <p className="gm-note">{anyConnected ? "هیچ کۆمێنتێک چاوەڕێی وەڵام نییە." : "دوای پەیوەستکردن لێرە دەردەکەون."}</p>
      ) : (
        <div className="gm-stack">
          {unanswered.map(({ c, p }) => (
            <Link key={`${c.platform}-${c.id}`} href="/app/comments" className="gm-card" style={{ textDecoration: "none", color: "inherit" }}>
              <div className="gm-between">
                <span className="gm-who" dir="auto">{c.author || "بەکارهێنەر"}</span>
                <span className="gm-time">{ago(c.createdAt)}</span>
              </div>
              <p className="gm-text" dir="auto">{c.text}</p>
              <div className="gm-row" style={{ gap: 6 }}>
                <span className={`gm-plat ${p.platform}`}>{PLATFORM_NAME[p.platform]}</span>
                <span className="gm-badge warn">چاوەڕێی وەڵامە</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <p className="gm-sec">نامەی چاوەڕوان</p>
      {waitingConvs.length === 0 ? (
        <p className="gm-note">هیچ نامەیەک چاوەڕێت ناکات.</p>
      ) : (
        <div className="gm-stack">
          {waitingConvs.slice(0, 5).map((c) => (
            <Link key={`${c.platform}-${c.id}`} href="/app/messages" className="gm-card" style={{ textDecoration: "none", color: "inherit" }}>
              <div className="gm-between">
                <span className="gm-who" dir="auto">{c.participantName || "کڕیار"}</span>
                <span className="gm-time">{ago(c.updatedAt)}</span>
              </div>
              <p className="gm-text" dir="auto">{c.messages[c.messages.length - 1]?.text || "(وێنە یان فایل)"}</p>
              <span className={`gm-plat ${c.platform}`}>{PLATFORM_NAME[c.platform]}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
