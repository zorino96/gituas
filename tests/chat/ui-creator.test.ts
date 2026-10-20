import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Someone who earns from content (a creator) is not given the menu, the shortcuts and the examples of a seller.

vi.mock("next/navigation", () => ({ usePathname: () => "/app/comments", useRouter: () => ({ push: () => undefined }) }));
vi.mock("@/app/app/lang-actions", () => ({ setLangAction: async () => undefined }));
vi.mock("@/app/app/video/actions", () => ({ videoJobStatusAction: async () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: unknown }) => createElement("a", { href, ...rest }, children as never),
  useLinkStatus: () => ({ pending: false }),
}));

import { ChatScreen } from "@/app/app/assistant/chat-screen";
import { visibleQuickIds } from "@/app/app/assistant/chat-frame-model";
import { SideNav } from "@/app/app/nav";
import { OwnerTypeProvider } from "@/app/app/owner-type-context";
import { ChatCopyProvider, LangProvider } from "@/lib/i18n/client";
import { ar } from "@/lib/i18n/ar";
import { ckb } from "@/lib/i18n/ckb";
import { en } from "@/lib/i18n/en";
import { QUICK_IDS } from "@/lib/chat/types";
import type { OwnerType } from "@/lib/shop/owner-type";

const menu = (owner: OwnerType) =>
  renderToStaticMarkup(
    createElement(LangProvider, { lang: "en", children: createElement(OwnerTypeProvider, { value: owner, children: createElement(SideNav, { kind: "MERCHANT", workspace: "x", chat: true }) }) }),
  );
const screen = (owner: OwnerType, lang: "en" | "ckb" | "ar" = "en") =>
  renderToStaticMarkup(
    createElement(LangProvider, {
      lang,
      children: createElement(OwnerTypeProvider, {
        value: owner,
        children: createElement(ChatCopyProvider, {
          kind: "shop",
          children: createElement(ChatScreen, { workspaceId: "w1", thread: null, initialMessages: [], remaining: null, support: { url: "https://example.test", display: "+0" }, coachOn: true } as never),
        }),
      }),
    }),
  );

describe("the shortcuts", () => {
  it("leave out Orders for a creator, and change nothing for anyone else", () => {
    expect(visibleQuickIds(QUICK_IDS, { coachOn: true, creator: true })).toEqual(["today", "comments", "messages", "scheduled", "check", "coach"]);
    expect(visibleQuickIds(QUICK_IDS, { coachOn: true })).toBe(QUICK_IDS);
    expect(visibleQuickIds(QUICK_IDS, { coachOn: true, creator: false })).toBe(QUICK_IDS);
  });
});

describe("the menu", () => {
  it("has no Orders, Products or product autopilot for a creator", () => {
    const html = menu("creator");
    for (const gone of [en.nav.orders, en.nav.products, en.nav.autopilot]) expect(html).not.toContain(`>${gone}<`);
    expect(html).toContain(en.nav.comments);
    expect(html).toContain(en.nav.publish);
  });
  it("keeps them for a seller and for someone who has not said", () => {
    for (const owner of ["seller", "unknown"] as const) {
      const html = menu(owner);
      expect(html).toContain(en.nav.orders);
      expect(html).toContain(en.nav.products);
    }
  });
});

describe("the first screen of the chat", () => {
  it("shows a creator examples about stories and views, not orders", () => {
    const html = screen("creator");
    expect(html).toContain("Make a story video about an unsolved mystery");
    expect(html).not.toContain("How many orders came in today?");
    expect(html).not.toContain(`>${en.chat.quick.orders.label}<`);
  });
  it("keeps the seller's examples and shortcuts", () => {
    const html = screen("seller");
    expect(html).toContain("How many orders came in today?");
    expect(html).toContain(`>${en.chat.quick.orders.label}<`);
  });
  it("has the creator's examples in every language", () => {
    for (const d of [en, ckb, ar]) {
      expect(d.chat.empty.creatorExamples).toHaveLength(d.chat.empty.examples.length);
      for (const x of d.chat.empty.creatorExamples) expect(x.trim().length).toBeGreaterThan(5);
    }
    for (const lang of ["ckb", "ar"] as const) expect(screen("creator", lang)).toContain(lang === "ckb" ? ckb.chat.empty.creatorExamples[0] : ar.chat.empty.creatorExamples[0]);
  });
});
