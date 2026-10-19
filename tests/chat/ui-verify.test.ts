import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// What reading a change back shows on its card: the matching lines, or what is not as asked with a button that asks the chat to fix it.

vi.mock("next/navigation", () => ({ usePathname: () => "/app/assistant", useRouter: () => ({ push: () => undefined }) }));
vi.mock("@/app/app/lang-actions", () => ({ setLangAction: async () => undefined }));
vi.mock("@/app/app/video/actions", () => ({ videoJobStatusAction: async () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: unknown }) => createElement("a", { href, ...rest }, children as never),
  useLinkStatus: () => ({ pending: false }),
}));

import { ChatScreen } from "@/app/app/assistant/chat-screen";
import { ChatCopyProvider, LangProvider } from "@/lib/i18n/client";
import { ar } from "@/lib/i18n/ar";
import { ckb } from "@/lib/i18n/ckb";
import { en } from "@/lib/i18n/en";
import type { MessageDto, RunDto, VerifyReport } from "@/lib/chat/types";

const support = { url: "https://example.test", display: "+0" };

const run = (verify?: VerifyReport): RunDto => ({
  id: "r1",
  tool: "update_product",
  risk: "public",
  title: "Change a product",
  lines: [{ label: "Price", value: "25000" }],
  status: "DONE",
  decidedBy: "CONFIRMED",
  tainted: false,
  expiresAt: "2026-10-20T10:00:00.000Z",
  resultText: "The product was updated.",
  long: false,
  ...(verify ? { verify } : {}),
});
const message = (id: string, seq: number, role: "user" | "assistant", text: string, runs: RunDto[] = []): MessageDto => ({
  id,
  seq,
  role,
  text,
  blocks: [],
  runs,
  followups: [],
  attachments: [],
  createdAt: "2026-10-20T09:00:00.000Z",
});

const BAD: VerifyReport = { status: "problem", checked: [], problems: ["The price is 20,000 IQD, not the 25,000 you asked for."], fix: "Call update_product with price=25000." };
const GOOD: VerifyReport = { status: "ok", checked: ["The price of the shoes is 25,000 IQD"], problems: [] };

const render = (messages: MessageDto[], lang: "en" | "ckb" | "ar" = "en") =>
  renderToStaticMarkup(
    createElement(LangProvider, {
      lang,
      children: createElement(ChatCopyProvider, {
        kind: "shop",
        children: createElement(ChatScreen, { workspaceId: "w1", thread: { id: "t1", title: "x", kind: "shop", updatedAt: "2026-10-20T09:00:00.000Z" }, initialMessages: messages, remaining: null, support } as never),
      }),
    }),
  );

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("the read-back on a card", () => {
  it("shows what was checked, without a button", () => {
    const html = render([message("m1", 1, "user", "set the price"), message("m2", 2, "assistant", "", [run(GOOD)]), message("m3", 3, "assistant", "Done.")]);
    expect(html).toContain(en.chat.runs.verified);
    expect(html).toContain("The price of the shoes is 25,000 IQD");
    expect(html).not.toContain(en.chat.runs.fixIt);
  });

  it("shows what is not as asked and offers 'Fix it' on the card even though the closing message of the turn comes after it", () => {
    const html = render([message("m1", 1, "user", "set the price"), message("m2", 2, "assistant", "", [run(BAD)]), message("m3", 3, "assistant", "The price did not save.")]);
    expect(html).toContain(en.chat.runs.problem);
    expect(html).toContain("not the 25,000 you asked for");
    expect(count(html, `>${en.chat.runs.fixIt}<`)).toBe(1);
    expect(html).toContain('role="alert"');
  });

  it("offers 'Fix it' only on the newest card that has a problem to fix", () => {
    const older = { ...run(BAD), id: "r0" };
    const html = render([
      message("m1", 1, "user", "a"),
      message("m2", 2, "assistant", "", [older]),
      message("m3", 3, "assistant", "x"),
      message("m4", 4, "user", "b"),
      message("m5", 5, "assistant", "", [run(BAD)]),
      message("m6", 6, "assistant", "y"),
    ]);
    expect(count(html, `>${en.chat.runs.fixIt}<`)).toBe(1);
    expect(count(html, en.chat.runs.problem)).toBe(2);
  });

  it("has nothing extra for a change that was not read back", () => {
    const html = render([message("m1", 1, "user", "a"), message("m2", 2, "assistant", "", [run()]), message("m3", 3, "assistant", "ok")]);
    expect(html).not.toContain(en.chat.runs.verified);
    expect(html).not.toContain(en.chat.runs.problem);
  });

  it("speaks the person's language", () => {
    for (const [lang, d] of [["ckb", ckb], ["ar", ar]] as const) {
      const html = render([message("m1", 1, "user", "a"), message("m2", 2, "assistant", "", [run(BAD)]), message("m3", 3, "assistant", "x")], lang);
      expect(html).toContain(d.chat.runs.problem);
      expect(html).toContain(d.chat.runs.fixIt);
    }
  });

  it("the Fix it request names the card in the person's language", () => {
    expect(en.chat.runs.fixPrompt("Change a product")).toContain("Change a product");
    expect(ckb.chat.runs.fixPrompt("X")).toMatch(/[؀-ۿ]/);
    expect(ar.chat.runs.fixPrompt("X")).toMatch(/[؀-ۿ]/);
  });
});
