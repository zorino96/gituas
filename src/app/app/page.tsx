import Link from "next/link";
import { MessageCircle, MessagesSquare, Phone, SquarePlus } from "lucide-react";

import { currentWorkspace, loadConnections, loadConversations, loadInsights, loadPosts } from "./data";
import { dict, getLang } from "@/lib/i18n";
import { commentState, countStates } from "@/lib/merchant/state";
import { ago, num } from "./format";

export const maxDuration = 60;

export default async function TodayPage() {
  const t = dict(await getLang());
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
      <h2 className="gm-title kufi">{t.home.title}</h2>
      <p className="gm-sub">{t.home.sub}</p>

      {!anyConnected && (
        <div className="gm-card" style={{ marginBottom: 14 }}>
          <b className="kufi">{t.home.connectFirst}</b>
          <p className="gm-sub" style={{ margin: "4px 0 10px" }}>{t.home.connectHint}</p>
          <Link href="/app/settings" className="gm-btn">{t.home.connectBtn}</Link>
        </div>
      )}

      <div className="gm-stats">
        <Link href="/app/comments" className={`gm-stat ${counts.unanswered ? "hot" : ""}`}>
          <span className="gm-stat-icon" aria-hidden="true"><MessagesSquare /></span>
          <b>{num(counts.unanswered)}</b>
          <span>{t.home.unansweredComments}</span>
        </Link>
        <Link href="/app/messages" className={`gm-stat ${waitingConvs.length ? "hot" : ""}`}>
          <span className="gm-stat-icon" aria-hidden="true"><MessageCircle /></span>
          <b>{num(waitingConvs.length)}</b>
          <span>{t.home.waitingMessages}</span>
        </Link>
        <Link href="/app/publish" className="gm-stat">
          <span className="gm-stat-icon" aria-hidden="true"><SquarePlus /></span>
          <b>{num(postsThisWeek)}</b>
          <span>{t.home.postsThisWeek}</span>
        </Link>
        <Link href="/app/insights" className="gm-stat">
          <span className="gm-stat-icon" aria-hidden="true"><Phone /></span>
          <b>{num(insights.waTaps7d)}</b>
          <span>{t.home.whatsappTaps}</span>
        </Link>
      </div>

      <div className="gm-cols-2">
        <div>
          <p className="gm-sec">{t.home.unansweredComments}</p>
          {unanswered.length === 0 ? (
            <p className="gm-note">{anyConnected ? t.home.noCommentsWaiting : t.home.appearAfterConnect}</p>
          ) : (
            <div className="gm-stack">
              {unanswered.map(({ c, p }) => (
                <Link key={`${c.platform}-${c.id}`} href="/app/comments" className="gm-card" style={{ textDecoration: "none", color: "inherit" }}>
                  <div className="gm-between">
                    <span className="gm-who" dir="auto">{c.author || t.common.user}</span>
                    <span className="gm-time">{ago(c.createdAt, t)}</span>
                  </div>
                  <p className="gm-text" dir="auto">{c.text}</p>
                  <div className="gm-row" style={{ gap: 6 }}>
                    <span className={`gm-plat ${p.platform}`}>{t.platform[p.platform]}</span>
                    <span className="gm-badge warn">{t.home.waitingBadge}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="gm-sec">{t.home.waitingMessages}</p>
          {waitingConvs.length === 0 ? (
            <p className="gm-note">{t.home.noMessagesWaiting}</p>
          ) : (
            <div className="gm-stack">
              {waitingConvs.slice(0, 5).map((c) => (
                <Link key={`${c.platform}-${c.id}`} href="/app/messages" className="gm-card" style={{ textDecoration: "none", color: "inherit" }}>
                  <div className="gm-between">
                    <span className="gm-who" dir="auto">{c.participantName || t.home.customer}</span>
                    <span className="gm-time">{ago(c.updatedAt, t)}</span>
                  </div>
                  <p className="gm-text" dir="auto">{c.messages[c.messages.length - 1]?.text || t.common.mediaOrFile}</p>
                  <span className={`gm-plat ${c.platform}`}>{t.platform[c.platform]}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
