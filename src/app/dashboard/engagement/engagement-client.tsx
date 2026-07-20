"use client";

import { useEffect, useState, useTransition } from "react";
import { RefreshCw, Sparkles, Send, EyeOff, Eye, MessageCircle, BarChart3, Mail, Youtube, ThumbsUp } from "lucide-react";
import { toast } from "sonner";

import {
  loadEngagement,
  replyCommentAction,
  hideCommentAction,
  sendDmAction,
  replyFbCommentAction,
  hideFbCommentAction,
  sendMessengerAction,
  draftReplyAction,
  type EngagementData,
} from "./actions";

type Platform = "META_INSTAGRAM" | "META_FACEBOOK";

export function EngagementClient() {
  const [data, setData] = useState<EngagementData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    loadEngagement()
      .then(setData)
      .finally(() => setLoading(false));
  };
  useEffect(refresh, []);

  if (loading && !data) {
    return <Shell><div className="text-sm text-fg-dim font-mono">loading engagement…</div></Shell>;
  }
  if (!data?.connected && !data?.facebook.connected && !data?.youtube.connected) {
    return (
      <Shell>
        <div className="rounded-xl border border-line bg-panel px-6 py-16 text-center text-sm text-fg-dim">
          no account connected — connect instagram, a facebook page or youtube from{" "}
          <a href="/dashboard/integrations" className="text-money underline">integrations</a>.
        </div>
      </Shell>
    );
  }

  return (
    <Shell onRefresh={refresh} loading={loading}>
      {data.errors.length > 0 && (
        <div className="rounded-md border border-amber/40 bg-amber/10 p-3 text-[11px] text-amber font-mono">
          {data.errors.map((e, i) => <div key={i}>↳ {e}</div>)}
        </div>
      )}

      {data.connected && (
        <Surface
          platform="META_INSTAGRAM"
          account={data.account}
          insights={data.insights}
          postGroups={data.media
            .filter((m) => m.comments.length > 0)
            .map((m) => ({
              id: m.id,
              title: m.caption?.slice(0, 60) || m.media_type || "post",
              permalink: m.permalink,
              comments: m.comments.map((c) => ({ id: c.id, username: c.username, text: c.text ?? "" })),
            }))}
          conversations={data.conversations.map((conv) => ({
            id: conv.id,
            participant: conv.participantName ?? conv.participantId ?? "user",
            recipientId: conv.participantId ?? "",
            withinWindow: conv.withinWindow,
            messages: conv.messages.map((m) => ({ id: m.id, text: m.text, fromBusiness: m.fromBusiness })),
          }))}
          onDone={refresh}
        />
      )}

      {data.facebook.connected && (
        <Surface
          platform="META_FACEBOOK"
          account={data.facebook.account}
          insights={data.facebook.insights}
          postGroups={data.facebook.posts
            .filter((p) => p.comments.length > 0)
            .map((p) => ({
              id: p.id,
              title: p.message?.slice(0, 60) || "post",
              permalink: p.permalink_url,
              comments: p.comments.map((c) => ({ id: c.id, username: c.username, text: c.message ?? "" })),
            }))}
          conversations={data.facebook.conversations.map((conv) => ({
            id: conv.id,
            participant: conv.participantName ?? conv.participantId ?? "user",
            recipientId: conv.participantId ?? "",
            withinWindow: conv.withinWindow,
            messages: conv.messages.map((m) => ({ id: m.id, text: m.text, fromBusiness: m.fromPage })),
          }))}
          onDone={refresh}
        />
      )}

      {data.youtube.connected && (
        <YouTubePanel
          account={data.youtube.account}
          stats={data.youtube.stats}
          videos={data.youtube.videos}
        />
      )}
    </Shell>
  );
}

// ---- youtube (read-only: channel counters + recent uploads) ----------------
//
//  No comment/DM surface here — the youtube.readonly scope covers statistics
//  only, so this panel reports rather than acts.

function YouTubePanel({ account, stats, videos }: {
  account?: { name: string; avatarUrl: string | null; scopes: string[] };
  stats: { name: string; value: number }[];
  videos: {
    id: string;
    title?: string;
    publishedAt?: string;
    thumbnailUrl?: string;
    permalinkUrl: string;
    views: number;
    likes: number;
    comments: number;
  }[];
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-money/40 bg-panel p-4 flex items-center gap-3">
        {account?.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={account.avatarUrl} alt="" className="h-10 w-10 rounded-full border border-line object-cover" />
        )}
        <div className="min-w-0">
          <div className="font-mono text-fg">{account?.name}</div>
          <div className="text-[10px] text-fg-dim font-mono truncate">
            youtube · {account?.scopes.map((s) => s.replace("https://www.googleapis.com/auth/", "")).join(" · ")}
          </div>
        </div>
        <span className="ml-auto led" />
      </div>

      <Section icon={<BarChart3 className="h-3.5 w-3.5" />} title="channel">
        {stats.length === 0 ? (
          <Empty>no channel stats available yet</Empty>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {stats.map((m) => (
              <div key={m.name} className="rounded-lg border border-line bg-panel-2 p-3">
                <div className="font-mono text-2xl text-money">{m.value.toLocaleString()}</div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim mt-1">{m.name}</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section icon={<Youtube className="h-3.5 w-3.5" />} title="recent uploads">
        {videos.length === 0 ? (
          <Empty>nothing uploaded yet — youtube posts need a VIDEO source asset</Empty>
        ) : (
          <div className="space-y-2">
            {videos.map((v) => (
              <a
                key={v.id}
                href={v.permalinkUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 rounded-lg border border-line bg-panel-2 p-2 hover:border-money/40"
              >
                {v.thumbnailUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.thumbnailUrl} alt="" className="h-10 w-16 rounded border border-line object-cover shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-fg truncate">{v.title ?? v.id}</div>
                  {v.publishedAt && (
                    <div className="font-mono text-[10px] text-fg-dim mt-0.5">
                      {new Date(v.publishedAt).toLocaleDateString()}
                    </div>
                  )}
                </div>
                <div className="font-mono text-[10px] text-fg-dim flex items-center gap-3 shrink-0">
                  <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" />{v.views.toLocaleString()}</span>
                  <span className="inline-flex items-center gap-1"><ThumbsUp className="h-3 w-3" />{v.likes.toLocaleString()}</span>
                  <span className="inline-flex items-center gap-1"><MessageCircle className="h-3 w-3" />{v.comments.toLocaleString()}</span>
                </div>
              </a>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

// ---- one connected surface (instagram / facebook page) --------------------

interface SurfacePost { id: string; title: string; permalink?: string; comments: { id: string; username?: string; text: string }[] }
interface SurfaceConv { id: string; participant: string; recipientId: string; withinWindow: boolean; messages: { id: string; text?: string; fromBusiness: boolean }[] }

function Surface({ platform, account, insights, postGroups, conversations, onDone }: {
  platform: Platform;
  account?: { name: string; avatarUrl: string | null; scopes: string[] };
  insights: { name: string; value: number }[];
  postGroups: SurfacePost[];
  conversations: SurfaceConv[];
  onDone: () => void;
}) {
  const fb = platform === "META_FACEBOOK";
  return (
    <div className="space-y-5">
      {/* account header */}
      <div className="rounded-xl border border-money/40 bg-panel p-4 flex items-center gap-3">
        {account?.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={account.avatarUrl} alt="" className="h-10 w-10 rounded-full border border-line object-cover" />
        )}
        <div className="min-w-0">
          <div className="font-mono text-fg">{account?.name}</div>
          <div className="text-[10px] text-fg-dim font-mono truncate">
            {fb ? "facebook page" : "instagram"} · {account?.scopes.join(" · ")}
          </div>
        </div>
        <span className="ml-auto led" />
      </div>

      {/* insights */}
      <Section icon={<BarChart3 className="h-3.5 w-3.5" />} title={fb ? "page insights" : "insights"}>
        {insights.length === 0 ? (
          <Empty>no insights available yet</Empty>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {insights.map((m) => (
              <div key={m.name} className="rounded-lg border border-line bg-panel-2 p-3">
                <div className="font-mono text-2xl text-money">{m.value.toLocaleString()}</div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim mt-1">{m.name.replace(/_/g, " ")}</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* comments */}
      <Section icon={<MessageCircle className="h-3.5 w-3.5" />} title="comments">
        {postGroups.length === 0 ? (
          <Empty>no comments yet — post something and reply to comments here</Empty>
        ) : (
          <div className="space-y-3">
            {postGroups.map((p) => (
              <div key={p.id} className="rounded-lg border border-line bg-panel-2 p-3">
                <div className="flex items-center gap-2 text-[11px] text-fg-dim font-mono mb-2">
                  <span className="truncate">{p.title}</span>
                  {p.permalink && (
                    <a href={p.permalink} target="_blank" rel="noreferrer" className="ml-auto text-money underline shrink-0">view</a>
                  )}
                </div>
                <ul className="space-y-2">
                  {p.comments.map((c) => (
                    <CommentRow key={c.id} platform={platform} commentId={c.id} username={c.username} text={c.text} onDone={onDone} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* direct messages / messenger */}
      <Section icon={<Mail className="h-3.5 w-3.5" />} title={fb ? "messenger" : "direct messages"}>
        {conversations.length === 0 ? (
          <Empty>no conversations yet — message the {fb ? "page" : "account"} to see it here</Empty>
        ) : (
          <div className="space-y-3">
            {conversations.map((conv) => (
              <ConversationRow
                key={conv.id}
                platform={platform}
                participant={conv.participant}
                recipientId={conv.recipientId}
                messages={conv.messages}
                withinWindow={conv.withinWindow}
                onDone={onDone}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

// ---- comment row ----------------------------------------------------------

function CommentRow({ platform, commentId, username, text, onDone }: { platform: Platform; commentId: string; username?: string; text: string; onDone: () => void }) {
  const [reply, setReply] = useState("");
  const [pending, startTransition] = useTransition();

  const draft = () =>
    startTransition(async () => {
      const r = await draftReplyAction(text, "comment");
      if (r.ok && r.reply) setReply(r.reply);
      else toast.error(r.error ?? "draft failed");
    });
  const fb = platform === "META_FACEBOOK";
  const send = () =>
    startTransition(async () => {
      const r = fb ? await replyFbCommentAction(commentId, reply) : await replyCommentAction(commentId, reply);
      if (r.ok) { toast.success("reply posted"); setReply(""); onDone(); }
      else toast.error(r.error ?? "reply failed");
    });
  const hide = () =>
    startTransition(async () => {
      const r = fb ? await hideFbCommentAction(commentId, true) : await hideCommentAction(commentId, true);
      if (r.ok) { toast.success("comment hidden"); onDone(); }
      else toast.error(r.error ?? "hide failed");
    });

  return (
    <li className="rounded-md border border-line bg-bg p-2.5">
      <div className="text-xs">
        <span className="font-mono text-money">@{username ?? "user"}</span>
        <span className="text-fg ml-2">{text}</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="write a reply…"
          className="flex-1 rounded border border-line bg-panel px-2.5 py-1.5 text-xs font-mono"
        />
        <IconBtn onClick={draft} pending={pending} title="AI draft"><Sparkles className="h-3.5 w-3.5" /></IconBtn>
        <IconBtn onClick={send} pending={pending} disabled={!reply.trim()} primary title="reply"><Send className="h-3.5 w-3.5" /></IconBtn>
        <IconBtn onClick={hide} pending={pending} title="hide"><EyeOff className="h-3.5 w-3.5" /></IconBtn>
      </div>
    </li>
  );
}

// ---- conversation row -----------------------------------------------------

function ConversationRow({ platform, participant, recipientId, messages, withinWindow, onDone }: {
  platform: Platform;
  participant: string;
  recipientId: string;
  messages: { id: string; text?: string; fromBusiness: boolean }[];
  withinWindow: boolean;
  onDone: () => void;
}) {
  const [reply, setReply] = useState("");
  const [pending, startTransition] = useTransition();
  const fb = platform === "META_FACEBOOK";
  const lastInbound = [...messages].reverse().find((m) => !m.fromBusiness)?.text ?? "";
  const canReply = withinWindow && !!recipientId;

  const draft = () =>
    startTransition(async () => {
      const r = await draftReplyAction(lastInbound, "dm");
      if (r.ok && r.reply) setReply(r.reply);
      else toast.error(r.error ?? "draft failed");
    });
  const send = () =>
    startTransition(async () => {
      const r = fb ? await sendMessengerAction(recipientId, reply) : await sendDmAction(recipientId, reply);
      if (r.ok) { toast.success(fb ? "message sent" : "DM sent"); setReply(""); onDone(); }
      else toast.error(r.error ?? "send failed");
    });

  return (
    <div className="rounded-lg border border-line bg-panel-2 p-3">
      <div className="font-mono text-[11px] text-money mb-2">@{participant}</div>
      <ul className="space-y-1.5 mb-2">
        {messages.map((m) => (
          <li key={m.id} className={`text-xs flex ${m.fromBusiness ? "justify-end" : "justify-start"}`}>
            <span className={`rounded-lg px-2.5 py-1.5 max-w-[80%] ${m.fromBusiness ? "bg-money/15 text-fg" : "bg-bg text-fg border border-line"}`}>
              {m.text}
            </span>
          </li>
        ))}
      </ul>
      {canReply ? (
        <div className="flex items-center gap-2">
          <input
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="reply…"
            className="flex-1 rounded border border-line bg-panel px-2.5 py-1.5 text-xs font-mono"
          />
          <IconBtn onClick={draft} pending={pending} title="AI draft"><Sparkles className="h-3.5 w-3.5" /></IconBtn>
          <IconBtn onClick={send} pending={pending} disabled={!reply.trim()} primary title="send"><Send className="h-3.5 w-3.5" /></IconBtn>
        </div>
      ) : (
        <div className="rounded border border-line bg-bg px-2.5 py-1.5 text-[11px] text-fg-dim">
          outside {fb ? "messenger" : "instagram"}&rsquo;s 24h reply window — you can reply once this person messages again
        </div>
      )}
    </div>
  );
}

// ---- shared bits ----------------------------------------------------------

function Shell({ children, onRefresh, loading }: { children: React.ReactNode; onRefresh?: () => void; loading?: boolean }) {
  return (
    <div className="px-6 py-8 max-w-4xl mx-auto space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">instagram</div>
          <h1 className="mt-1 font-display text-3xl">engagement</h1>
          <p className="text-sm text-fg-dim mt-1">read &amp; reply to comments and DMs, and track insights — on autopilot or by hand.</p>
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="font-mono text-xs px-3 py-1.5 rounded border border-line text-fg-dim hover:text-fg inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> refresh
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-fg-dim mb-3">
        <span className="text-money">{icon}</span> {title}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-fg-dim italic py-2">{children}</div>;
}

function IconBtn({ children, onClick, pending, disabled, primary, title }: {
  children: React.ReactNode;
  onClick: () => void;
  pending?: boolean;
  disabled?: boolean;
  primary?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={pending || disabled}
      title={title}
      className={`shrink-0 rounded px-2 py-1.5 text-xs inline-flex items-center disabled:opacity-40 ${
        primary ? "bg-money text-bg" : "border border-line text-fg-dim hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}
