import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The menu's "Chat history": an entry in the shop's and the desk's menu, and a page that lists the person's earlier chats.

vi.mock("next/navigation", () => ({ usePathname: () => "/app/orders", useRouter: () => ({ push: () => undefined }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: unknown }) => createElement("a", { href, ...rest }, children as never),
  useLinkStatus: () => ({ pending: false }),
}));

import { ChatHistoryView } from "@/app/app/assistant/history/history-view";
import { SideNav } from "@/app/app/nav";
import { LangProvider } from "@/lib/i18n/client";
import { ar } from "@/lib/i18n/ar";
import { ckb } from "@/lib/i18n/ckb";
import { en } from "@/lib/i18n/en";
import { navFor } from "@/lib/newsroom/nav";
import type { ThreadSummary } from "@/lib/chat/types";

const NOW = Date.parse("2026-10-20T12:00:00.000Z");
const threads: ThreadSummary[] = [
  { id: "c-today", title: "Today's orders", pinned: false, lastMessageAt: "2026-10-20T09:00:00.000Z" },
  { id: "c-pin", title: "Price list", pinned: true, lastMessageAt: "2026-09-01T09:00:00.000Z" },
  { id: "c-old", title: "", pinned: false, lastMessageAt: "2026-07-01T09:00:00.000Z" },
];

const menu = (chat: boolean, lang: "en" | "ckb" | "ar" = "en") =>
  renderToStaticMarkup(createElement(LangProvider, { lang, children: createElement(SideNav, { kind: "MERCHANT", workspace: "Shop", chat }) }));

describe("the shop's menu", () => {
  it("has a Chat history entry under New chat while the chat is on", () => {
    const html = menu(true);
    expect(html).toContain('href="/app/assistant/history"');
    expect(html).toContain(en.chat.historyNav);
    expect(html.indexOf(en.chat.newChat)).toBeLessThan(html.indexOf(en.chat.historyNav));
  });

  it("does not have it while the chat is off, and speaks the person's language", () => {
    expect(menu(false)).not.toContain("/app/assistant/history");
    expect(menu(true, "ckb")).toContain(ckb.chat.historyNav);
    expect(menu(true, "ar")).toContain(ar.chat.historyNav);
  });
});

describe("the desk's menu", () => {
  it("lists the chat history right under the Assistant while the desk's chat is on, and not otherwise", () => {
    const on = navFor(true);
    expect(on[0].key).toBe("assistant");
    expect(on[1]).toMatchObject({ key: "chatHistory", href: "/newsroom/assistant/history" });
    expect(navFor(false).some((i) => (i.key as string) === "chatHistory")).toBe(false);
    for (const d of [en, ckb, ar]) expect(d.nr.shell.nav.items.chatHistory.trim()).toBeTruthy();
  });
});

describe("the history page", () => {
  const view = (list: ThreadSummary[], base: "/app" | "/newsroom" = "/app", d = en) =>
    renderToStaticMarkup(createElement(ChatHistoryView, { threads: list, base, d, now: NOW }));

  it("lists every chat as a link that opens it, pinned first, with its group", () => {
    const html = view(threads);
    expect(html).toContain('href="/app/assistant/c-today"');
    expect(html).toContain('href="/app/assistant/c-pin"');
    expect(html).toContain('href="/app/assistant/c-old"');
    expect(html).toContain(en.chat.sidebar.groups.pinned);
    expect(html).toContain(en.chat.sidebar.groups.today);
    expect(html).toContain(en.chat.sidebar.groups.older);
    expect(html.indexOf("Price list")).toBeLessThan(html.indexOf("Today&#x27;s orders"));
  });

  it("names a chat without a title like a new chat, and offers a new chat", () => {
    const html = view(threads);
    expect(html).toContain(`>${en.chat.newChat}<`);
    expect(html.split(`>${en.chat.newChat}<`).length - 1).toBeGreaterThanOrEqual(2);
  });

  it("says so when there is nothing yet", () => {
    expect(view([])).toContain(en.chat.history.empty);
    expect(view([], "/app", ckb)).toContain(ckb.chat.history.empty);
    expect(view([], "/app", ar)).toContain(ar.chat.history.empty);
  });

  it("opens a desk's chats under /newsroom", () => {
    expect(view(threads, "/newsroom")).toContain('href="/newsroom/assistant/c-today"');
    expect(view(threads, "/newsroom")).not.toContain('href="/app/assistant/');
  });
});
