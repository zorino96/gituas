import { describe, expect, it } from "vitest";

import { activeThreadId, chatKindOf, headerTitleAfterRefresh, isChatPathFor, safeHrefFor, TITLE_REFRESH_MS } from "@/app/app/assistant/chat-frame-model";
import type { ThreadSummary } from "@/lib/chat/types";

const shop = (id: string) => `/app/assistant/${id}`;
const desk = (id: string) => `/newsroom/assistant/${id}`;

describe("which chat the address names", () => {
  it("finds the id of a stored chat, in the shop and in the desk, with the very pattern each one's links use", () => {
    expect(activeThreadId("/app/assistant/abc123", shop)).toBe("abc123");
    expect(activeThreadId("/newsroom/assistant/abc123", desk)).toBe("abc123");
  });

  it("finds nothing on the page of a new chat, and nothing on another workspace's address", () => {
    expect(activeThreadId("/app/assistant", shop)).toBeNull();
    expect(activeThreadId("/newsroom/assistant", desk)).toBeNull();
    expect(activeThreadId("/newsroom/assistant/abc123", shop)).toBeNull();
    expect(activeThreadId("/app/assistant/abc123", desk)).toBeNull();
    expect(activeThreadId("/newsroom/assistant/", desk)).toBeNull();
  });

  it("stops the id at a slash, a query or a hash", () => {
    expect(activeThreadId("/newsroom/assistant/abc123/", desk)).toBe("abc123");
    expect(activeThreadId("/newsroom/assistant/abc123?x=1", desk)).toBe("abc123");
    expect(activeThreadId("/newsroom/assistant/abc123#top", desk)).toBe("abc123");
  });

  it("never matches when the links carry a query of their own (the dev preview points every chat at itself)", () => {
    const dev = () => "/dev/chat-first?lang=ckb&s=thread";
    expect(activeThreadId("/dev/chat-first", dev)).toBeNull();
    expect(activeThreadId("/dev/chat-first?lang=ckb&s=thread", dev)).toBeNull();
  });
});

describe("which paths are the chat's", () => {
  it("is the assistant's own address and everything below it, for the base it is asked about", () => {
    expect(isChatPathFor("/app", "/app/assistant")).toBe(true);
    expect(isChatPathFor("/app", "/app/assistant/x")).toBe(true);
    expect(isChatPathFor("/newsroom", "/newsroom/assistant")).toBe(true);
    expect(isChatPathFor("/newsroom", "/newsroom/assistant/x")).toBe(true);
  });

  it("is not a longer sibling name, another section, or the other workspace's chat", () => {
    expect(isChatPathFor("/newsroom", "/newsroom/assistants")).toBe(false);
    expect(isChatPathFor("/newsroom", "/newsroom/news")).toBe(false);
    expect(isChatPathFor("/newsroom", "/app/assistant")).toBe(false);
    expect(isChatPathFor("/app", "/newsroom/assistant")).toBe(false);
  });
});

describe("the kind of chat a frame serves", () => {
  it("maps the workspace's kind to the chat core's", () => {
    expect(chatKindOf("MERCHANT")).toBe("shop");
    expect(chatKindOf("NEWS")).toBe("news");
  });
});

describe("links drawn in a view block", () => {
  it("lets a shop link anywhere inside the app and to https addresses, as before", () => {
    expect(safeHrefFor("shop", "/app/orders")).toEqual({ href: "/app/orders", external: false });
    expect(safeHrefFor("shop", "/newsroom/news")).toEqual({ href: "/newsroom/news", external: false });
    expect(safeHrefFor("shop", "https://example.com/a")).toEqual({ href: "https://example.com/a", external: true });
  });

  it("lets a desk link only into /newsroom, or to an https address: hawalnoos.com bounces every /app path", () => {
    expect(safeHrefFor("news", "/newsroom/news/abc")).toEqual({ href: "/newsroom/news/abc", external: false });
    expect(safeHrefFor("news", "/newsroom")).toEqual({ href: "/newsroom", external: false });
    expect(safeHrefFor("news", "/newsroom?x=1")).toEqual({ href: "/newsroom?x=1", external: false });
    expect(safeHrefFor("news", "https://example.com/a")).toEqual({ href: "https://example.com/a", external: true });
    for (const bad of ["/app", "/app/orders", "/app/assistant", "/api/oauth/meta_facebook/start", "/newsroomx", "/login"]) expect(safeHrefFor("news", bad), bad).toBeNull();
  });

  it("draws no link for an address that is not one: a scheme, a protocol-relative address, nothing", () => {
    for (const kind of ["shop", "news"] as const) {
      for (const bad of ["javascript:alert(1)", "//evil.example/x", "\\\\evil", "http://example.com", "", undefined]) expect(safeHrefFor(kind, bad), String(bad)).toBeNull();
    }
  });
});

describe("the better title of a new chat", () => {
  const list = (title: string): ThreadSummary[] => [
    { id: "t1", title, pinned: false, lastMessageAt: "2026-10-19T10:00:00.000Z" },
    { id: "t2", title: "Other", pinned: false, lastMessageAt: "2026-10-19T09:00:00.000Z" },
  ];

  it("is read again about four seconds after the first answer", () => {
    expect(TITLE_REFRESH_MS).toBe(4000);
  });

  it("replaces the header's title when the open chat has a new one in the list", () => {
    expect(headerTitleAfterRefresh("What new stor", list("New stories today"), "t1", "t1")).toBe("New stories today");
  });

  it("leaves the header alone while it does not know its title yet, or when another chat is open by now", () => {
    expect(headerTitleAfterRefresh(null, list("New stories today"), "t1", "t1")).toBeNull();
    expect(headerTitleAfterRefresh("Other chat title", list("New stories today"), "t1", "t2")).toBe("Other chat title");
    expect(headerTitleAfterRefresh("Other chat title", list("New stories today"), "t1", null)).toBe("Other chat title");
  });

  it("keeps the header's title when the chat is not in the list, or the list has no title for it", () => {
    expect(headerTitleAfterRefresh("Mine", [], "t1", "t1")).toBe("Mine");
    expect(headerTitleAfterRefresh("Mine", list(""), "t1", "t1")).toBe("Mine");
  });
});
