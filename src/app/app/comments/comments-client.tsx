"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EyeOff, Eye, RefreshCw, Reply, Trash2, ExternalLink } from "lucide-react";

import type { CommentState, MComment, MPost, Platform } from "@/lib/merchant/types";
import { commentState, countStates } from "@/lib/merchant/state";
import { deleteCommentAction, replyToCommentAction, setCommentHiddenAction } from "../actions";
import { ReplyComposer } from "../reply-composer";
import { PLATFORM_NAME, ago, friendlyError, num } from "../format";

type Filter = "all" | CommentState;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "unanswered", label: "وەڵام نەدراوە" },
  { key: "all", label: "هەموو" },
  { key: "answered", label: "وەڵام دراوە" },
  { key: "hidden", label: "شاردراوە" },
];

const STATE_BADGE: Record<CommentState, { cls: string; label: string }> = {
  unanswered: { cls: "warn", label: "چاوەڕێی وەڵامە" },
  answered: { cls: "", label: "وەڵام دراوە" },
  hidden: { cls: "ghost", label: "شاردراوە" },
};

export function CommentsClient({
  initialPosts,
  errors,
  whatsappPath,
  connected,
}: {
  initialPosts: MPost[];
  errors: { platform: Platform; message: string }[];
  whatsappPath: string | null;
  connected: Record<Platform, boolean>;
}) {
  const router = useRouter();
  const [posts, setPosts] = useState(initialPosts);
  const counts = useMemo(() => countStates(posts), [posts]);
  const [filter, setFilter] = useState<Filter>(counts.unanswered > 0 ? "unanswered" : "all");
  const [refreshing, startRefresh] = useTransition();
  const [waUrl, setWaUrl] = useState<string | null>(null);

  useEffect(() => setPosts(initialPosts), [initialPosts]);
  useEffect(() => setWaUrl(whatsappPath ? `${window.location.origin}${whatsappPath}` : null), [whatsappPath]);

  const total = counts.unanswered + counts.answered + counts.hidden;
  const visible = posts
    .map((p) => ({ post: p, comments: p.comments.filter((c) => filter === "all" || commentState(c) === filter) }))
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
          <h2 className="gm-title kufi">کۆمێنتەکان</h2>
          <p className="gm-sub">{num(total)} کۆمێنت لە دوایین پۆستەکانی فەیسبووک و ئینستاگرام</p>
        </div>
        <button
          type="button"
          className="gm-btn quiet small"
          onClick={() => startRefresh(() => router.refresh())}
          disabled={refreshing}
          aria-label="نوێکردنەوە"
        >
          <RefreshCw size={14} aria-hidden="true" />
          {refreshing ? "…" : "نوێ"}
        </button>
      </div>

      {(!connected.FB || !connected.IG) && (
        <p className="gm-note" style={{ marginBottom: 12 }}>
          {!connected.FB && !connected.IG
            ? "هیچ پەیجێک پەیوەست نەکراوە."
            : `${!connected.FB ? "فەیسبووک" : "ئینستاگرام"} پەیوەست نەکراوە.`}{" "}
          <Link href="/app/settings" className="gm-link">پەیوەستی بکە</Link>
        </p>
      )}
      {errors.map((e) => (
        <p key={e.platform} className="gm-note warn" style={{ marginBottom: 12 }}>
          {PLATFORM_NAME[e.platform]}: {friendlyError(e.message)}
        </p>
      ))}

      <div className="gm-chips" role="group" aria-label="پاڵاوتن" style={{ marginBottom: 14 }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className="gm-chip"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {f.label} {num(f.key === "all" ? total : counts[f.key])}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="gm-empty">
          <b className="kufi">{filter === "unanswered" ? "هەموو کۆمێنتەکان وەڵام دراونەتەوە" : "هیچ کۆمێنتێک نییە"}</b>
          {filter === "unanswered" ? "هیچ کڕیارێک چاوەڕێ ناکات." : <Link href="/app/publish" className="gm-link">پۆستێکی نوێ بڵاو بکەرەوە</Link>}
        </div>
      ) : (
        <div className="gm-stack">
          {visible.map(({ post, comments }) => (
            <section key={`${post.platform}-${post.id}`} className="gm-card" aria-label={`پۆستی ${PLATFORM_NAME[post.platform]}`}>
              <div className="gm-post">
                {post.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={post.thumbUrl} alt="" className="gm-thumb" loading="lazy" />
                ) : (
                  <div className="gm-thumb" aria-hidden="true" />
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="gm-row" style={{ gap: 8 }}>
                    <span className={`gm-plat ${post.platform}`}>{PLATFORM_NAME[post.platform]}</span>
                    <span className="gm-time">{ago(post.createdAt)}</span>
                    {post.permalink && (
                      <a href={post.permalink} target="_blank" rel="noreferrer" className="gm-link" style={{ marginInlineStart: "auto", fontSize: 12 }}>
                        <ExternalLink size={13} aria-hidden="true" /> پۆستەکە
                      </a>
                    )}
                  </div>
                  <p dir="auto">{post.caption || "(بێ دەق)"}</p>
                </div>
              </div>

              {comments.map((c) => (
                <CommentItem
                  key={c.id}
                  comment={c}
                  waUrl={waUrl}
                  onReplied={(text) =>
                    patchComment(c.platform, c.id, (x) => ({
                      ...x,
                      replies: [...x.replies, { id: `local-${Date.now()}`, author: "تۆ", text, fromUs: true, createdAt: new Date().toISOString() }],
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
  waUrl,
  onReplied,
  onHidden,
  onDeleted,
}: {
  comment: MComment;
  waUrl: string | null;
  onReplied: (text: string) => void;
  onHidden: (hidden: boolean) => void;
  onDeleted: () => void;
}) {
  const state = commentState(c);
  const badge = c.fromUs ? { cls: "ghost", label: "کۆمێنتی تۆ" } : STATE_BADGE[state];
  const [replying, setReplying] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggleHidden() {
    setError(null);
    start(async () => {
      const r = await setCommentHiddenAction(c.platform, c.id, !c.hidden);
      if (r.ok) onHidden(!c.hidden);
      else setError(friendlyError(r.error));
    });
  }

  function remove() {
    setError(null);
    start(async () => {
      const r = await deleteCommentAction(c.platform, c.id);
      if (r.ok) onDeleted();
      else {
        setConfirmDelete(false);
        setError(friendlyError(r.error));
      }
    });
  }

  return (
    <div className={`gm-comment ${state === "unanswered" ? "unanswered" : ""}`}>
      <div className="gm-between">
        <span className="gm-who" dir="auto">{c.fromUs ? "تۆ" : c.author || "بەکارهێنەر"}</span>
        <span className="gm-row" style={{ gap: 8 }}>
          <span className={`gm-badge ${badge.cls}`}>{badge.label}</span>
          <span className="gm-time">{ago(c.createdAt)}</span>
        </span>
      </div>
      <p className="gm-text" dir="auto">{c.text || "(بێ دەق)"}</p>

      {c.replies.map((r) => (
        <div key={r.id} className={`gm-reply ${r.fromUs ? "us" : ""}`}>
          <b>{r.fromUs ? "وەڵامی تۆ" : r.author}</b> · <span dir="auto">{r.text}</span>
        </div>
      ))}

      {confirmDelete ? (
        <div className="gm-note warn" style={{ marginTop: 10 }}>
          ئەم کۆمێنتە بۆ هەمیشە دەسڕدرێتەوە. دڵنیایت؟
          <div className="gm-actions">
            <button type="button" className="gm-btn danger small" onClick={remove} disabled={pending}>
              {pending ? "دەسڕدرێتەوە…" : "بەڵێ، بیسڕەوە"}
            </button>
            <button type="button" className="gm-btn quiet small" onClick={() => setConfirmDelete(false)} disabled={pending}>
              نا
            </button>
          </div>
        </div>
      ) : (
        <div className="gm-actions">
          {!replying && !c.fromUs && (
            <button type="button" className="gm-btn small" onClick={() => setReplying(true)} disabled={pending}>
              <Reply size={14} aria-hidden="true" /> وەڵام
            </button>
          )}
          <button type="button" className="gm-btn quiet small" onClick={toggleHidden} disabled={pending}>
            {c.hidden ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
            {c.hidden ? "دەریبخەرەوە" : "بیشارەوە"}
          </button>
          <button type="button" className="gm-btn quiet small" onClick={() => setConfirmDelete(true)} disabled={pending}>
            <Trash2 size={14} aria-hidden="true" /> بیسڕەوە
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
