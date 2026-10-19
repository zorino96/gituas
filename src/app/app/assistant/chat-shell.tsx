"use client";

// The frame of the chat routes: a sidebar at the inline-start (a drawer on a phone), a slim header, and the screen in the
// main column. It stays mounted while the person moves between chats, so the history list does not blink. The sidebar
// holds the chat history, the classic screens, Settings, the language and support; anything a chat cannot do lives there.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronDown, LifeBuoy, Menu, MessageCircle, Pencil, Pin, PinOff, Search, Settings, SquarePen, Trash2, X, Ellipsis } from "lucide-react";

import type { ChatErrorCode, ThreadSummary } from "@/lib/chat/types";
import { useLang, useT } from "@/lib/i18n/client";
import { LANGS, type Lang } from "@/lib/i18n/lang";
import { classicHref, rememberFace } from "../face";
import { setLangAction } from "../lang-actions";
import { Pending, useSections } from "../nav";
import { groupThreads, menuTarget, upsertThread, type GroupKey } from "./chat-model";
import "../chat.css";

type Fail = { ok: false; code: ChatErrorCode };

/** What the frame needs from the server. In the app these are the server actions of chat-actions.ts; the dev preview brings its own. */
export interface ChatApi {
  list(input?: { q?: string }): Promise<{ ok: true; threads: ThreadSummary[] } | Fail>;
  rename(input: { id: string; title: string }): Promise<{ ok: boolean }>;
  pin(input: { id: string; pinned: boolean }): Promise<{ ok: boolean }>;
  remove(input: { id: string }): Promise<{ ok: boolean }>;
}

export interface ChatShellValue {
  /** A chat was created or renamed: it shows in the history at once. */
  upsertThread(thread: ThreadSummary): void;
  /** A chat just had a message: it moves to the top of Today. */
  touch(id: string): void;
  /** Goes up by one each time the person asks for a new chat; a screen that stays mounted starts over when it changes. */
  newChatSignal: number;
  /** The title the header shows ("" = a new chat, null = not known yet). */
  setTitle(title: string | null): void;
}

const NOOP: ChatShellValue = { upsertThread: () => undefined, touch: () => undefined, newChatSignal: 0, setTitle: () => undefined };
const Ctx = createContext<ChatShellValue>(NOOP);
export const useChatShell = (): ChatShellValue => useContext(Ctx);

/** Where a new chat and a stored chat live. The dev preview points them at itself. */
export interface ChatHrefs {
  newChat: string;
  thread: (id: string) => string;
}
const APP_HREFS: ChatHrefs = { newChat: "/app/assistant", thread: (id) => `/app/assistant/${id}` };

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", notify);
      return () => m.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * A phone's keyboard covers the bottom of the page: the frame is shrunk to the part that is still visible, so the composer stays
 * above the keys (Android and iOS both report that part through the visual viewport).
 */
function useKeyboardFit(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const vv = window.visualViewport;
    const el = ref.current;
    if (!vv || !el) return;
    const apply = () => {
      const covered = window.innerHeight - vv.height;
      const keyboard = covered > 120 && vv.scale <= 1.01;
      el.classList.toggle("kb", keyboard);
      if (keyboard) {
        el.style.setProperty("--ch-h", `${Math.round(vv.height)}px`);
        el.style.transform = `translateY(${Math.round(vv.offsetTop)}px)`;
      } else {
        el.style.removeProperty("--ch-h");
        el.style.transform = "";
      }
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      el.classList.remove("kb");
      el.style.removeProperty("--ch-h");
      el.style.transform = "";
    };
  }, [ref]);
}

// The list the last visit saw, so coming back from a classic screen does not start from an empty sidebar. Per tab, per workspace.
let cache: { workspaceId: string; threads: ThreadSummary[] } | null = null;

export function ChatFrame({
  api,
  kind,
  workspace,
  workspaceId,
  studio,
  video,
  support,
  onLang,
  hrefs = APP_HREFS,
  children,
}: {
  api: ChatApi;
  kind: "MERCHANT" | "NEWS";
  workspace: string;
  workspaceId: string;
  studio: boolean;
  video: boolean;
  support: { url: string; display: string };
  /** The language switch; the app's own sets the cookie and refreshes, the dev preview changes its address. */
  onLang?: (lang: Lang) => void;
  hrefs?: ChatHrefs;
  children: ReactNode;
}) {
  const t = useT();
  const c = t.chat;
  const path = usePathname();
  const router = useRouter();
  const frame = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>(cache?.workspaceId === workspaceId ? cache.threads : []);
  const [load, setLoad] = useState<"loading" | "ready" | "error">(cache?.workspaceId === workspaceId ? "ready" : "loading");
  const [open, setOpen] = useState(false);
  const [signal, setSignal] = useState(0);
  // null until the screen says which chat it is, so a first paint never shows the wrong name.
  const [title, setTitle] = useState<string | null>(null);
  const desktop = useMedia("(min-width: 960px)");
  const activeId = /^\/app\/assistant\/([^/?#]+)/.exec(path)?.[1] ?? null;

  // Closing the drawer by Escape, its X or the shade puts the keyboard back on the menu button; a link inside it moves on instead.
  const restoreFocus = useRef(false);
  const closeDrawer = useCallback(() => {
    restoreFocus.current = true;
    setOpen(false);
  }, []);
  useEffect(() => {
    if (!open && restoreFocus.current) menuButton.current?.focus();
    restoreFocus.current = false;
  }, [open]);

  useKeyboardFit(frame);
  useEffect(() => rememberFace("chat"), []);
  // The drawer is for phones: a wide window shows the sidebar for good, and a link inside the drawer closes it.
  useEffect(() => {
    if (desktop) setOpen(false);
  }, [desktop]);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeDrawer]);

  const refresh = useCallback(async () => {
    try {
      const r = await api.list();
      if (!r.ok) {
        setLoad((s) => (s === "ready" ? s : "error"));
        return;
      }
      cache = { workspaceId, threads: r.threads };
      setThreads(r.threads);
      setLoad("ready");
    } catch {
      setLoad((s) => (s === "ready" ? s : "error"));
    }
  }, [api, workspaceId]);
  useEffect(() => void refresh(), [refresh]);
  // Chats made on another device or tab show up when the person comes back to this one (at most every half minute).
  useEffect(() => {
    let last = Date.now();
    const again = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 30_000) return;
      last = Date.now();
      void refresh();
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [refresh]);

  const remember = useCallback(
    (next: (list: ThreadSummary[]) => ThreadSummary[]) => {
      setThreads((list) => {
        const out = next(list);
        cache = { workspaceId, threads: out };
        return out;
      });
    },
    [workspaceId],
  );

  const value = useMemo<ChatShellValue>(
    () => ({
      upsertThread: (thread) => remember((list) => upsertThread(list, thread)),
      touch: (id) => remember((list) => list.map((x) => (x.id === id ? { ...x, lastMessageAt: new Date().toISOString() } : x))),
      newChatSignal: signal,
      setTitle,
    }),
    [remember, signal],
  );

  const newChat = () => {
    setSignal((n) => n + 1);
    setOpen(false);
  };

  return (
    <Ctx.Provider value={value}>
      <div className="ch-frame" ref={frame}>
        {open && !desktop && <div className="ch-scrim" onClick={closeDrawer} aria-hidden="true" />}
        <Sidebar
          open={open}
          modal={open && !desktop}
          onClose={closeDrawer}
          closeRef={closeButton}
          api={api}
          threads={threads}
          load={load}
          retry={() => {
            setLoad("loading");
            void refresh();
          }}
          activeId={activeId}
          setThreads={remember}
          onNewChat={newChat}
          hrefs={hrefs}
          goNew={() => router.push(hrefs.newChat)}
          kind={kind}
          workspace={workspace}
          studio={studio}
          video={video}
          support={support}
          onLang={onLang}
        />
        <main className="ch-main" inert={open && !desktop}>
          <header className="ch-head">
            <button
              ref={menuButton}
              type="button"
              className="ch-iconbtn ch-only-phone"
              aria-label={c.frame.openList}
              aria-expanded={open}
              aria-controls="ch-side"
              onClick={() => setOpen(true)}
            >
              <Menu size={20} aria-hidden="true" />
            </button>
            <h1 className="ch-head-title" dir="auto">
              {title === null ? "" : title || c.newChat}
            </h1>
            <Link href={hrefs.newChat} className="ch-iconbtn ch-only-phone" aria-label={c.newChat} title={c.newChat} onClick={newChat}>
              <SquarePen size={19} aria-hidden="true" />
            </Link>
          </header>
          {children}
        </main>
      </div>
    </Ctx.Provider>
  );
}

function Sidebar({
  open,
  modal,
  onClose,
  closeRef,
  api,
  threads,
  load,
  retry,
  activeId,
  setThreads,
  onNewChat,
  goNew,
  hrefs,
  kind,
  workspace,
  studio,
  video,
  support,
  onLang,
}: {
  open: boolean;
  modal: boolean;
  onClose: () => void;
  closeRef: RefObject<HTMLButtonElement | null>;
  api: ChatApi;
  threads: ThreadSummary[];
  load: "loading" | "ready" | "error";
  retry: () => void;
  activeId: string | null;
  setThreads: (next: (list: ThreadSummary[]) => ThreadSummary[]) => void;
  onNewChat: () => void;
  goNew: () => void;
  hrefs: ChatHrefs;
  kind: "MERCHANT" | "NEWS";
  workspace: string;
  studio: boolean;
  video: boolean;
  support: { url: string; display: string };
  onLang?: (lang: Lang) => void;
}) {
  const t = useT();
  const c = t.chat;
  const s = c.sidebar;
  const lang = useLang();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ThreadSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [classicOpen, setClassicOpen] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const sections = useSections(kind, studio, video, true).filter((x) => x.href !== APP_HREFS.newChat);
  // Rendered after mount: "now" decides the groups, and the server's clock is not the browser's.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), [threads]);

  // Search runs on the server (titles and words), a moment after the last key.
  const q = query.trim();
  useEffect(() => {
    if (!q) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const r = await api.list({ q });
        if (stale) return;
        setResults(r.ok ? r.threads : []);
      } catch {
        if (!stale) setResults([]);
      } finally {
        if (!stale) setSearching(false);
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [q, api]);

  const flash = (text: string) => {
    setFailed(text);
    setTimeout(() => setFailed((x) => (x === text ? null : x)), 4000);
  };

  // A change is drawn at once, in the history and in the search results, and taken back if the server says no.
  const patch = (id: string, change: Partial<ThreadSummary>) => {
    const apply = (list: ThreadSummary[]) => list.map((x) => (x.id === id ? { ...x, ...change } : x));
    setThreads(apply);
    setResults((list) => list && apply(list));
  };
  const rename = async (id: string, title: string): Promise<boolean> => {
    const old = threads.find((x) => x.id === id) ?? results?.find((x) => x.id === id);
    if (!old) return false;
    patch(id, { title });
    try {
      if ((await api.rename({ id, title })).ok) return true;
    } catch {
      /* falls through */
    }
    patch(id, { title: old.title });
    flash(s.failed);
    return false;
  };
  const pin = async (id: string, pinned: boolean) => {
    patch(id, { pinned });
    try {
      if ((await api.pin({ id, pinned })).ok) return;
    } catch {
      /* falls through */
    }
    patch(id, { pinned: !pinned });
    flash(s.failed);
  };
  const remove = async (id: string): Promise<boolean> => {
    try {
      if ((await api.remove({ id })).ok) {
        setThreads((list) => list.filter((x) => x.id !== id));
        setResults((list) => list && list.filter((x) => x.id !== id));
        if (id === activeId) {
          onNewChat();
          goNew();
        }
        return true;
      }
    } catch {
      /* falls through */
    }
    flash(s.failed);
    return false;
  };

  const groups = useMemo(() => (now === null ? [] : groupThreads(threads, now)), [threads, now]);
  const label = (key: GroupKey) => s.groups[key];
  const rowProps = (thread: ThreadSummary) => ({
    thread,
    active: thread.id === activeId,
    href: hrefs.thread(thread.id),
    onRename: (title: string) => rename(thread.id, title),
    onPin: () => pin(thread.id, !thread.pinned),
    onDelete: () => remove(thread.id),
  });

  return (
    <aside id="ch-side" className={`ch-side${open ? " open" : ""}`} {...(modal ? { role: "dialog", "aria-modal": true, "aria-label": c.frame.chats } : {})}>
      <div className="ch-side-top">
        <div className="gm-side-brand ch-brand">
          <span className="gm-mark" aria-hidden="true" />
          <div>
            <p className="kufi">{t.brand}</p>
            <small>{workspace}</small>
          </div>
          <button ref={closeRef} type="button" className="ch-iconbtn ch-only-phone ch-close" aria-label={c.frame.closeList} onClick={onClose}>
            <X size={19} aria-hidden="true" />
          </button>
        </div>
        <Link href={hrefs.newChat} className="ch-new" onClick={onNewChat}>
          <SquarePen size={18} aria-hidden="true" />
          {c.newChat}
        </Link>
        <div className="ch-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder={s.searchPlaceholder}
            aria-label={s.search}
            maxLength={80}
            enterKeyHint="search"
            autoComplete="off"
          />
          {query && (
            <button type="button" className="ch-search-clear" aria-label={s.clearSearch} onClick={() => setQuery("")}>
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <nav className="ch-history" aria-label={c.frame.chats}>
        {failed && (
          <p className="ch-flash" role="alert">
            {failed}
          </p>
        )}
        {q ? (
          <>
            <p className="ch-group">{s.results}</p>
            {searching && results === null ? (
              <p className="ch-quiet" role="status">
                {t.common.wait}
              </p>
            ) : results && results.length > 0 ? (
              <ul className="ch-rows">
                {results.map((thread) => (
                  <Row key={thread.id} {...rowProps(thread)} />
                ))}
              </ul>
            ) : (
              <p className="ch-quiet">{s.noResults}</p>
            )}
          </>
        ) : load === "loading" ? (
          <div className="ch-skeleton" aria-hidden="true">
            {Array.from({ length: 7 }, (_, i) => (
              <i key={i} style={{ inlineSize: `${58 + ((i * 17) % 36)}%` }} />
            ))}
          </div>
        ) : load === "error" && threads.length === 0 ? (
          <div className="ch-quiet">
            <p>{s.loadFailed}</p>
            <button type="button" className="gm-btn quiet small" onClick={retry}>
              {s.retry}
            </button>
          </div>
        ) : groups.length === 0 && now !== null ? (
          <p className="ch-quiet">{s.empty}</p>
        ) : (
          groups.map((g) => (
            <section key={g.key} aria-label={label(g.key)}>
              <p className="ch-group">{label(g.key)}</p>
              <ul className="ch-rows">
                {g.threads.map((thread) => (
                  <Row key={thread.id} {...rowProps(thread)} />
                ))}
              </ul>
            </section>
          ))
        )}
      </nav>

      <div className="ch-side-foot">
        <button type="button" className="gm-navlink" aria-expanded={classicOpen} aria-controls="ch-classic" onClick={() => setClassicOpen((v) => !v)}>
          <LifeBuoy aria-hidden="true" strokeWidth={1.8} />
          {s.classic}
          <ChevronDown size={16} aria-hidden="true" className={`ch-chev${classicOpen ? " up" : ""}`} />
        </button>
        {classicOpen && (
          <nav id="ch-classic" className="ch-classic" aria-label={s.classic}>
            {sections.map(({ href, label: text, Icon }) => (
              // "/app" alone would open the chat again when the chat is the face the person last used: Today carries ?ui=classic (face.ts).
              <Link key={href} href={classicHref(href)} className="gm-navlink">
                <Icon aria-hidden="true" strokeWidth={1.8} />
                {text}
                <Pending />
              </Link>
            ))}
          </nav>
        )}
        <Link href="/app/settings" className="gm-navlink">
          <Settings aria-hidden="true" strokeWidth={1.8} />
          {t.layout.settings}
          <Pending />
        </Link>
        <a href={support.url} target="_blank" rel="noreferrer" className="gm-navlink">
          <MessageCircle aria-hidden="true" strokeWidth={1.8} />
          <span>
            {s.support}
            <bdi dir="ltr" className="ch-support-num">
              {support.display}
            </bdi>
          </span>
        </a>
        <div className="ch-langs" role="group" aria-label={s.language}>
          {LANGS.map((o) => (
            <button
              key={o.lang}
              type="button"
              className="gm-chip"
              aria-pressed={lang === o.lang}
              onClick={async () => {
                if (o.lang === lang) return;
                if (onLang) return onLang(o.lang);
                await setLangAction(o.lang);
                router.refresh();
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

type RowMode = "idle" | "menu" | "rename" | "delete";
/** The size the row menu is placed for (CSS: .ch-menu). */
const MENU_W = 200;
const MENU_H = 140;

function Row({
  thread,
  active,
  href,
  onRename,
  onPin,
  onDelete,
}: {
  thread: ThreadSummary;
  active: boolean;
  href: string;
  onRename: (title: string) => Promise<boolean>;
  onPin: () => Promise<void>;
  onDelete: () => Promise<boolean>;
}) {
  const s = useT().chat.sidebar;
  const [mode, setMode] = useState<RowMode>("idle");
  const [draft, setDraft] = useState(thread.title);
  const [busy, setBusy] = useState(false);
  // The menu is placed in the window, not inside the history list: the list scrolls and would cut it off near its bottom edge.
  const [menuAt, setMenuAt] = useState<{ top: number; left: number } | null>(null);
  const root = useRef<HTMLLIElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);

  // A menu closes on a tap elsewhere or Escape.
  useEffect(() => {
    if (mode !== "menu") return;
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setMode("idle");
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMode("idle");
        trigger.current?.focus();
        return;
      }
      // The arrow keys, Home and End walk through the items, as a menu is expected to (only while the focus is inside it).
      if (!root.current?.contains(document.activeElement)) return;
      const to = menuTarget(e.key, Array.from(root.current.querySelectorAll<HTMLElement>('[role="menuitem"]')), document.activeElement);
      if (to) {
        e.preventDefault();
        to.focus();
      }
    };
    const close = () => setMode("idle");
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    // The menu stays where it opened: when the list scrolls or the window changes it closes instead of drifting.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [mode]);

  const openMenu = () => {
    const el = trigger.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const rtl = getComputedStyle(el).direction === "rtl";
    const left = Math.min(Math.max(8, rtl ? r.left : r.right - MENU_W), window.innerWidth - MENU_W - 8);
    const top = r.bottom + 4 + MENU_H > window.innerHeight ? Math.max(8, r.top - 4 - MENU_H) : r.bottom + 4;
    setMenuAt({ top, left });
    setMode("menu");
  };
  useEffect(() => {
    if (mode === "rename") {
      field.current?.focus();
      field.current?.select();
    }
  }, [mode]);

  const saveName = async () => {
    const title = draft.trim().slice(0, 120);
    if (!title || title === thread.title) {
      setMode("idle");
      return;
    }
    setBusy(true);
    const ok = await onRename(title);
    setBusy(false);
    if (ok) setMode("idle");
  };

  if (mode === "rename") {
    return (
      <li ref={root} className="ch-row editing">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void saveName();
          }}
        >
          <input
            ref={field}
            className="ch-rename"
            dir={draft ? "auto" : undefined}
            value={draft}
            maxLength={120}
            aria-label={s.renameLabel}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setMode("idle");
            }}
          />
          <button type="submit" className="ch-iconbtn small" aria-label={s.save} disabled={busy}>
            <Check size={16} aria-hidden="true" />
          </button>
        </form>
      </li>
    );
  }

  if (mode === "delete") {
    return (
      <li ref={root} className="ch-row confirm" role="group" aria-label={s.deleteAsk}>
        <p>{s.deleteAsk}</p>
        <div>
          <button
            type="button"
            className="gm-btn danger small"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await onDelete();
              setBusy(false);
              if (!ok) setMode("idle");
            }}
          >
            {s.deleteYes}
          </button>
          <button type="button" className="gm-btn quiet small" disabled={busy} onClick={() => setMode("idle")}>
            {s.deleteNo}
          </button>
        </div>
      </li>
    );
  }

  return (
    <li ref={root} className={`ch-row${active ? " active" : ""}`}>
      <Link href={href} prefetch={false} className="ch-row-link" aria-current={active ? "page" : undefined} dir="auto">
        {thread.pinned && <Pin size={13} aria-hidden="true" className="ch-pinned" />}
        <span>{thread.title}</span>
      </Link>
      <button
        ref={trigger}
        type="button"
        className="ch-row-menu"
        aria-label={`${s.rowMenu}: ${thread.title}`}
        aria-haspopup="menu"
        aria-expanded={mode === "menu"}
        onClick={() => (mode === "menu" ? setMode("idle") : openMenu())}
      >
        <Ellipsis size={17} aria-hidden="true" />
      </button>
      {mode === "menu" && menuAt && (
        <div className="ch-menu" role="menu" aria-label={s.rowMenu} style={{ top: menuAt.top, left: menuAt.left }}>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setDraft(thread.title);
              setMode("rename");
            }}
          >
            <Pencil size={15} aria-hidden="true" />
            {s.rename}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMode("idle");
              void onPin();
            }}
          >
            {thread.pinned ? <PinOff size={15} aria-hidden="true" /> : <Pin size={15} aria-hidden="true" />}
            {thread.pinned ? s.unpin : s.pin}
          </button>
          <button type="button" role="menuitem" className="danger" onClick={() => setMode("delete")}>
            <Trash2 size={15} aria-hidden="true" />
            {s.delete}
          </button>
        </div>
      )}
    </li>
  );
}
