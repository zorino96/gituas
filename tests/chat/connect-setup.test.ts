import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A shop with no store yet that connects Facebook or Instagram from the chat should land on the setup interview, like the Connect buttons in
// Settings do. The page decides ("setupFirst") and the card builds the link.

const db = vi.hoisted(() => ({ store: { count: vi.fn() } }));
const data = vi.hoisted(() => ({ loadConnections: vi.fn(), requireWorkspace: vi.fn() }));
const chatActions = vi.hoisted(() => ({ getChatStateAction: vi.fn(), getThreadAction: vi.fn() }));
const chatOn = vi.hoisted(() => ({ chatEnabled: vi.fn() }));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/app/app/data", () => data);
vi.mock("@/lib/chat/enabled", () => chatOn);
vi.mock("@/app/app/assistant/chat-actions", () => chatActions);
vi.mock("@/app/app/assistant/chat-screen", () => ({ ChatScreen: () => null }));
vi.mock("@/app/app/assistant/assistant-client", () => ({ AssistantClient: () => null }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));
vi.mock("@/lib/i18n", async () => {
  const [{ ckb }, { ar }, { en }] = await Promise.all([import("@/lib/i18n/ckb"), import("@/lib/i18n/ar"), import("@/lib/i18n/en")]);
  return { dict: (l: string) => (l === "ar" ? ar : l === "en" ? en : ckb), getLang: async () => "en" };
});

import { ConnectCard } from "@/app/app/assistant/chat-connect";
import AssistantPage from "@/app/app/assistant/page";
import { ChatScreen } from "@/app/app/assistant/chat-screen";
import { AssistantClient } from "@/app/app/assistant/assistant-client";

const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));

describe("the Connect buttons in the chat", () => {
  it("go back to the chat after connecting, by default", () => {
    const html = renderToStaticMarkup(createElement(ConnectCard, { connections: { facebook: false, instagram: false }, justConnected: false }));
    expect(hrefs(html)).toEqual(["/api/oauth/meta_facebook/start?next=/app/assistant&ack=1", "/api/oauth/meta_instagram/start?next=/app/assistant&ack=1"]);
  });

  it("go on to the setup interview for the first connection of a shop with no store yet", () => {
    const html = renderToStaticMarkup(createElement(ConnectCard, { connections: { facebook: false, instagram: false, setupFirst: true }, justConnected: false }));
    expect(hrefs(html)).toEqual(["/api/oauth/meta_facebook/start?next=/app/setup&ack=1", "/api/oauth/meta_instagram/start?next=/app/setup&ack=1"]);
  });

  it("show only the account that is still missing, with the same landing place", () => {
    const html = renderToStaticMarkup(createElement(ConnectCard, { connections: { facebook: true, instagram: false, setupFirst: true }, justConnected: false }));
    expect(hrefs(html)).toEqual(["/api/oauth/meta_instagram/start?next=/app/setup&ack=1"]);
  });

  it("show nothing but the 'connected' note when both accounts are connected", () => {
    const html = renderToStaticMarkup(createElement(ConnectCard, { connections: { facebook: true, instagram: true, setupFirst: true }, justConnected: true }));
    expect(hrefs(html)).toEqual([]);
    expect(html).toContain("ch-ok");
  });
});

describe("the assistant page decides where the first connection goes", () => {
  const page = async () => AssistantPage({ searchParams: Promise.resolve({}) }) as Promise<{ type: unknown; props: { connections: Record<string, boolean> } }>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BUSINESS_PROFILE_ENABLED = "1";
    chatOn.chatEnabled.mockReturnValue(true);
    data.requireWorkspace.mockResolvedValue({ id: "t1", kind: "MERCHANT", role: "OWNER" });
    data.loadConnections.mockResolvedValue({ META_FACEBOOK: { connected: false }, META_INSTAGRAM: { connected: false } });
    chatActions.getChatStateAction.mockResolvedValue({ ok: true, remaining: { day: 3, month: 30 } });
    db.store.count.mockResolvedValue(0);
  });
  afterEach(() => {
    delete process.env.BUSINESS_PROFILE_ENABLED;
  });

  it("sends the first connection of a shop with no store to the setup interview", async () => {
    const el = await page();
    expect(el.type).toBe(ChatScreen);
    expect(el.props.connections).toEqual({ facebook: false, instagram: false, setupFirst: true });
    expect(db.store.count).toHaveBeenCalledWith({ where: { tenantId: "t1" } });
  });

  it("keeps the old landing place once the workspace has a store", async () => {
    db.store.count.mockResolvedValue(1);
    expect((await page()).props.connections.setupFirst).toBe(false);
  });

  it("keeps the old landing place, and counts nothing, while the interview is switched off", async () => {
    delete process.env.BUSINESS_PROFILE_ENABLED;
    expect((await page()).props.connections.setupFirst).toBe(false);
    expect(db.store.count).not.toHaveBeenCalled();
  });

  it("keeps the old landing place when the stores cannot be counted", async () => {
    db.store.count.mockRejectedValue(new Error("db down"));
    expect((await page()).props.connections.setupFirst).toBe(false);
  });

  it("gives the older assistant screen the same answer when the chat is switched off", async () => {
    chatOn.chatEnabled.mockReturnValue(false);
    const el = (await page()) as unknown as { type: unknown; props: { children: { type: unknown; props: { connections: Record<string, boolean> } }[] } };
    const client = el.props.children.find((c) => c.type === AssistantClient);
    expect(client?.props.connections.setupFirst).toBe(true);
  });
});
