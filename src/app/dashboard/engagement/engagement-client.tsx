"use client";

import { useEffect, useState, useTransition } from "react";
import { RefreshCw, Sparkles, Send, EyeOff, MessageCircle, BarChart3, Mail } from "lucide-react";
import { toast } from "sonner";

import {
  loadEngagement,
  replyCommentAction,
  hideCommentAction,
  sendDmAction,
  draftReplyAction,
  type EngagementData,
} from "./actions";

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
  if (!data?.connected) {
    return (
      <Shell>
        <div className="rounded-xl border border-line bg-panel px-6 py-16 text-center text-sm text-fg-dim">
          instagram not connected — connect it from{" "}
          <a href="/dashboard/integrations" className="text-money underline">integrations</a>.
        </div>
      </Shell>
    );
  }

  return (
    <Shell onRefresh={refresh} loading={loading}>
      {/* account header */}
      <div className="rounded-xl border border-money/40 bg-panel p-4 flex items-center gap-3">
        {data.account?.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.account.avatarUrl} alt="" className="h-10 w-10 rounded-full border border-line object-cover" />
        )}
        <div className="min-w-0">
          <div className="font-mono text-fg">{data.account?.name}</div>
          <div className="text-[10px] text-fg-dim font-mono truncate">{data.account?.scopes.join(" · ")}</div>
        </div>
        <span className="ml-auto led" />
      </div>

      {data.errors.length > 0 && (
        <div className="rounded-md border border-amber/40 bg-amber/10 p-3 text-[11px] text-amber font-mono">
          {data.errors.map((e, i) => <div key={i}>↳ {e}</div>)}
        </div>
      )}

      {/* insights */}
      <Section icon={<BarChart3 className="h-3.5 w-3.5" />} title="insights">
        {data.insights.length === 0 ? (
          <Empty>no insights available yet</Empty>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {data.insights.map((m) => (
              <div key={m.name} className="rounded-lg border border-line bg-panel-2 p-3">
                <div className="font-mono text-2xl text-money">{m.value.toLocaleString()}</div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim mt-1">
                  {m.name.replace(/_/g, " ")}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* comments */}
      <Section icon={<MessageCircle className="h-3.5 w-3.5" />} title="comments">
        {data.media.every((m) => m.comments.length === 0) ? (
          <Empty>no comments yet — post one on a Reel to see it here</Empty>
        ) : (
          <div className="space-y-3">
            {data.media.filter((m) => m.comments.length > 0).map((m) => (
              <div key={m.id} className="rounded-lg border border-line bg-panel-2 p-3">
                <div className="flex items-center gap-2 text-[11px] text-fg-dim font-mono mb-2">
                  <span className="truncate">{m.caption?.slice(0, 60) || m.media_type || "post"}</span>
                  {m.permalink && (
                    <a href={m.permalink} target="_blank" rel="noreferrer" className="ml-auto text-money underline shrink-0">view</a>
                  )}
                </div>
                <ul className="space-y-2">
                  {m.comments.map((c) => (
                    <CommentRow key={c.id} commentId={c.id} username={c.username} text={c.text ?? ""} onDone={refresh} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* direct messages */}
      <Section icon={<Mail className="h-3.5 w-3.5" />} title="direct messages">
        {data.conversations.length === 0 ? (
          <Empty>no conversations yet — DM the account to see it here</Empty>
        ) : (
          <div className="space-y-3">
            {data.conversations.map((conv) => (
              <ConversationRow
                key={conv.id}
                participant={conv.participantName ?? conv.participantId ?? "user"}
                recipientId={conv.participantId ?? ""}
                messages={conv.messages}
                withinWindow={conv.withinWindow}
                onDone={refresh}
              />
            ))}
          </div>
        )}
      </Section>
    </Shell>
  );
}

// ---- comment row ----------------------------------------------------------

function CommentRow({ commentId, username, text, onDone }: { commentId: string; username?: string; text: string; onDone: () => void }) {
  const [reply, setReply] = useState("");
  const [pending, startTransition] = useTransition();

  const draft = () =>
    startTransition(async () => {
      const r = await draftReplyAction(text, "comment");
      if (r.ok && r.reply) setReply(r.reply);
      else toast.error(r.error ?? "draft failed");
    });
  const send = () =>
    startTransition(async () => {
      const r = await replyCommentAction(commentId, reply);
      if (r.ok) { toast.success("reply posted"); setReply(""); onDone(); }
      else toast.error(r.error ?? "reply failed");
    });
  const hide = () =>
    startTransition(async () => {
      const r = await hideCommentAction(commentId, true);
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

function ConversationRow({ participant, recipientId, messages, withinWindow, onDone }: {
  participant: string;
  recipientId: string;
  messages: { id: string; text?: string; fromBusiness: boolean }[];
  withinWindow: boolean;
  onDone: () => void;
}) {
  const [reply, setReply] = useState("");
  const [pending, startTransition] = useTransition();
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
      const r = await sendDmAction(recipientId, reply);
      if (r.ok) { toast.success("DM sent"); setReply(""); onDone(); }
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
          outside instagram&rsquo;s 24h reply window — you can reply once this person messages again
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
