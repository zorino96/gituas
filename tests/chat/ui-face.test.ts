import { describe, expect, it } from "vitest";

import { CLASSIC_HOME, classicHref, opensOnChat } from "@/app/app/face";

const base = { merchant: true, canConfigure: true, chatOn: true, cookie: undefined as string | undefined, ui: undefined as string | string[] | undefined };

describe("whether /app opens on the chat or on Today", () => {
  it("opens on the chat only for the face the person last used", () => {
    expect(opensOnChat({ ...base, cookie: "chat" })).toBe(true);
    expect(opensOnChat({ ...base, cookie: "classic" })).toBe(false);
    expect(opensOnChat({ ...base, cookie: undefined })).toBe(false);
  });

  it("the classic Today link (?ui=classic) always leaves the chat, whatever the cookie says", () => {
    expect(opensOnChat({ ...base, cookie: "chat", ui: "classic" })).toBe(false);
    expect(opensOnChat({ ...base, cookie: "chat", ui: ["classic", "chat"] })).toBe(false);
    // any other value of the query changes nothing
    expect(opensOnChat({ ...base, cookie: "chat", ui: "chat" })).toBe(true);
    expect(opensOnChat({ ...base, cookie: "chat", ui: "" })).toBe(true);
  });

  it("with the chat switched off, a cookie left from before never takes anyone anywhere", () => {
    expect(opensOnChat({ ...base, chatOn: false, cookie: "chat" })).toBe(false);
    expect(opensOnChat({ ...base, chatOn: false, cookie: "chat", ui: "classic" })).toBe(false);
  });

  it("never applies to a news desk or to a role that may not use the chat", () => {
    expect(opensOnChat({ ...base, merchant: false, cookie: "chat" })).toBe(false);
    expect(opensOnChat({ ...base, canConfigure: false, cookie: "chat" })).toBe(false);
  });
});

describe("the classic Today link", () => {
  it("carries the query, so it works from a desktop sidebar, a phone's tab bar and the chat's own list alike", () => {
    expect(classicHref("/app")).toBe(CLASSIC_HOME);
    expect(CLASSIC_HOME).toBe("/app?ui=classic");
  });

  it("leaves every other section's address alone, the chat's own entry included", () => {
    for (const href of ["/app/assistant", "/app/comments", "/app/orders", "/newsroom", "/app/settings"]) expect(classicHref(href)).toBe(href);
  });

  it("is a redirect that cannot loop: what the link leads to is exactly what the redirect lets through", () => {
    const query = new URL(`https://gituas.test${CLASSIC_HOME}`).searchParams.get("ui");
    expect(opensOnChat({ ...base, cookie: "chat", ui: query ?? undefined })).toBe(false);
  });
});
