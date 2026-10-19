import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The chat's Accounts: the card (several accounts connected, none, a news desk, a role that may only look), the header button that opens
// it, the card drawn inline when the chat shows it, and the words in the person's three languages.

vi.mock("next/navigation", () => ({ usePathname: () => "/app/assistant", useRouter: () => ({ push: () => undefined }) }));
vi.mock("@/app/app/lang-actions", () => ({ setLangAction: async () => undefined }));
vi.mock("@/app/app/video/actions", () => ({ videoJobStatusAction: async () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: unknown }) => createElement("a", { href, ...rest }, children as never),
  useLinkStatus: () => ({ pending: false }),
}));

import type { ChatAccountsState } from "@/app/app/assistant/account-actions";
import type { AccountPlatform, ChatAccountsResult } from "@/app/app/assistant/account-actions";
import {
  AccountsView,
  broadcastPick,
  CHOOSABLE,
  canChoose,
  chatPathOf,
  chooseReducer,
  connectHref,
  FRESH_VIEW,
  onPick,
  runChoose,
  withSelected,
  type AccountsApi,
  type ChooseFlow,
  type ChooseView,
} from "@/app/app/assistant/chat-accounts";
import { ChatScreen } from "@/app/app/assistant/chat-screen";
import { ChatFrame, type ChatApi } from "@/app/app/assistant/chat-shell";
import { ChatCopyProvider, LangProvider } from "@/lib/i18n/client";
import { ar } from "@/lib/i18n/ar";
import { ckb } from "@/lib/i18n/ckb";
import { en } from "@/lib/i18n/en";
import type { MessageDto } from "@/lib/chat/types";

type L = "en" | "ckb" | "ar";
const DICT = { en, ckb, ar } as const;
const read = (file: string): string => readFileSync(path.resolve(__dirname, "../..", file), "utf8");
// The Arabic script block, and the letters only Sorani uses (the six of ە ڕ ڵ ۆ ێ ڤ plus Persian ک and ی), built from code points.
const ARABIC_SCRIPT = new RegExp(`[${String.fromCodePoint(0x600)}-${String.fromCodePoint(0x6ff)}]`);
const KURDISH_ONLY = new RegExp(`[${[0x6d5, 0x695, 0x6b5, 0x6c6, 0x6ce, 0x6a4, 0x6a9, 0x6cc].map((c) => String.fromCodePoint(c)).join("")}]`);

const state = (over: Partial<ChatAccountsState> = {}): ChatAccountsState => ({
  ok: true,
  kind: "shop",
  canConfigure: true,
  lists: {
    FB: [
      { id: "fb1", name: "Sunrise Bakery", avatarUrl: "https://img.test/1.png" },
      { id: "fb2", name: "Sunrise Cafe", avatarUrl: null },
    ],
    IG: [
      { id: "ig1", name: "@sunrise.bakery", avatarUrl: null },
      { id: "ig2", name: "@sunrise.cafe", avatarUrl: null },
    ],
    TT: [],
    YT: [{ id: "yt1", name: "Sunrise TV", avatarUrl: null }],
  },
  selected: { FB: "fb1", IG: "ig2", TT: null, YT: "yt1" },
  ...over,
});
const NONE = { FB: [], IG: [], TT: [], YT: [] };
const NOTHING = { FB: null, IG: null, TT: null, YT: null };

const view = (s: ChatAccountsState, lang: L = "en", props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(LangProvider, { lang, children: createElement(AccountsView, { state: s, onChoose: () => undefined, ...props }) }));

// The radio input of an account (React writes its attributes in its own order), and a text as it appears in markup (an apostrophe is escaped).
const radio = (html: string, id: string): string => html.match(new RegExp(`<input[^>]*value="${id}"[^>]*>`))?.[0] ?? "";
const esc = (text: string): string => text.replace(/'/g, "&#x27;");
const count = (html: string, needle: string | RegExp) => (typeof needle === "string" ? html.split(needle).length - 1 : (html.match(needle) ?? []).length);

describe("the Accounts card with several accounts connected", () => {
  const html = view(state());
  const t = en.chat.accounts;

  it("names each platform for what it is, and never says shop", () => {
    for (const p of ["FB", "IG", "TT", "YT"] as const) expect(html).toContain(t.kind[p]);
    expect(html).not.toMatch(/\bshop\b|\bstore\b/i);
  });

  it("offers one radio group where there is a choice, marking the account the chat works with", () => {
    expect(count(html, 'role="radiogroup"')).toBe(2);
    expect(radio(html, "fb1")).toContain("checked");
    expect(radio(html, "fb2")).not.toContain("checked");
    expect(radio(html, "ig2")).toContain("checked");
    expect(radio(html, "ig1")).not.toContain("checked");
    // Facebook and Instagram are choices; the one YouTube channel is shown with nothing to choose and nothing that says the chat uses it
    expect(count(html, 'type="radio"')).toBe(4);
    expect(count(html, `>${t.inUse}<`)).toBe(2);
  });

  it("names the accounts, with a picture when the platform gave one and an initial when not", () => {
    expect(html).toContain("Sunrise Bakery");
    expect(html).toContain("@sunrise.cafe");
    expect(html).toContain('src="https://img.test/1.png"');
    expect(html).toContain('width="32"');
    expect(html).toMatch(/class="ca-av ph"[^>]*>S</);
  });

  it("connects another with a link that goes to the platform and comes back to the chat, with no acknowledgement in it until the box is ticked", () => {
    expect(html).toContain('href="/api/oauth/meta_facebook/start?next=/app/assistant"');
    expect(html).toContain('href="/api/oauth/meta_instagram/start?next=/app/assistant"');
    expect(html).toContain('href="/api/oauth/youtube/start?next=/app/assistant"');
    expect(html).toContain('href="/api/oauth/tiktok/start?next=/app/assistant"');
    // a long-press or a middle-click follows the address without the click handler: the box is empty, so the address must not say it was ticked
    expect(html).not.toContain("ack=1");
    // the platform with accounts says "Connect another", the empty one says "Connect"
    expect(count(html, `>${t.connectAnother}<`)).toBe(3);
    expect(count(html, `>${t.connect}<`)).toBe(1);
    expect(html).toContain(`aria-label="${t.connectAnother} (${t.kind.FB})"`);
    // the box that says the person owns the accounts is there, empty, with the settings' own words
    expect(html).toContain(esc(en.settings.authorityAck));
    expect(html).toMatch(/<input[^>]*type="checkbox"/);
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/);
    // above the Connect buttons: the words the settings use for it say "the box above"
    expect(html.indexOf('type="checkbox"')).toBeLessThan(html.indexOf("/api/oauth/"));
  });

  it("links to WhatsApp, which has its own page", () => {
    expect(html).toContain('href="/app/whatsapp"');
    expect(html).toContain(t.whatsappOpen);
  });

  it("keeps a place for the confirmation of each platform the chat can switch that a screen reader watches, and shows the one it is given", () => {
    expect(count(html, 'aria-live="polite"')).toBe(2);
    const said = view(state(), "en", { notice: { platform: "FB", text: "The chat now works with Sunrise Cafe." } });
    expect(said).toMatch(/role="status" aria-live="polite">The chat now works with Sunrise Cafe\.</);
    expect(count(said, "The chat now works with")).toBe(1);
  });

  it("shows a failed switch as an alert under the platform it was for", () => {
    const failed = view(state(), "en", { error: { platform: "IG", text: t.chooseFailed } });
    expect(failed).toContain(`role="alert">${t.chooseFailed}<`);
  });

  it("puts each account name in its own direction (a Latin name in an Arabic sentence stays whole)", () => {
    expect(count(html, 'class="ca-name" dir="auto"')).toBe(5);
  });
});

describe("the Accounts card with nothing connected", () => {
  const html = view(state({ lists: NONE, selected: NOTHING }));
  const t = en.chat.accounts;

  it("shows only Connect for every platform, and nothing to choose", () => {
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain(`>${t.inUse}<`);
    expect(count(html, `>${t.connect}<`)).toBe(4);
    expect(html).not.toContain(t.connectAnother);
    expect(count(html, t.empty)).toBe(4);
    for (const p of ["meta_facebook", "meta_instagram", "tiktok", "youtube"]) expect(html).toContain(`href="/api/oauth/${p}/start?next=/app/assistant"`);
  });
});

describe("the Accounts card with one account on a platform", () => {
  it("shows it as the one in use, with no radio to tap", () => {
    const html = view(state({ lists: { ...NONE, FB: [{ id: "fb1", name: "Only Page", avatarUrl: null }] }, selected: { ...NOTHING, FB: "fb1" } }));
    expect(html).toContain("Only Page");
    expect(html).not.toContain('type="radio"');
    expect(count(html, `>${en.chat.accounts.inUse}<`)).toBe(1);
  });
});

describe("the Accounts card in a news desk", () => {
  const html = view(state({ kind: "news", selected: NOTHING }));

  it("lists the accounts and connects another, with nothing to choose and nothing marked", () => {
    expect(html).toContain("Sunrise Bakery");
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain(`>${en.chat.accounts.inUse}<`);
    expect(html).toContain(en.chat.accounts.deskSub);
    expect(html).not.toContain(en.chat.accounts.sub);
  });

  it("comes back to the desk's chat after connecting, and has no WhatsApp", () => {
    expect(html).toContain('href="/api/oauth/meta_facebook/start?next=/newsroom/assistant"');
    expect(html).not.toContain("next=/app/assistant");
    expect(html).not.toContain("ack=1");
    expect(html).not.toContain("/app/whatsapp");
  });

  it("is a card that cannot choose even when a choosing function is passed", () => {
    expect(view(state({ kind: "news" }), "en", { onChoose: () => undefined })).not.toContain('type="radio"');
  });
});

describe("the Accounts card for a role that may only look", () => {
  it("shows the accounts but offers neither a choice nor a connection", () => {
    const html = view(state({ canConfigure: false }));
    expect(html).toContain("Sunrise Bakery");
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain("/api/oauth/");
    expect(html).not.toContain(esc(en.settings.authorityAck));
  });
});

describe("where connecting comes back to", () => {
  it("is the chat the person is in", () => {
    expect(chatPathOf("shop")).toBe("/app/assistant");
    expect(chatPathOf("news")).toBe("/newsroom/assistant");
    expect(connectHref("TT", "shop")).toBe("/api/oauth/tiktok/start?next=/app/assistant");
    expect(connectHref("FB", "news")).toBe("/api/oauth/meta_facebook/start?next=/newsroom/assistant");
  });

  it("says the person owns the account only once they ticked the box, as Settings does", () => {
    for (const p of ["FB", "IG", "TT", "YT"] as const) {
      for (const kind of ["shop", "news"] as const) {
        expect(connectHref(p, kind), `${p} ${kind}`).not.toContain("ack");
        expect(connectHref(p, kind, false), `${p} ${kind}`).not.toContain("ack");
        expect(connectHref(p, kind, true), `${p} ${kind}`).toBe(`${connectHref(p, kind)}&ack=1`);
      }
    }
  });

  it("is an address the OAuth start route accepts", () => {
    const route = read("src/app/api/oauth/[provider]/start/route.ts");
    expect(route).toContain("(app|newsroom|dashboard)");
    for (const kind of ["shop", "news"] as const) expect(chatPathOf(kind)).toMatch(/^\/(app|newsroom|dashboard)(\/|\?|$)/);
  });

  it("uses the same acknowledgement as Settings and the older connect card", () => {
    const src = read("src/app/app/assistant/chat-accounts.tsx");
    expect(src).toContain('"gm_authority_ack"');
    expect(src).toContain("all.settings.authorityAck");
    expect(src).toContain("all.settings.authorityNeeded");
    // the address follows the box, and the click is still stopped until it is ticked
    expect(src).toContain("connectHref(platform, state.kind, ack)");
    expect(src).toMatch(/if \(!ack\) \{\s*e\.preventDefault\(\)/);
    expect(read("src/app/app/assistant/chat-connect.tsx")).toContain('"gm_authority_ack"');
  });
});

describe("the Accounts card in every language", () => {
  for (const lang of ["ckb", "ar"] as const) {
    it(`speaks ${lang}`, () => {
      const d = DICT[lang];
      const html = view(state(), lang);
      expect(html).toContain(d.chat.accounts.kind.FB);
      expect(html).toContain(d.chat.accounts.connectAnother);
      expect(html).toContain(esc(d.settings.authorityAck));
      expect(html).toContain(d.wa.nav);
      expect(html).not.toContain(en.chat.accounts.connectAnother);
    });
  }

  it("says the chosen account in a sentence with the name kept whole, in each language", () => {
    for (const lang of ["en", "ckb", "ar"] as const) {
      const c = DICT[lang].chat.accounts;
      const text = c.chosen(c.kind.FB, "Sunrise Cafe");
      expect(text).toContain(c.kind.FB);
      expect(text).toContain("Sunrise Cafe");
    }
  });
});

describe("the Accounts words", () => {
  const strings = (o: unknown): string[] =>
    typeof o === "string" ? [o] : typeof o === "function" ? [(o as (a: string, b: string) => string)("KIND", "NAME")] : o && typeof o === "object" ? Object.values(o).flatMap(strings) : [];
  const keys = (o: unknown, prefix = ""): string[] =>
    o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`])) : [];

  it("exist under the same keys in the three languages, none empty", () => {
    expect(keys(ar.chat.accounts)).toEqual(keys(ckb.chat.accounts));
    expect(keys(en.chat.accounts)).toEqual(keys(ckb.chat.accounts));
    for (const lang of ["en", "ckb", "ar"] as const) for (const s of strings(DICT[lang].chat.accounts)) expect(s.trim(), lang).toBeTruthy();
  });

  it("never say shop or the loan word for it", () => {
    for (const s of strings(en.chat.accounts)) expect(s).not.toMatch(/\bshops?\b|\bstores?\b/i);
    for (const s of strings(ckb.chat.accounts)) expect(s).not.toContain("شاپ");
    for (const s of strings(ar.chat.accounts)) expect(s).not.toMatch(/متجر|شوب/);
  });

  it("keep each language to its own script and letters", () => {
    expect(ARABIC_SCRIPT.test(strings(en.chat.accounts).join(" "))).toBe(false);
    expect(KURDISH_ONLY.test(strings(ar.chat.accounts).join(" "))).toBe(false);
    for (const key of ["sub", "loading", "empty", "noPost", "chooseFailed"] as const) {
      expect(ARABIC_SCRIPT.test(ckb.chat.accounts[key]), `ckb ${key}`).toBe(true);
      expect(ARABIC_SCRIPT.test(ar.chat.accounts[key]), `ar ${key}`).toBe(true);
    }
  });

  it("do not carry a unicode escape sequence in the source", () => {
    for (const f of ["chat.ckb.ts", "chat.ar.ts", "chat.en.ts"]) {
      const block = read(`src/lib/i18n/${f}`).split("accounts: {")[1]?.split("\n  },")[0] ?? "";
      expect(block.length, f).toBeGreaterThan(200);
      expect(block, f).not.toContain(String.fromCharCode(92) + "u");
    }
  });
});

describe("the header's Accounts button", () => {
  const api: ChatApi = { list: async () => ({ ok: true, threads: [] }), rename: async () => ({ ok: true }), pin: async () => ({ ok: true }), remove: async () => ({ ok: true }) };
  const support = { url: "https://example.test", display: "+0" };
  const frame = (lang: L = "en", kind: "MERCHANT" | "NEWS" = "MERCHANT", extra: Partial<ChatApi> = {}) =>
    renderToStaticMarkup(
      createElement(LangProvider, {
        lang,
        children: createElement(ChatCopyProvider, {
          kind: kind === "NEWS" ? "news" : "shop",
          children: createElement(ChatFrame, {
            api: { ...api, ...extra },
            kind,
            workspace: "Workspace A",
            workspaceId: "A",
            studio: false,
            video: false,
            support,
            children: createElement("p", null, "screen"),
          } as never),
        }),
      }),
    );

  it("is in the slim header, labelled, and opens a dialog that is closed at first", () => {
    const html = frame();
    expect(html).toMatch(/<button[^>]*class="ch-accbtn"[^>]*aria-label="Accounts"[^>]*aria-haspopup="dialog"[^>]*aria-expanded="false"/);
    expect(html.indexOf("ch-accbtn")).toBeGreaterThan(html.indexOf("<header"));
    expect(html.indexOf("ch-accbtn")).toBeLessThan(html.indexOf("</header>"));
    expect(html).not.toContain("ch-sheet");
    expect(html).not.toContain("ch-accounts-title");
  });

  it("is there for a news desk too, and in the person's language", () => {
    expect(frame("en", "NEWS")).toContain("ch-accbtn");
    expect(frame("ckb")).toContain(`aria-label="${ckb.chat.accounts.open}"`);
    expect(frame("ar")).toContain(`aria-label="${ar.chat.accounts.open}"`);
  });

  it("leaves the rest of the header as it was", () => {
    const html = frame();
    expect(html).toContain(`aria-label="${en.chat.frame.openList}"`);
    expect(html).toContain(`aria-label="${en.chat.newChat}"`);
    expect(html).toContain('class="ch-head-title"');
  });

  it("takes the accounts of the app's server when the page gives none, and the page's own when it does", () => {
    const own: AccountsApi = { list: async () => ({ ok: false, code: "signin" }), choose: async () => ({ ok: false, code: "signin" }) };
    expect(frame("en", "MERCHANT", { accounts: own })).toContain("ch-accbtn");
    const src = read("src/app/app/assistant/chat-shell.tsx");
    expect(src).toContain("api.accounts ?? lazyAccountsApi");
  });

  it("closes the way the drawer does: Escape, its own X, the shade, and the keyboard goes back to the button", () => {
    const src = read("src/app/app/assistant/chat-shell.tsx");
    expect(src).toContain('role="dialog" aria-modal="true" aria-labelledby="ch-accounts-title"');
    expect(src).toMatch(/accountsOpen[^]*e\.key === "Escape"[^]*closeAccounts\(\)/);
    expect(src).toContain("accountsButton.current?.focus()");
    expect(src).toContain("accountsClose.current?.focus()");
    expect(src).toContain('onClick={closeAccounts} aria-hidden="true"');
    // everything behind the sheet is out of reach while it is open
    expect(src).toContain("inert={(open && !desktop) || accountsOpen}");
    expect(src).toContain("inert={accountsOpen}");
  });
});

describe("the card inside the chat", () => {
  const message: MessageDto = {
    id: "m1",
    seq: 1,
    role: "assistant",
    text: "These are your accounts.",
    blocks: [{ kind: "accounts" }],
    runs: [],
    followups: [],
    attachments: [],
    createdAt: "2026-10-20T09:00:00.000Z",
  };
  const support = { url: "https://example.test", display: "+0" };
  const screen = (lang: L = "en") =>
    renderToStaticMarkup(
      createElement(LangProvider, {
        lang,
        children: createElement(ChatCopyProvider, {
          kind: "shop",
          children: createElement(ChatScreen, { workspaceId: "w1", thread: { id: "t1", title: "x", kind: "shop", updatedAt: "2026-10-20T09:00:00.000Z" }, initialMessages: [message], remaining: null, support } as never),
        }),
      }),
    );

  it("draws the accounts block as the same live card, with its own title, while it loads", () => {
    const html = screen();
    expect(html).toContain('<h3 class="ch-block-title">Accounts</h3>');
    expect(html).toContain(en.chat.accounts.loading);
    expect(html).toContain('aria-busy="true"');
  });

  it("does so in the person's language", () => {
    expect(screen("ckb")).toContain(ckb.chat.accounts.loading);
    expect(screen("ar")).toContain(ar.chat.accounts.loading);
  });
});

describe("the look of the card", () => {
  const css = read("src/app/app/chat.css");

  it("keeps every tap target at 44px or more, and reserves room so nothing jumps", () => {
    expect(css).toMatch(/\.ca \.gm-btn \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.ca-opt \{[^}]*min-height: 48px/);
    expect(css).toMatch(/\.ca-ackbox \.ch-ack \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.ca-skel \{[^}]*min-height: 180px/);
    expect(css).toMatch(/\.ca-av \{[^}]*width: 32px; height: 32px/);
  });

  it("uses logical properties only, so it follows the language's direction", () => {
    const block = css.split("Accounts: the header button")[1] ?? "";
    expect(block.length).toBeGreaterThan(500);
    expect(block).not.toMatch(/(?<![-\w])(margin|padding|border)-(left|right)\b|(?<![-\w])(left|right)\s*:/);
  });
});

describe("the Accounts card for TikTok and YouTube", () => {
  const t = en.chat.accounts;
  // two accounts on each platform, all four marked as the newest connection by the server
  const many = state({
    lists: {
      FB: [
        { id: "fb1", name: "Sunrise Bakery", avatarUrl: null },
        { id: "fb2", name: "Sunrise Cafe", avatarUrl: null },
      ],
      IG: [{ id: "ig1", name: "@sunrise.bakery", avatarUrl: null }],
      TT: [
        { id: "tt1", name: "@sunrise.tt", avatarUrl: null },
        { id: "tt2", name: "@sunrise.tt2", avatarUrl: null },
      ],
      YT: [
        { id: "yt1", name: "Sunrise TV", avatarUrl: null },
        { id: "yt2", name: "Sunrise TV 2", avatarUrl: null },
      ],
    },
    selected: { FB: "fb1", IG: "ig1", TT: "tt2", YT: "yt2" },
  });
  const html = view(many);

  it("lets the chat switch Facebook Pages and Instagram accounts only", () => {
    expect([...CHOOSABLE]).toEqual(["FB", "IG"]);
    expect(canChoose("FB")).toBe(true);
    expect(canChoose("IG")).toBe(true);
    expect(canChoose("TT")).toBe(false);
    expect(canChoose("YT")).toBe(false);
  });

  it("lists every TikTok account and YouTube channel, with nothing to choose and nothing marked in use", () => {
    for (const name of ["@sunrise.tt", "@sunrise.tt2", "Sunrise TV", "Sunrise TV 2"]) expect(html).toContain(name);
    // only the two Pages are a choice; the single Instagram account is shown, marked
    expect(count(html, 'type="radio"')).toBe(2);
    expect(radio(html, "tt1")).toBe("");
    expect(radio(html, "yt1")).toBe("");
    expect(count(html, `>${t.inUse}<`)).toBe(2);
  });

  it("can still connect another TikTok account or YouTube channel", () => {
    expect(html).toContain('href="/api/oauth/tiktok/start?next=/app/assistant"');
    expect(html).toContain('href="/api/oauth/youtube/start?next=/app/assistant"');
  });

  it("says honestly, under those two only, that the chat cannot post or reply there", () => {
    expect(count(html, t.noPost)).toBe(2);
    expect(count(view(state({ lists: NONE, selected: NOTHING })), t.noPost)).toBe(2);
    const groups = html.split('class="ca-group"');
    // the groups are Facebook, Instagram, TikTok, YouTube, then WhatsApp
    expect(groups[1]).not.toContain(t.noPost);
    expect(groups[2]).not.toContain(t.noPost);
    expect(groups[3]).toContain(t.noPost);
    expect(groups[4]).toContain(t.noPost);
  });

  it("never says the chat works with one of them", () => {
    expect(html).not.toContain("The chat now works with");
    const said = view(many, "en", { notice: { platform: "FB", text: "The chat now works with Sunrise Cafe." } });
    expect(count(said, "The chat now works with")).toBe(1);
  });

  it("says it in a news desk too, which cannot post there either", () => {
    expect(count(view(state({ kind: "news", selected: NOTHING })), t.noPost)).toBe(2);
  });

  it("says it in the person's three languages", () => {
    for (const lang of ["ckb", "ar"] as const) expect(count(view(many, lang), DICT[lang].chat.accounts.noPost)).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Choosing an account: what is drawn at once, what is taken back, which answer counts, and who is told. The server and the page are
// replaced by a recorder; the flow is the real one.

describe("choosing an account", () => {
  const deferred = <T>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  /** What the server answers once it saved a choice: the lists, and the account each platform now works with. */
  const saved = (selected: Partial<ChatAccountsState["selected"]>): ChatAccountsResult => state({ selected: { ...state().selected, ...selected } });

  function screen(initial: ChatAccountsState = state()) {
    let current: ChooseView = chooseReducer(FRESH_VIEW, { type: "loaded", state: initial });
    const log: string[] = [];
    const told: Array<[AccountPlatform, string | null]> = [];
    const mine = { alive: true, forgot: 0 };
    const api = { choose: vi.fn<AccountsApi["choose"]>() };
    const flow: ChooseFlow = {
      api,
      workspaceId: "w1",
      alive: () => mine.alive,
      dispatch: (a) => {
        log.push(a.type);
        current = chooseReducer(current, a);
      },
      // every open screen hears it, this one too (as it does in the page)
      broadcast: (platform, id) => {
        told.push([platform, id]);
        current = chooseReducer(current, { type: "pick", platform, id });
      },
      forget: () => void (mine.forgot += 1),
      say: {
        chosen: (platform, name) => `chose ${platform} ${name}`,
        refused: "refused",
        failed: (r) => (r && !r.ok && r.code === "signin" ? "signin" : "failed"),
      },
    };
    return {
      flow,
      api,
      mine,
      log,
      told,
      get view() {
        return current;
      },
      tap: (platform: AccountPlatform, id: string) => runChoose(flow, current.state, platform, id),
    };
  }

  it("draws the tapped account at once, before the server has answered, and asks the server for it", async () => {
    const s = screen();
    const answer = deferred<ChatAccountsResult>();
    s.api.choose.mockReturnValue(answer.promise);
    const done = s.tap("FB", "fb2");
    expect(s.view.state?.selected.FB).toBe("fb2");
    expect(s.view.notice).toBeNull();
    expect(s.api.choose).toHaveBeenCalledWith({ platform: "FB", id: "fb2", workspaceId: "w1" });
    expect(s.told).toEqual([]);
    answer.resolve(saved({ FB: "fb2" }));
    await done;
    expect(s.view.state?.selected.FB).toBe("fb2");
    expect(s.view.notice).toEqual({ platform: "FB", text: "chose FB Sunrise Cafe" });
    expect(s.view.error).toBeNull();
    expect(s.told).toEqual([["FB", "fb2"]]);
    expect(s.mine.forgot).toBe(1);
  });

  it("clears the line of the last switch when the next tap is made", async () => {
    const s = screen();
    s.api.choose.mockResolvedValue(saved({ FB: "fb2" }));
    await s.tap("FB", "fb2");
    expect(s.view.notice).not.toBeNull();
    const answer = deferred<ChatAccountsResult>();
    s.api.choose.mockReturnValue(answer.promise);
    const done = s.tap("FB", "fb1");
    expect(s.view.notice).toBeNull();
    expect(s.view.error).toBeNull();
    answer.resolve(saved({ FB: "fb1" }));
    await done;
  });

  it("takes the choice back and says so when the server refuses, and tells nobody", async () => {
    const s = screen();
    s.api.choose.mockResolvedValue({ ok: false, code: "internal" });
    await s.tap("FB", "fb2");
    expect(s.view.state?.selected.FB).toBe("fb1");
    expect(s.view.error).toEqual({ platform: "FB", text: "failed" });
    expect(s.view.notice).toBeNull();
    expect(s.told).toEqual([]);
    expect(s.mine.forgot).toBe(1);
  });

  it("says the session is the problem when it is", async () => {
    const s = screen();
    s.api.choose.mockResolvedValue({ ok: false, code: "signin" });
    await s.tap("IG", "ig1");
    expect(s.view.state?.selected.IG).toBe("ig2");
    expect(s.view.error).toEqual({ platform: "IG", text: "signin" });
  });

  it("takes the choice back when the request itself fails", async () => {
    const s = screen();
    s.api.choose.mockRejectedValue(new Error("offline"));
    await s.tap("FB", "fb2");
    expect(s.view.state?.selected.FB).toBe("fb1");
    expect(s.view.error?.text).toBe("failed");
    expect(s.mine.forgot).toBe(1);
  });

  it("shows what the server really saved when that is not what was asked for", async () => {
    const s = screen();
    s.api.choose.mockResolvedValue(saved({ FB: "fb1" }));
    await s.tap("FB", "fb2");
    expect(s.view.state?.selected.FB).toBe("fb1");
    expect(s.view.error).toEqual({ platform: "FB", text: "refused" });
    expect(s.view.notice).toBeNull();
    expect(s.told).toEqual([["FB", "fb1"]]);
  });

  it("does nothing for the account already in use, before the lists are there, or on a platform the chat has no tool for", async () => {
    const s = screen();
    await s.tap("FB", "fb1");
    await s.tap("TT", "tt1");
    await s.tap("YT", "yt1");
    await runChoose(s.flow, null, "FB", "fb2");
    expect(s.api.choose).not.toHaveBeenCalled();
    expect(s.log).toEqual([]);
  });

  it("counts only the latest tap on a platform: an answer that comes after a newer tap changes nothing", async () => {
    const s = screen();
    const first = deferred<ChatAccountsResult>();
    const second = deferred<ChatAccountsResult>();
    s.api.choose.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const one = s.tap("FB", "fb2");
    const two = s.tap("FB", "fb1");
    expect(s.view.state?.selected.FB).toBe("fb1");
    // the newer answer arrives first, then the older one
    second.resolve(saved({ FB: "fb1" }));
    await two;
    first.resolve(saved({ FB: "fb2" }));
    await one;
    expect(s.view.state?.selected.FB).toBe("fb1");
    expect(s.told).toEqual([["FB", "fb1"]]);
    expect(s.view.notice).toEqual({ platform: "FB", text: "chose FB Sunrise Bakery" });
    expect(s.mine.forgot).toBe(2);
  });

  it("does not let the older answer flip the account back while the newer tap is still waiting", async () => {
    const s = screen();
    const first = deferred<ChatAccountsResult>();
    const second = deferred<ChatAccountsResult>();
    s.api.choose.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const one = s.tap("FB", "fb2");
    const two = s.tap("FB", "fb1");
    first.resolve(saved({ FB: "fb2" }));
    await one;
    expect(s.view.state?.selected.FB).toBe("fb1");
    expect(s.told).toEqual([]);
    expect(s.view.notice).toBeNull();
    second.resolve(saved({ FB: "fb1" }));
    await two;
    expect(s.view.state?.selected.FB).toBe("fb1");
    expect(s.told).toEqual([["FB", "fb1"]]);
  });

  it("does not take back a newer tap because an older one failed", async () => {
    const s = screen();
    const first = deferred<ChatAccountsResult>();
    const second = deferred<ChatAccountsResult>();
    s.api.choose.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const one = s.tap("FB", "fb2");
    const two = s.tap("FB", "fb1");
    first.resolve({ ok: false, code: "internal" });
    await one;
    expect(s.view.state?.selected.FB).toBe("fb1");
    expect(s.view.error).toBeNull();
    second.resolve(saved({ FB: "fb1" }));
    await two;
  });

  it("keeps a choice that is still waiting on one platform when the answer for another comes in", async () => {
    const s = screen();
    const fb = deferred<ChatAccountsResult>();
    const ig = deferred<ChatAccountsResult>();
    s.api.choose.mockReturnValueOnce(fb.promise).mockReturnValueOnce(ig.promise);
    const one = s.tap("FB", "fb2");
    const two = s.tap("IG", "ig1");
    // the answer for Facebook still has the Instagram account that was in use before the tap
    fb.resolve(saved({ FB: "fb2", IG: "ig2" }));
    await one;
    expect(s.view.state?.selected).toMatchObject({ FB: "fb2", IG: "ig1" });
    expect(s.told).toEqual([["FB", "fb2"]]);
    ig.resolve(saved({ FB: "fb2", IG: "ig1" }));
    await two;
    expect(s.view.state?.selected).toMatchObject({ FB: "fb2", IG: "ig1" });
    expect(s.view.notice).toEqual({ platform: "IG", text: "chose IG @sunrise.bakery" });
  });

  it("tells the other open screens what was saved even when the screen that asked has been closed", async () => {
    const s = screen();
    const answer = deferred<ChatAccountsResult>();
    s.api.choose.mockReturnValue(answer.promise);
    const done = s.tap("FB", "fb2");
    s.mine.alive = false;
    answer.resolve(saved({ FB: "fb2" }));
    await done;
    expect(s.told).toEqual([["FB", "fb2"]]);
    expect(s.mine.forgot).toBe(1);
    // the closed screen is left alone: no sentence, nothing taken back
    expect(s.log).toEqual(["tap"]);
    expect(s.view.notice).toBeNull();
    expect(s.view.error).toBeNull();
  });

  it("does not draw a take-back or an error on a screen that has been closed", async () => {
    const s = screen();
    const answer = deferred<ChatAccountsResult>();
    s.api.choose.mockReturnValue(answer.promise);
    const done = s.tap("FB", "fb2");
    s.mine.alive = false;
    answer.resolve({ ok: false, code: "internal" });
    await done;
    expect(s.log).toEqual(["tap"]);
    expect(s.told).toEqual([]);
    expect(s.mine.forgot).toBe(1);
  });

  it("is told to the screens that are open, and to those only", () => {
    const heard: Array<[string, AccountPlatform, string | null]> = [];
    const offA = onPick((p, id) => heard.push(["a", p, id]));
    const offB = onPick((p, id) => heard.push(["b", p, id]));
    broadcastPick("IG", "ig1");
    offA();
    broadcastPick("FB", null);
    offB();
    broadcastPick("FB", "fb2");
    expect(heard).toEqual([
      ["a", "IG", "ig1"],
      ["b", "IG", "ig1"],
      ["b", "FB", null],
    ]);
  });

  it("is what the card is wired to", () => {
    const src = read("src/app/app/assistant/chat-accounts.tsx");
    expect(src).toContain("runChoose(");
    expect(src).toContain("broadcast: broadcastPick");
    expect(src).toContain('onPick((platform, id) => dispatch({ type: "pick", platform, id }))');
    expect(src).toContain("forget: () => void reads.delete(api)");
  });
});

describe("what the card draws while choosing", () => {
  const base = chooseReducer(FRESH_VIEW, { type: "loaded", state: state() });

  it("changes one platform and returns the very same accounts when nothing changes", () => {
    const s = state();
    expect(withSelected(s, "FB", "fb1")).toBe(s);
    const changed = withSelected(s, "FB", "fb2");
    expect(changed.selected).toEqual({ ...s.selected, FB: "fb2" });
    expect(changed.lists).toBe(s.lists);
    expect(s.selected.FB).toBe("fb1");
    expect(withSelected(s, "IG", null).selected.IG).toBeNull();
  });

  it("clears both lines when a tap is made, and draws the tapped account", () => {
    const lines: ChooseView = { ...base, notice: { platform: "FB", text: "n" }, error: { platform: "IG", text: "e" } };
    const next = chooseReducer(lines, { type: "tap", platform: "FB", id: "fb2" });
    expect(next.state?.selected.FB).toBe("fb2");
    expect(next.notice).toBeNull();
    expect(next.error).toBeNull();
  });

  it("shows one line at a time", () => {
    const withNotice = chooseReducer(base, { type: "notice", mark: { platform: "FB", text: "n" } });
    expect(withNotice.notice?.text).toBe("n");
    const withError = chooseReducer(withNotice, { type: "error", mark: { platform: "IG", text: "e" } });
    expect(withError.notice).toBeNull();
    expect(withError.error?.text).toBe("e");
    expect(chooseReducer(withError, { type: "notice", mark: { platform: "FB", text: "n2" } }).error).toBeNull();
  });

  it("takes a choice from another screen without touching the lines or the other platforms", () => {
    const lines: ChooseView = { ...base, notice: { platform: "FB", text: "n" } };
    const next = chooseReducer(lines, { type: "pick", platform: "IG", id: "ig1" });
    expect(next.state?.selected).toEqual({ ...state().selected, IG: "ig1" });
    expect(next.notice).toBe(lines.notice);
  });

  it("ignores a choice from another screen before its own lists have come", () => {
    expect(chooseReducer(FRESH_VIEW, { type: "pick", platform: "FB", id: "fb2" })).toBe(FRESH_VIEW);
    expect(chooseReducer(FRESH_VIEW, { type: "tap", platform: "FB", id: "fb2" }).state).toBeNull();
  });

  it("replaces the lists when they are loaded again and keeps the lines", () => {
    const lines: ChooseView = { ...base, error: { platform: "FB", text: "e" } };
    const fresh = state({ selected: { ...state().selected, FB: "fb2" } });
    const next = chooseReducer(lines, { type: "loaded", state: fresh });
    expect(next.state).toBe(fresh);
    expect(next.error).toBe(lines.error);
  });
});
