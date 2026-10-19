import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The "Weekly note" shortcut belongs to the growth coach: it is drawn only while the server page says the weekly note is switched on.

vi.mock("next/navigation", () => ({ usePathname: () => "/app/assistant", useRouter: () => ({ push: () => undefined }) }));
vi.mock("@/app/app/lang-actions", () => ({ setLangAction: async () => undefined }));
vi.mock("@/app/app/video/actions", () => ({ videoJobStatusAction: async () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: unknown }) => createElement("a", { href, ...rest }, children as never),
  useLinkStatus: () => ({ pending: false }),
}));

import { ChatScreen } from "@/app/app/assistant/chat-screen";
import { ChatFrame, type ChatApi } from "@/app/app/assistant/chat-shell";
import { listForWorkspace, visibleQuickIds, workspaceMismatch } from "@/app/app/assistant/chat-frame-model";
import { ChatCopyProvider, LangProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/en";
import { ckb } from "@/lib/i18n/ckb";
import { ar } from "@/lib/i18n/ar";
import { NEWS_QUICK_IDS, QUICK_IDS } from "@/lib/chat/types";

const support = { url: "https://example.test", display: "+0" };
const render = (props: Record<string, unknown>, lang: "en" | "ckb" | "ar" = "en", kind: "shop" | "news" = "shop") =>
  renderToStaticMarkup(
    createElement(LangProvider, {
      lang,
      children: createElement(ChatCopyProvider, {
        kind,
        children: createElement(ChatScreen, { workspaceId: "w1", thread: null, initialMessages: [], remaining: null, support, ...props } as never),
      }),
    }),
  );

describe("visibleQuickIds", () => {
  it("drops the weekly note's button while the weekly note is off, and keeps the others in order", () => {
    expect(visibleQuickIds(QUICK_IDS, { coachOn: false })).toEqual(["today", "orders", "comments", "messages", "scheduled"]);
    expect(visibleQuickIds(QUICK_IDS, { coachOn: true })).toEqual([...QUICK_IDS]);
  });

  it("changes nothing for a list that has no such button (the desk's)", () => {
    expect(visibleQuickIds(NEWS_QUICK_IDS, { coachOn: false })).toBe(NEWS_QUICK_IDS);
    expect(visibleQuickIds(NEWS_QUICK_IDS, { coachOn: true })).toBe(NEWS_QUICK_IDS);
    expect(visibleQuickIds([], { coachOn: false })).toEqual([]);
  });

  it("applies to a list the page passes too", () => {
    expect(visibleQuickIds(["today", "coach"], { coachOn: false })).toEqual(["today"]);
  });
});

describe("the shortcut buttons of the shop's chat", () => {
  it("do not show 'Weekly note' unless the page says the weekly note is on", () => {
    expect(render({})).not.toContain(en.chat.quick.coach.label);
    expect(render({ coachOn: false })).not.toContain(en.chat.quick.coach.label);
    expect(render({})).toContain(en.chat.quick.orders.label);
    expect(render({ coachOn: true })).toContain(en.chat.quick.coach.label);
  });

  it("do so in every language", () => {
    expect(render({}, "ckb")).not.toContain(ckb.chat.quick.coach.label);
    expect(render({}, "ar")).not.toContain(ar.chat.quick.coach.label);
    expect(render({ coachOn: true }, "ckb")).toContain(ckb.chat.quick.coach.label);
    expect(render({ coachOn: true }, "ar")).toContain(ar.chat.quick.coach.label);
  });

  it("leave the desk's six as they are", () => {
    // (the shell's kind decides when the screen is inside a frame; here the list is given, as the dev preview does)
    const html = render({ quickIds: NEWS_QUICK_IDS }, "en", "news");
    expect(html).toContain("New stories");
    expect(html).not.toContain(en.chat.quick.coach.label);
  });
});

describe("a screen made for another workspace than its frame", () => {
  it("is told apart only when the frame knows its workspace", () => {
    expect(workspaceMismatch("A", "B")).toBe(true);
    expect(workspaceMismatch("A", "A")).toBe(false);
    expect(workspaceMismatch(null, "B")).toBe(false);
  });
});

describe("the frame's history read", () => {
  it("names the workspace the frame was opened for, with the search words, and hands the answer on", async () => {
    const seen: unknown[] = [];
    const list = async (input?: { q?: string; workspaceId?: string }) => {
      seen.push(input);
      return { ok: true as const, threads: [] };
    };
    const stale = vi.fn();
    const bound = listForWorkspace(list, "A", stale);
    expect(await bound()).toEqual({ ok: true, threads: [] });
    await bound({ q: "orders" });
    expect(seen).toEqual([{ workspaceId: "A" }, { q: "orders", workspaceId: "A" }]);
    expect(stale).not.toHaveBeenCalled();
  });

  it("tells the frame when the server says the session is in another workspace, and for no other reason", async () => {
    const stale = vi.fn();
    const answers: { ok: false; code: string }[] = [{ ok: false, code: "workspace" }, { ok: false, code: "internal" }, { ok: false, code: "signin" }];
    for (const a of answers) await listForWorkspace(async () => a, "A", stale)();
    expect(stale).toHaveBeenCalledTimes(1);
  });
});

describe("a screen drawn inside a frame of another workspace", () => {
  const api: ChatApi = { list: async () => ({ ok: true, threads: [] }), rename: async () => ({ ok: true }), pin: async () => ({ ok: true }), remove: async () => ({ ok: true }) };
  const inFrame = (frameWorkspaceId: string, pageWorkspaceId: string, lang: "en" | "ckb" | "ar" = "en") =>
    renderToStaticMarkup(
      createElement(LangProvider, {
        lang,
        children: createElement(ChatCopyProvider, {
          kind: "shop",
          children: createElement(ChatFrame, {
            api,
            kind: "MERCHANT",
            workspace: "Shop A",
            workspaceId: frameWorkspaceId,
            studio: false,
            video: false,
            support,
            children: createElement(ChatScreen, { workspaceId: pageWorkspaceId, thread: null, initialMessages: [], remaining: null, support } as never),
          } as never),
        }),
      }),
    );

  it("offers the reload and no box to type in, when the page and the frame disagree", () => {
    const html = inFrame("A", "B");
    expect(html).toContain(en.chat.errors.workspace);
    expect(html).toContain(en.chat.screen.reload);
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("ch-quick");
    // the example questions cannot be sent either
    expect(html).toMatch(/class="ch-example" disabled/);
  });

  it("says it in each language", () => {
    expect(inFrame("A", "B", "ckb")).toContain(ckb.chat.screen.reload);
    expect(inFrame("A", "B", "ar")).toContain(ar.chat.screen.reload);
  });

  it("looks as it always did when they agree", () => {
    const html = inFrame("A", "A");
    expect(html).toContain("<textarea");
    expect(html).not.toContain(en.chat.screen.reload);
  });
});

describe("the places that read the chat from the server name the workspace the screen was opened for", () => {
  const read = (file: string): string => readFileSync(path.resolve(__dirname, "../..", file), "utf8");

  it("the screen's catch-up read (getThreadAction) and the frame's history read (listThreadsAction)", () => {
    expect(read("src/app/app/assistant/chat-screen.tsx")).toContain("getThread({ id, workspaceId })");
    expect(read("src/app/app/assistant/chat-shell.tsx")).toContain("listForWorkspace(api.list, workspaceId");
  });

  it("and both server actions answer 'workspace' for another one", () => {
    const actions = read("src/app/app/assistant/chat-actions.ts");
    expect(actions).toMatch(/listThreadsAction[^]*workspaceId[^]*code: "workspace"/);
    expect(actions).toMatch(/getThreadAction[^]*workspaceId[^]*code: "workspace"/);
  });
});
