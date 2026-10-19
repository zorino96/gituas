"use client";

// The chat's Accounts: the Facebook Pages, Instagram accounts, TikTok accounts and YouTube channels that are connected, the one the chat
// works with marked, a one-tap way to choose another, and the buttons that connect one more. It is drawn in the sheet the header's
// Accounts button opens, and inline when the chat shows an { kind: "accounts" } block, so the person never has to leave the chat for
// Settings. `ChatAccounts` asks the server; `AccountsView` only draws what it is given (the tests and the dev preview use it as it is).
// This file imports nothing from the chat frame (the frame imports this one).

import { useCallback, useEffect, useId, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";

import { useT } from "@/lib/i18n/client";
import type { AccountItem, AccountPlatform, ChatAccountsResult, ChatAccountsState } from "./account-actions";

/** What the Accounts screen needs from the server. In the app these are the server actions of account-actions.ts; the dev preview brings its own. */
export interface AccountsApi {
  list(input?: { workspaceId?: string }): Promise<ChatAccountsResult>;
  choose(input: { platform: AccountPlatform; id: string; workspaceId?: string }): Promise<ChatAccountsResult>;
}

// The real server actions, loaded on first use: a screen that is only drawn (a test, the dev preview) never pulls the server in.
export const lazyAccountsApi: AccountsApi = {
  list: async (input) => (await import("./account-actions")).listChatAccountsAction(input),
  choose: async (input) => (await import("./account-actions")).chooseChatAccountAction(input),
};

const PLATFORMS: readonly AccountPlatform[] = ["FB", "IG", "TT", "YT"];
const PROVIDER_PATH: Record<AccountPlatform, string> = { FB: "meta_facebook", IG: "meta_instagram", TT: "tiktok", YT: "youtube" };

/** Where the person lands after connecting: the chat they are in (the OAuth start route only takes addresses under /app and /newsroom). */
export const chatPathOf = (kind: "shop" | "news"): string => (kind === "news" ? "/newsroom/assistant" : "/app/assistant");

/**
 * The Connect button's address. `ack=1` is on it only once the person has ticked the box that says they own the account (as Settings
 * does): a long-press or a middle-click follows the address without the click handler, and must not write down a confirmation that
 * was never given.
 */
export const connectHref = (platform: AccountPlatform, kind: "shop" | "news", ack = false): string =>
  `/api/oauth/${PROVIDER_PATH[platform]}/start?next=${chatPathOf(kind)}${ack ? "&ack=1" : ""}`;

/**
 * The accounts the chat can switch between. It posts, replies and reads as a Facebook Page and as an Instagram account; it has no tool
 * for TikTok or YouTube, so those are listed and can be connected, but there is nothing to choose and nothing to say the chat works with.
 */
export const CHOOSABLE: readonly AccountPlatform[] = ["FB", "IG"];
export const canChoose = (platform: AccountPlatform): boolean => CHOOSABLE.includes(platform);

// A name from the platform (Latin, Arabic, an @handle) sits inside a sentence of the other direction: it is isolated, so the sentence
// keeps its order. Built from code points (first-strong isolate, pop directional isolate); no invisible character is written in the source.
const isolate = (text: string): string => `${String.fromCodePoint(0x2068)}${text}${String.fromCodePoint(0x2069)}`;

// ---------------------------------------------------------------------------------------------------------------------
// What is shared between the screens that are open at once (the sheet and an inline card, or two cards of one chat).

// The list is read once for the screens that open together; a choice makes the next read a new one.
const reads = new WeakMap<AccountsApi, { workspaceId: string; at: number; promise: Promise<ChatAccountsResult> }>();
function readList(api: AccountsApi, workspaceId: string | undefined, fresh: boolean): Promise<ChatAccountsResult> {
  const hit = reads.get(api);
  if (!fresh && hit && hit.workspaceId === (workspaceId ?? "") && Date.now() - hit.at < 1500) return hit.promise;
  const promise = api.list({ workspaceId });
  reads.set(api, { workspaceId: workspaceId ?? "", at: Date.now(), promise });
  return promise;
}

// A choice made in one screen is drawn at once in the others. Only the platform that was answered travels: a choice that is still
// waiting for its answer on another platform is not touched.
const listeners = new Set<(platform: AccountPlatform, id: string | null) => void>();
export const onPick = (fn: (platform: AccountPlatform, id: string | null) => void): (() => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
export const broadcastPick = (platform: AccountPlatform, id: string | null): void => {
  for (const fn of listeners) fn(platform, id);
};

// ---------------------------------------------------------------------------------------------------------------------
// Choosing an account: what is drawn, and the order in which taps and answers are handled. Pure (no React, no server), so it is tested as it is.

type Mark = { platform: AccountPlatform; text: string };

export interface ChooseView {
  state: ChatAccountsState | null;
  /** The line under a platform after its account was switched. */
  notice: Mark | null;
  /** The line under a platform when the switch did not work. */
  error: Mark | null;
}

export type ChooseAction =
  | { type: "loaded"; state: ChatAccountsState }
  /** The person tapped an account: it is drawn as chosen at once, and the lines of the last switch go. */
  | { type: "tap"; platform: AccountPlatform; id: string }
  /** What one platform has chosen, from the server's answer, from another screen, or taken back after a refusal. Nothing else changes. */
  | { type: "pick"; platform: AccountPlatform; id: string | null }
  | { type: "notice"; mark: Mark }
  | { type: "error"; mark: Mark };

export const FRESH_VIEW: ChooseView = { state: null, notice: null, error: null };

/** The same accounts with one platform's choice changed (the very same object when nothing changes). */
export function withSelected(state: ChatAccountsState, platform: AccountPlatform, id: string | null): ChatAccountsState {
  return state.selected[platform] === id ? state : { ...state, selected: { ...state.selected, [platform]: id } };
}

export function chooseReducer(view: ChooseView, action: ChooseAction): ChooseView {
  switch (action.type) {
    case "loaded":
      return { ...view, state: action.state };
    case "tap":
      return { state: view.state && withSelected(view.state, action.platform, action.id), notice: null, error: null };
    case "pick":
      return view.state ? { ...view, state: withSelected(view.state, action.platform, action.id) } : view;
    case "notice":
      return { ...view, notice: action.mark, error: null };
    case "error":
      return { ...view, notice: null, error: action.mark };
  }
}

// The latest tap on a platform decides, in whichever screen it was made: the answer to an earlier tap is dropped, because a newer one is
// on its way and would be undone by it.
const taps: Record<AccountPlatform, number> = { FB: 0, IG: 0, TT: 0, YT: 0 };

export interface ChooseFlow {
  api: Pick<AccountsApi, "choose">;
  workspaceId?: string;
  /** Whether the screen that started the tap is still on the page. */
  alive(): boolean;
  /** Changes what this screen draws. */
  dispatch(action: ChooseAction): void;
  /** Tells every screen that is open (this one too) what the server saved for a platform. */
  broadcast(platform: AccountPlatform, id: string | null): void;
  /** The next read of the list must be a new one. */
  forget(): void;
  /** The words, in the person's language. */
  say: { chosen(platform: AccountPlatform, name: string): string; refused: string; failed(r: ChatAccountsResult | null): string };
}

/**
 * One tap on an account: drawn at once, saved on the server, taken back if the server says no. What the server saved is told to every
 * open screen even when the one that asked has been closed meanwhile; the sentence and the take-back belong to the screen that asked.
 */
export async function runChoose(flow: ChooseFlow, shown: ChatAccountsState | null, platform: AccountPlatform, id: string): Promise<void> {
  if (!shown || !canChoose(platform) || shown.selected[platform] === id) return;
  const before = shown.selected[platform];
  const tap = ++taps[platform];
  flow.dispatch({ type: "tap", platform, id });
  let r: ChatAccountsResult | null = null;
  try {
    r = await flow.api.choose({ platform, id, workspaceId: flow.workspaceId });
  } catch {
    r = null;
  }
  flow.forget();
  const latest = tap === taps[platform];
  if (r?.ok && latest) flow.broadcast(platform, r.selected[platform]);
  if (!latest || !flow.alive()) return;
  if (r?.ok) {
    const item = r.lists[platform].find((a) => a.id === id);
    if (r.selected[platform] === id && item) flow.dispatch({ type: "notice", mark: { platform, text: flow.say.chosen(platform, item.name) } });
    else flow.dispatch({ type: "error", mark: { platform, text: flow.say.refused } });
  } else {
    flow.dispatch({ type: "pick", platform, id: before });
    flow.dispatch({ type: "error", mark: { platform, text: flow.say.failed(r) } });
  }
}

function Face({ item }: { item: AccountItem }) {
  const [broken, setBroken] = useState(false);
  if (item.avatarUrl && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="ca-av" src={item.avatarUrl} alt="" width={32} height={32} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  return (
    <span className="ca-av ph" aria-hidden="true">
      {Array.from(item.name.replace(/^[@/]+/, ""))[0] ?? "?"}
    </span>
  );
}

/**
 * Draws the accounts it is given. Choosing is offered only when `onChoose` is given, the workspace is a shop, and only between Facebook
 * Pages and between Instagram accounts (the chat has no TikTok or YouTube tool); a news desk connects only.
 */
export function AccountsView({
  state,
  onChoose,
  notice,
  error,
  compact = false,
}: {
  state: ChatAccountsState;
  onChoose?: (platform: AccountPlatform, id: string) => void;
  /** The line under a platform after its account was switched. */
  notice?: Mark | null;
  /** The line under a platform when the switch did not work. */
  error?: Mark | null;
  /** Without the sentence above the list (the inline card has its own title and the message before it). */
  compact?: boolean;
}) {
  const all = useT();
  const t = all.chat.accounts;
  const uid = useId();
  const [ack, setAck] = useState(false);
  const [needAck, setNeedAck] = useState(false);
  const ackBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try {
      setAck(window.localStorage.getItem("gm_authority_ack") === "1");
    } catch {
      /* the box starts empty */
    }
  }, []);

  const shop = state.kind === "shop";
  const choosing = shop && state.canConfigure && !!onChoose;
  const connectLink = (platform: AccountPlatform, label: string, quiet: boolean) => (
    <a
      className={`gm-btn small${quiet ? " quiet" : ""}`}
      href={connectHref(platform, state.kind, ack)}
      aria-label={`${label} (${t.kind[platform]})`}
      onClick={(e) => {
        // Not before the person said they own the account (or may manage it): the box is where they do.
        if (!ack) {
          e.preventDefault();
          setNeedAck(true);
          ackBox.current?.focus();
        }
      }}
    >
      {label}
    </a>
  );

  return (
    <div className="ca">
      {!compact && <p className="ca-sub">{shop ? t.sub : t.deskSub}</p>}

      {/* Above the Connect buttons: the texts say "the box above". */}
      {state.canConfigure && (
        <div className="ca-ackbox">
          <label className="ch-ack">
            <input
              ref={ackBox}
              type="checkbox"
              checked={ack}
              aria-describedby={needAck && !ack ? `${uid}-ack` : undefined}
              onChange={(e) => {
                setAck(e.target.checked);
                if (e.target.checked) setNeedAck(false);
                try {
                  window.localStorage.setItem("gm_authority_ack", e.target.checked ? "1" : "0");
                } catch {
                  /* not remembered */
                }
              }}
            />
            <small>{all.settings.authorityAck}</small>
          </label>
          {needAck && !ack && (
            <p id={`${uid}-ack`} className="ch-err" role="alert">
              {all.settings.authorityNeeded}
            </p>
          )}
        </div>
      )}

      {PLATFORMS.map((p) => {
        const list = state.lists[p];
        const picked = state.selected[p];
        const headId = `${uid}-h-${p}`;
        // Only a Page and an Instagram account are ones the chat works as: TikTok and YouTube are listed and connected, never "in use".
        const used = canChoose(p);
        return (
          <div key={p} className="ca-group" role="group" aria-labelledby={headId}>
            <b id={headId} className="ca-head">
              {t.kind[p]}
            </b>
            {list.length === 0 ? (
              <p className="ca-empty">{t.empty}</p>
            ) : choosing && used && list.length > 1 ? (
              <div className="ca-opts" role="radiogroup" aria-labelledby={headId}>
                {list.map((a) => {
                  const on = picked === a.id;
                  return (
                    <label key={a.id} className={`ca-opt${on ? " on" : ""}`}>
                      <input type="radio" name={`${uid}-${p}`} value={a.id} checked={on} onChange={() => onChoose?.(p, a.id)} />
                      <Face item={a} />
                      <span className="ca-name" dir="auto">
                        {a.name}
                      </span>
                      {on && <span className="ch-pill ca-pill">{t.inUse}</span>}
                    </label>
                  );
                })}
              </div>
            ) : (
              <ul className="ca-opts">
                {list.map((a) => (
                  <li key={a.id} className="ca-opt static">
                    <Face item={a} />
                    <span className="ca-name" dir="auto">
                      {a.name}
                    </span>
                    {shop && used && picked === a.id && <span className="ch-pill ca-pill">{t.inUse}</span>}
                  </li>
                ))}
              </ul>
            )}
            {used ? (
              <p className="ch-ok ca-live" role="status" aria-live="polite">
                {notice?.platform === p ? notice.text : ""}
              </p>
            ) : (
              <p className="ca-empty">{t.noPost}</p>
            )}
            {error?.platform === p && (
              <p className="ch-err" role="alert">
                {error.text}
              </p>
            )}
            {state.canConfigure && <div className="ca-actions">{connectLink(p, list.length ? t.connectAnother : t.connect, list.length > 0)}</div>}
          </div>
        );
      })}

      {shop && (
        <div className="ca-group">
          <b>{all.wa.nav}</b>
          <p className="ca-empty">{t.whatsappHelp}</p>
          <div className="ca-actions">
            <Link className="gm-btn small quiet" href="/app/whatsapp" prefetch={false}>
              {t.whatsappOpen}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** Asks the server for the accounts, draws them, and saves a choice at once. */
export function ChatAccounts({ api = lazyAccountsApi, workspaceId, inline = false }: { api?: AccountsApi; workspaceId?: string | null; inline?: boolean }) {
  const all = useT();
  const t = all.chat.accounts;
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [failure, setFailure] = useState("");
  const [view, dispatch] = useReducer(chooseReducer, FRESH_VIEW);
  const { state, notice, error } = view;
  const alive = useRef(true);
  const ws = workspaceId ?? undefined;

  // Said in the person's words when the session itself is the problem; any other failure is the general line.
  const said = useCallback(
    (r: ChatAccountsResult | null, fallback: string): string => (r && !r.ok && (r.code === "signin" || r.code === "forbidden" || r.code === "workspace") ? all.chat.errors[r.code] : fallback),
    [all.chat.errors],
  );

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(
    async (fresh: boolean) => {
      setPhase("loading");
      let r: ChatAccountsResult | null = null;
      try {
        r = await readList(api, ws, fresh);
      } catch {
        r = null;
      }
      if (!alive.current) return;
      if (r?.ok) {
        dispatch({ type: "loaded", state: r });
        setPhase("ready");
      } else {
        setFailure(said(r, t.loadFailed));
        setPhase("error");
      }
    },
    [api, ws, said, t.loadFailed],
  );
  useEffect(() => void load(false), [load]);

  // What another open screen saved for a platform is drawn here at once (only that platform's choice).
  useEffect(() => onPick((platform, id) => dispatch({ type: "pick", platform, id })), []);

  const choose = (platform: AccountPlatform, id: string) =>
    void runChoose(
      {
        api,
        workspaceId: ws,
        alive: () => alive.current,
        dispatch,
        broadcast: broadcastPick,
        forget: () => void reads.delete(api),
        say: { chosen: (p, name) => t.chosen(t.kind[p], isolate(name)), refused: t.chooseFailed, failed: (r) => said(r, t.chooseFailed) },
      },
      state,
      platform,
      id,
    );

  const body =
    phase === "ready" && state ? (
      <AccountsView state={state} onChoose={choose} notice={notice} error={error} compact={inline} />
    ) : phase === "error" ? (
      <div className="ch-error" role="alert">
        <p>{failure}</p>
        <div className="ch-error-actions">
          <button type="button" className="gm-btn quiet small" onClick={() => void load(true)}>
            {t.retry}
          </button>
        </div>
      </div>
    ) : (
      <div className="ca" aria-busy="true">
        <p className="ca-loading" role="status">
          <LoaderCircle className="ch-spin" size={16} aria-hidden="true" />
          {t.loading}
        </p>
        <div className="ca-skel" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </div>
    );

  return inline ? (
    <section className="ch-block">
      <h3 className="ch-block-title">{t.title}</h3>
      {body}
    </section>
  ) : (
    body
  );
}
