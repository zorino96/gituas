import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DESK_BASE, DESK_HREFS, DESK_SETTINGS_HREF, deskSectionItems, deskThreadHref, isDeskChatPath } from "@/app/newsroom/desk-chat";
import { baseOf } from "@/lib/chat/kinds";
import { ar } from "@/lib/i18n/ar";
import { ChatCopyProvider, LangProvider, useT } from "@/lib/i18n/client";
import { ckb } from "@/lib/i18n/ckb";
import { en } from "@/lib/i18n/en";
import type { Lang } from "@/lib/i18n/lang";
import { activeItem, NAV, navFor, type NavKey } from "@/lib/newsroom/nav";

const root = path.resolve(__dirname, "../..");
const read = (file: string): string => readFileSync(path.join(root, file), "utf8");

describe("where the desk's chat lives", () => {
  it("is under /newsroom, the base the chat core gives a news desk", () => {
    expect(DESK_BASE).toBe(baseOf("news"));
    expect(DESK_BASE).toBe("/newsroom");
    expect(DESK_HREFS.newChat).toBe("/newsroom/assistant");
    expect(DESK_HREFS.thread("abc")).toBe("/newsroom/assistant/abc");
    expect(deskThreadHref("abc")).toBe("/newsroom/assistant/abc");
    expect(DESK_SETTINGS_HREF).toBe("/newsroom/settings");
  });

  it("points nowhere into /app", () => {
    for (const href of [DESK_HREFS.newChat, DESK_HREFS.thread("x"), deskThreadHref("x"), DESK_SETTINGS_HREF, ...deskSectionItems().map((i) => i.href)]) {
      expect(href.startsWith("/newsroom/"), href).toBe(true);
      expect(/^\/app(\/|$)/.test(href), href).toBe(false);
    }
  });

  it("knows its own screens from the shop's and from the other desk screens", () => {
    expect(isDeskChatPath("/newsroom/assistant")).toBe(true);
    expect(isDeskChatPath("/newsroom/assistant/abc")).toBe(true);
    expect(isDeskChatPath("/newsroom/news")).toBe(false);
    expect(isDeskChatPath("/newsroom/assistants")).toBe(false);
    expect(isDeskChatPath("/app/assistant")).toBe(false);
  });

  it("belongs to the 'assistant' section of the desk's navigation, for the '?' guide link and the active state", () => {
    expect(activeItem("/newsroom/assistant")?.key).toBe("assistant");
    expect(activeItem("/newsroom/assistant/abc")?.key).toBe("assistant");
  });
});

describe("the sections the chat's sidebar lists", () => {
  it("are the desk's own, without the chat itself and without Settings (which has its own link)", () => {
    const keys = deskSectionItems().map((i) => i.key);
    expect(keys).not.toContain("assistant");
    expect(keys).not.toContain("settings");
    for (const key of ["news", "publish", "videos", "comments", "messages", "insights", "sources", "autopilot", "videoSetup", "brand", "team", "guide"] as NavKey[]) expect(keys, key).toContain(key);
  });

  it("have a name in every language", () => {
    for (const [lang, d] of [["ckb", ckb], ["ar", ar], ["en", en]] as const) {
      for (const i of deskSectionItems()) expect(d.nr.shell.nav.items[i.key]?.trim(), `${lang}.${i.key}`).toBeTruthy();
      expect(d.nr.shell.nav.items.settings.trim(), `${lang}.settings`).toBeTruthy();
    }
  });
});

describe("the desk's navigation while its chat is on", () => {
  it("keeps the Assistant where it was while the chat is off, and the list as it is", () => {
    expect(navFor(false)).toBe(NAV);
    expect(NAV.find((i) => i.key === "assistant")?.group).toBe("account");
  });

  it("leads the first group with the Assistant while the chat is on, and loses no section", () => {
    const items = navFor(true);
    expect(items[0].key).toBe("assistant");
    expect(items[0].group).toBe("desk");
    expect(items[0].href).toBe("/newsroom/assistant");
    expect(items.map((i) => i.key).sort()).toEqual(NAV.map((i) => i.key).sort());
    expect(items.filter((i) => i.group === "account").map((i) => i.key)).not.toContain("assistant");
  });

  it("leaves the four tabs of the phone bar as they are", () => {
    expect(navFor(true).filter((i) => i.mobile)).toHaveLength(4);
    expect(navFor(true).filter((i) => i.mobile).map((i) => i.key)).toEqual(NAV.filter((i) => i.mobile).map((i) => i.key));
  });
});

describe("the desk's chat words reach the chat components through the provider", () => {
  function Probe() {
    const c = useT().chat;
    return createElement("p", null, `${c.sidebar.classic}|${c.screen.assistant}|${Object.keys(c.quick).join(",")}|${c.empty.hello}`);
  }
  const html = (lang: Lang, kind: "shop" | "news") =>
    renderToStaticMarkup(createElement(LangProvider, { lang, children: createElement(ChatCopyProvider, { kind, children: createElement(Probe) }) }));

  it("gives a desk its own sidebar title, name and shortcuts", () => {
    expect(html("en", "news")).toContain("Hawalnoos sections|Hawalnoos|");
    expect(html("en", "news")).toContain("stories");
    expect(html("ckb", "news")).toContain(ckb.nr.shell.nav.sideLabel);
    expect(html("ar", "news")).toContain("أقسام Hawalnoos");
  });

  it("gives a shop the dictionary's own text, untouched", () => {
    expect(html("en", "shop")).toBe(`<p>${en.chat.sidebar.classic}|${en.chat.screen.assistant}|${Object.keys(en.chat.quick).join(",")}|${en.chat.empty.hello}</p>`);
  });

  it("changes only the chat's words: the rest of the dictionary stays the same object", () => {
    function Same() {
      const t = useT();
      return createElement("p", null, `${t.nav.today}|${t.brand}`);
    }
    const out = renderToStaticMarkup(createElement(LangProvider, { lang: "en", children: createElement(ChatCopyProvider, { kind: "news", children: createElement(Same) }) }));
    expect(out).toBe(`<p>${en.nav.today}|${en.brand}</p>`);
  });
});

describe("no link, redirect or OAuth return of the desk's chat points at /app", () => {
  // A string literal that starts with /app (an import such as "@/app/..." does not). The older assistant page keeps its redirect for a shop
  // workspace that opens it; it is not part of the desk's chat.
  const APP_LITERAL = /(["'`])\/app(?:\/|\?|#|\1)/;
  const files = [
    "src/app/newsroom/desk-chat.ts",
    "src/app/newsroom/desk-frame.tsx",
    "src/app/newsroom/desk-shell.tsx",
    "src/app/newsroom/desk-nav.tsx",
    "src/app/newsroom/desk-access.ts",
    "src/app/newsroom/(desk)/assistant/[id]/page.tsx",
    "src/lib/i18n/chat-news.ts",
    "src/lib/i18n/chat-news.ckb.ts",
    "src/lib/i18n/chat-news.ar.ts",
    "src/lib/i18n/chat-news.en.ts",
  ];
  for (const file of files) {
    it(file, () => {
      expect(read(file)).not.toMatch(APP_LITERAL);
    });
  }

  it("holds for the new-chat page too, except the older page's redirect for a shop workspace", () => {
    const lines = read("src/app/newsroom/(desk)/assistant/page.tsx").split("\n").filter((l) => APP_LITERAL.test(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('redirect("/app/assistant")');
  });

  it("passes the screen nothing a server component cannot hand to a client one (a function that is not a server action)", () => {
    // The chat frame already knows the desk's addresses; a urlFor function from the page would fail when the page is rendered.
    for (const file of ["src/app/newsroom/(desk)/assistant/page.tsx", "src/app/newsroom/(desk)/assistant/[id]/page.tsx"]) expect(read(file), file).not.toMatch(/\burlFor=/);
  });

  it("holds for the desk's fixtures, links of every view block included", () => {
    expect(read("src/app/dev/chat-first/fixtures-news.ts")).not.toMatch(APP_LITERAL);
  });
});
