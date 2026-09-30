"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EyeOff, Eye, RefreshCw, Reply, Trash2, ExternalLink } from "lucide-react";

import type { CommentState, MComment, MPost, Platform } from "@/lib/merchant/types";
import { commentState, countStates } from "@/lib/merchant/state";
import { needsYou } from "@/lib/shop/forms";
import { useT } from "@/lib/i18n/client";
import type { Dict } from "@/lib/i18n/ckb";
import { useBase } from "../use-base";
import { deleteCommentAction, replyToCommentAction, setCommentHiddenAction } from "../actions";
import { ReplyComposer } from "../reply-composer";
import { ago, friendlyError, num } from "../format";

type Filter = "all" | "needs" | CommentState;

/** What the shop automation did with a comment: `outcome` and `reason` come from its conversation message. */
type Outcomes = Record<string, { outcome: string | null; reason: string | null }>;

const FILTER_KEYS: Filter[] = ["unanswered", "all", "answered", "hidden", "needs"];

function filterLabel(t: Dict, key: Filter): string {
  const c = t.comments;
  return { unanswered: c.filterUnanswered, all: c.filterAll, answered: c.filterAnswered, hidden: c.filterHidden, needs: c.filterNeeds }[key];
}

function stateBadge(t: Dict, state: CommentState): { cls: string; label: string } {
  const c = t.comments;
  return { unanswered: { cls: "warn", label: c.badgeUnanswered }, answered: { cls: "", label: c.badgeAnswered }, hidden: { cls: "ghost", label: c.badgeHidden } }[state];
}

function OutcomeBadges({ outcomes, id }: { outcomes: Outcomes; id: string }) {
  const t = useT();
  const o = outcomes[id];
  const reason = o?.reason && needsYou(o.reason) ? o.reason : null;
  return (
    <>
      {o?.outcome === "AUTO_REPLIED" && <span className="gm-badge ghost">{t.comments.autoReplied}</span>}
      {reason && <span className="gm-badge warn">{(t.comments.reasons as Record<string, string>)[reason]}</span>}
    </>
  );
}

export function CommentsClient({
  initialPosts,
  errors,
  outcomes,
  whatsappPath,
  connected,
}: {
  initialPosts: MPost[];
  errors: { platform: Platform; message: string }[];
  outcomes: Outcomes;
  whatsappPath: string | null;
  connected: Record<Platform, boolean>;
}) {
  const router = useRouter();
  const base = useBase();
  const t = useT();
  const [posts, setPosts] = useState(initialPosts);
  const counts = useMemo(() => countStates(posts), [posts]);
  const [filter, setFilter] = useState<Filter>(counts.unanswered > 0 ? "unanswered" : "all");
  const [refreshing, startRefresh] = useTransition();
  const [waUrl, setWaUrl] = useState<string | null>(null);

  useEffect(() => setPosts(initialPosts), [initialPosts]);
  useEffect(() => setWaUrl(whatsappPath ? `${window.location.origin}${whatsappPath}` : null), [whatsappPath]);

  const total = counts.unanswered + counts.answered + counts.hidden;
  // A comment waits for the merchant when the automation flagged it, or flagged a reply under it.
  const flagged = (c: MComment) => needsYou(outcomes[c.id]?.reason ?? null) || c.replies.some((r) => needsYou(outcomes[r.id]?.reason ?? null));
  const needsCount = posts.reduce((n, p) => n + p.comments.filter(flagged).length, 0);
  const matches = (c: MComment) => filter === "all" || (filter === "needs" ? flagged(c) : commentState(c) === filter);
  const visible = posts
    .map((p) => ({ post: p, comments: p.comments.filter(matches) }))
    .filter((x) => x.comments.length > 0);

  function patchComment(platform: Platform, id: string, fn: (c: MComment) => MComment | null) {
    setPosts((prev) =>
      prev.map((p) =>
        p.platform !== platform
          ? p
          : {
              ...p,
              comments: p.comments.flatMap((c) => {
                if (c.id !== id) return [c];
                const next = fn(c);
                return next ? [next] : [];
              }),
            },
      ),
    );
  }

  return (
    <div>
      <div className="gm-between">
        <div>
          <h2 className="gm-title kufi">{t.comments.title}</h2>
          <p className="gm-sub">{t.comments.sub(total)}</p>
        </div>
        <button
          type="button"
          className="gm-btn quiet small"
          onClick={() => startRefresh(() => router.refresh())}
          disabled={refreshing}
          aria-label={t.common.refreshLabel}
        >
          <RefreshCw size={14} aria-hidden="true" />
          {refreshing ? "…" : t.common.refresh}
        </button>
      </div>

      {(!connected.FB || !connected.IG) && (
        <p className="gm-note" style={{ marginBottom: 12 }}>
          {!connected.FB && !connected.IG
            ? t.common.noneConnected
            : t.common.notConnected(!connected.FB ? t.platform.FB : t.platform.IG)}{" "}
          <Link href={`${base}/settings`} className="gm-link">{t.common.connectIt}</Link>
        </p>
      )}
      {errors.map((e) => (
        <p key={e.platform} className="gm-note warn" style={{ marginBottom: 12 }}>
          {t.platform[e.platform]}: {friendlyError(e.message, t)}
        </p>
      ))}

      <div className="gm-chips" role="group" aria-label={t.comments.filterLabel} style={{ marginBottom: 14 }}>
        {FILTER_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            className="gm-chip"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {filterLabel(t, key)} {num(key === "all" ? total : key === "needs" ? needsCount : counts[key])}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="gm-empty">
          <b className="kufi">{filter === "unanswered" ? t.comments.emptyAllAnswered : t.comments.emptyNone}</b>
          {filter === "unanswered" ? (base === "/newsroom" ? t.comments.nothingWaitingNews : t.comments.nothingWaitingShop) : <Link href={`${base}/publish`} className="gm-link">{t.comments.newPost}</Link>}
        </div>
      ) : (
        <div className="gm-stack">
          {visible.map(({ post, comments }) => (
            <section key={`${post.platform}-${post.id}`} className="gm-card" aria-label={t.comments.postAria(t.platform[post.platform])}>
              <div className="gm-post">
                {post.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={post.thumbUrl} alt="" className="gm-thumb" loading="lazy" />
                ) : (
                  <div className="gm-thumb" aria-hidden="true" />
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="gm-row" style={{ gap: 8 }}>
                    <span className={`gm-plat ${post.platform}`}>{t.platform[post.platform]}</span>
                    <span className="gm-time">{ago(post.createdAt, t)}</span>
                    {post.permalink && (
                      <a href={post.permalink} target="_blank" rel="noreferrer" className="gm-link" style={{ marginInlineStart: "auto", fontSize: 12 }}>
                        <ExternalLink size={13} aria-hidden="true" /> {t.comments.postLink}
                      </a>
                    )}
                  </div>
                  <p dir="auto">{post.caption || t.common.noText}</p>
                </div>
              </div>

              {comments.map((c) => (
                <CommentItem
                  key={c.id}
                  comment={c}
                  outcomes={outcomes}
                  waUrl={waUrl}
                  onReplied={(text) =>
                    patchComment(c.platform, c.id, (x) => ({
                      ...x,
                      replies: [...x.replies, { id: `local-${Date.now()}`, author: t.common.you, text, fromUs: true, createdAt: new Date().toISOString() }],
                    }))
                  }
                  onHidden={(hidden) => patchComment(c.platform, c.id, (x) => ({ ...x, hidden }))}
                  onDeleted={() => patchComment(c.platform, c.id, () => null)}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function CommentItem({
  comment: c,
  outcomes,
  waUrl,
  onReplied,
  onHidden,
  onDeleted,
}: {
  comment: MComment;
  outcomes: Outcomes;
  waUrl: string | null;
  onReplied: (text: string) => void;
  onHidden: (hidden: boolean) => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const state = commentState(c);
  const badge = c.fromUs ? { cls: "ghost", label: t.comments.badgeOwn } : stateBadge(t, state);
  const [replying, setReplying] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggleHidden() {
    setError(null);
    start(async () => {
      const r = await setCommentHiddenAction(c.platform, c.id, !c.hidden);
      if (r.ok) onHidden(!c.hidden);
      else setError(friendlyError(r.error, t));
    });
  }

  function remove() {
    setError(null);
    start(async () => {
      const r = await deleteCommentAction(c.platform, c.id);
      if (r.ok) onDeleted();
      else {
        setConfirmDelete(false);
        setError(friendlyError(r.error, t));
      }
    });
  }

  return (
    <div className={`gm-comment ${state === "unanswered" ? "unanswered" : ""}`}>
      <div className="gm-between">
        <span className="gm-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <span className="gm-who" dir="auto">{c.fromUs ? t.common.you : c.author || t.common.user}</span>
          <OutcomeBadges outcomes={outcomes} id={c.id} />
        </span>
        <span className="gm-row" style={{ gap: 8 }}>
          <span className={`gm-badge ${badge.cls}`}>{badge.label}</span>
          <span className="gm-time">{ago(c.createdAt, t)}</span>
        </span>
      </div>
      <p className="gm-text" dir="auto">{c.text || t.common.noText}</p>

      {c.replies.map((r) => (
        <div key={r.id} className={`gm-reply ${r.fromUs ? "us" : ""}`}>
          <b>{r.fromUs ? t.comments.yourReply : r.author}</b> · <span dir="auto">{r.text}</span> <OutcomeBadges outcomes={outcomes} id={r.id} />
        </div>
      ))}

      {confirmDelete ? (
        <div className="gm-note warn" style={{ marginTop: 10 }}>
          {t.comments.confirmDelete}
          <div className="gm-actions">
            <button type="button" className="gm-btn danger small" onClick={remove} disabled={pending}>
              {pending ? t.comments.deleting : t.comments.confirmYes}
            </button>
            <button type="button" className="gm-btn quiet small" onClick={() => setConfirmDelete(false)} disabled={pending}>
              {t.comments.confirmNo}
            </button>
          </div>
        </div>
      ) : (
        <div className="gm-actions">
          {!replying && !c.fromUs && (
            <button type="button" className="gm-btn small" onClick={() => setReplying(true)} disabled={pending}>
              <Reply size={14} aria-hidden="true" /> {t.comments.reply}
            </button>
          )}
          <button type="button" className="gm-btn quiet small" onClick={toggleHidden} disabled={pending}>
            {c.hidden ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
            {c.hidden ? t.comments.show : t.comments.hide}
          </button>
          <button type="button" className="gm-btn quiet small" onClick={() => setConfirmDelete(true)} disabled={pending}>
            <Trash2 size={14} aria-hidden="true" /> {t.comments.delete}
          </button>
        </div>
      )}

      {replying && (
        <ReplyComposer
          incoming={c.text}
          kind="comment"
          waUrl={waUrl}
          maxLength={c.platform === "IG" ? 2200 : 8000}
          onCancel={() => setReplying(false)}
          onSend={async (text) => {
            const r = await replyToCommentAction(c.platform, c.id, text);
            if (r.ok) {
              onReplied(text.trim());
              setReplying(false);
            }
            return r;
          }}
        />
      )}
      {error && <p className="gm-err">{error}</p>}
    </div>
  );
}
