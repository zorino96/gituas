import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The owner does not know the word "شاپ" (a Page and an Instagram account kept together), and the model writes **bold** names: the
// first is changed for good in what the person reads and in what the model reads back; the second is shown as bold, not as asterisks.

vi.mock("next/navigation", () => ({ usePathname: () => "/app/assistant", useRouter: () => ({ push: () => undefined }) }));
vi.mock("@/app/app/lang-actions", () => ({ setLangAction: async () => undefined }));
vi.mock("@/app/app/video/actions", () => ({ videoJobStatusAction: async () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: unknown }) => createElement("a", { href, ...rest }, children as never),
  useLinkStatus: () => ({ pending: false }),
}));

import { ChatScreen } from "@/app/app/assistant/chat-screen";
import { cleanAnswer, ownerWords } from "@/lib/chat/guard";
import { buildHistory } from "@/lib/chat/history";
import { ChatCopyProvider, LangProvider } from "@/lib/i18n/client";
import type { MessageDto } from "@/lib/chat/types";

describe("ownerWords", () => {
  it("says group where the model says شاپ, in every form of the word", () => {
    expect(ownerWords("لە شاپی NSFW دایە")).toBe("لە گروپی NSFW دایە");
    expect(ownerWords("ئەو شاپە، شاپێکی تر، شاپەکەت")).toBe("ئەو گروپە، گروپێکی تر، گروپەکەت");
    expect(ownerWords("شۆپ")).toBe("گروپ");
  });
  it("leaves other words, Latin text and numbers alone", () => {
    expect(ownerWords("دووکانەکەم و پەیجی The Secret File ٢٥٠٠")).toBe("دووکانەکەم و پەیجی The Secret File ٢٥٠٠");
    expect(ownerWords("Your shop is on")).toBe("Your shop is on");
  });
  it("is part of cleaning every answer", () => {
    expect(cleanAnswer("  شاپی @hawalnoos  ")).toBe("گروپی @hawalnoos");
  });
});

describe("what the model reads back of its own earlier answers", () => {
  it("does not hold the word the owner does not know", () => {
    const row = (seq: number, role: string, content: string) => ({ id: `m${seq}`, seq, role, content, toolCalls: null, toolCallId: null, meta: null, tainted: false, createdAt: new Date() });
    const history = buildHistory(
      [row(1, "user", "کۆنێکتی بکە"), row(2, "assistant", "شاپی NSFW پەیجی هەیە")] as never,
      new Map(),
    );
    const assistant = history.find((m) => m.role === "assistant");
    expect(assistant?.content).toContain("گروپی NSFW");
    expect(assistant?.content).not.toContain("شاپ");
  });
});

describe("bold in an answer", () => {
  const message = (text: string): MessageDto => ({ id: "m2", seq: 2, role: "assistant", text, blocks: [], runs: [], followups: [], attachments: [], createdAt: "2026-10-20T09:00:00.000Z" });
  const render = (text: string) =>
    renderToStaticMarkup(
      createElement(LangProvider, {
        lang: "en",
        children: createElement(ChatCopyProvider, {
          kind: "shop",
          children: createElement(ChatScreen, {
            workspaceId: "w1",
            thread: { id: "t1", title: "x", pinned: false, lastMessageAt: "2026-10-20T09:00:00.000Z" },
            initialMessages: [{ ...message("hi"), id: "m1", seq: 1, role: "user" }, message(text)],
            remaining: null,
            support: { url: "https://example.test", display: "+0" },
          } as never),
        }),
      }),
    );

  it("is shown as bold, without the asterisks", () => {
    const html = render("It is in **NSFW** and **The Secret File**.");
    expect(html).toContain("<strong>NSFW</strong>");
    expect(html).toContain("<strong>The Secret File</strong>");
    expect(html).not.toContain("**");
  });
  it("leaves a lone asterisk and ordinary text alone", () => {
    const html = render("5 * 3 and ** open");
    expect(html).toContain("5 * 3 and ** open");
    expect(html).not.toContain("<strong>");
  });
});
