import { describe, expect, it } from "vitest";
import { isAppOrigin, NEWSROOM_ORIGIN, routeFor, SHOP_ORIGIN } from "@/lib/hosts";

describe("routeFor on the newsroom domain", () => {
  const r = (path: string, search = "") => routeFor("hawalnoos.com", path, search);
  it("serves the newsroom landing at the root", () => {
    expect(r("/")).toEqual({ kind: "rewrite", path: "/newsroom" });
  });
  it("leaves newsroom pages, APIs, media and legal pages alone", () => {
    for (const p of ["/newsroom/news", "/api/auth/session", "/m/merchant/x.jpg", "/connect/facebook", "/privacy", "/_next/x.js", "/favicon.ico"]) {
      expect(r(p)).toEqual({ kind: "next" });
    }
  });
  it("serves the card render page itself, token and all, and the shop domain hands it over", () => {
    expect(r("/newsroom/card-render/abc123", "?t=1800000300.ab")).toEqual({ kind: "next" });
    expect(routeFor("gituas.com", "/newsroom/card-render/abc123", "?t=1800000300.ab")).toEqual({
      kind: "redirect",
      url: `${NEWSROOM_ORIGIN}/newsroom/card-render/abc123?t=1800000300.ab`,
    });
    expect(routeFor("localhost:3012", "/newsroom/card-render/abc123", "?t=1800000300.ab")).toEqual({ kind: "next" });
  });
  it("sends shop and operator pages to the shop domain", () => {
    expect(r("/app/settings", "?a=1")).toEqual({ kind: "redirect", url: `${SHOP_ORIGIN}/app/settings?a=1` });
    expect(r("/dashboard")).toEqual({ kind: "redirect", url: `${SHOP_ORIGIN}/dashboard` });
    expect(r("/w/my-shop")).toEqual({ kind: "redirect", url: `${SHOP_ORIGIN}/w/my-shop` });
  });
  it("opens sign-in, sign-up and forgot as the newsroom's when nothing says otherwise", () => {
    expect(r("/login")).toEqual({ kind: "redirect", url: `${NEWSROOM_ORIGIN}/login?next=%2Fnewsroom%2Fnews` });
    expect(r("/signup", "?x=1")).toEqual({ kind: "redirect", url: `${NEWSROOM_ORIGIN}/signup?x=1&next=%2Fnewsroom%2Fnews` });
    expect(r("/login", "?next=/newsroom/team")).toEqual({ kind: "next" });
    expect(r("/login", "?error=OAuthCallbackError&callbackUrl=https%3A%2F%2Fhawalnoos.com%2Fnewsroom%2Fnews")).toEqual({ kind: "next" });
  });
  it("sends a shop sign-in to the shop domain", () => {
    expect(r("/login", "?next=/app")).toEqual({ kind: "redirect", url: `${SHOP_ORIGIN}/login?next=/app` });
  });
  it("drops www", () => {
    expect(routeFor("www.hawalnoos.com", "/newsroom/news", "?t=1")).toEqual({ kind: "redirect", url: `${NEWSROOM_ORIGIN}/newsroom/news?t=1` });
  });
});

describe("routeFor on the shop domain", () => {
  const r = (path: string, search = "") => routeFor("gituas.com", path, search);
  it("sends newsroom pages and newsroom sign-ins to the newsroom domain", () => {
    expect(r("/newsroom/news", "?tab=new")).toEqual({ kind: "redirect", url: `${NEWSROOM_ORIGIN}/newsroom/news?tab=new` });
    expect(r("/newsroom")).toEqual({ kind: "redirect", url: `${NEWSROOM_ORIGIN}/newsroom` });
    expect(r("/login", "?next=%2Fnewsroom%2Fnews")).toEqual({ kind: "redirect", url: `${NEWSROOM_ORIGIN}/login?next=%2Fnewsroom%2Fnews` });
  });
  it("shows the welcome page at the root", () => {
    expect(r("/")).toEqual({ kind: "rewrite", path: "/welcome" });
  });
  it("opens sign-in, sign-up and forgot as the shop's when nothing says otherwise", () => {
    for (const p of ["/login", "/signup", "/forgot"]) {
      expect(r(p)).toEqual({ kind: "redirect", url: `${SHOP_ORIGIN}${p}?next=%2Fapp` });
    }
    expect(r("/login", "?next=%2Fdashboard")).toEqual({ kind: "next" });
    expect(r("/login", "?callbackUrl=%2Fdashboard")).toEqual({ kind: "next" });
    expect(r("/login", "?error=OAuthAccountNotLinked")).toEqual({ kind: "next" });
  });
  it("drops www", () => {
    expect(routeFor("www.gituas.com", "/app", "?x=1")).toEqual({ kind: "redirect", url: `${SHOP_ORIGIN}/app?x=1` });
  });
  it("leaves the shop and everything else alone", () => {
    for (const p of ["/app", "/app/publish", "/api/oauth/meta_facebook/callback", "/dashboard", "/newsroomx", "/privacy"]) {
      expect(r(p)).toEqual({ kind: "next" });
    }
  });
});

describe("routeFor elsewhere", () => {
  it("changes nothing on the vercel.app address, previews or localhost", () => {
    expect(routeFor("gituas.vercel.app", "/newsroom/news", "")).toEqual({ kind: "next" });
    expect(routeFor("localhost:3001", "/app", "")).toEqual({ kind: "next" });
  });
});

describe("isAppOrigin", () => {
  it("accepts our own origins only", () => {
    expect(isAppOrigin("https://hawalnoos.com")).toBe(true);
    expect(isAppOrigin("https://gituas.com")).toBe(true);
    expect(isAppOrigin("https://gituas.vercel.app")).toBe(true);
    expect(isAppOrigin("http://localhost:3001")).toBe(true);
    expect(isAppOrigin("https://evil.com")).toBe(false);
    expect(isAppOrigin("https://hawalnoos.com.evil.com")).toBe(false);
  });
});
