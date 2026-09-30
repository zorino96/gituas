// Two products on two domains, one app: the shop lives on gituas.com and the
// newsroom on hawalnoos.com. Sessions are per domain, so each product keeps
// its own sign-in. gituas.vercel.app, previews and localhost serve everything
// as before (platform OAuth callbacks come back there).

export const SHOP_ORIGIN = "https://gituas.com";
export const NEWSROOM_ORIGIN = "https://hawalnoos.com";

const SHOP_HOSTS = new Set(["gituas.com", "www.gituas.com"]);
const NEWS_HOSTS = new Set(["hawalnoos.com", "www.hawalnoos.com"]);

export type Route = { kind: "next" } | { kind: "rewrite"; path: string } | { kind: "redirect"; url: string };

const NEXT: Route = { kind: "next" };
const AUTH_PAGES = new Set(["/login", "/signup", "/forgot"]);
/** Shop-only and operator-only areas. */
const SHOP_ONLY = /^\/(app|dashboard|mobile|w)(\/|$)/;
const NEWSROOM = /^\/newsroom(\/|$)/;

/** Where a request belongs, by host and path. Pure, so the proxy stays thin and testable. */
export function routeFor(hostHeader: string, path: string, search: string): Route {
  const host = hostHeader.toLowerCase().split(":")[0];
  if (!SHOP_HOSTS.has(host) && !NEWS_HOSTS.has(host)) return NEXT;
  // Plumbing and files are served as they are on either domain.
  if (path.startsWith("/api/") || path.startsWith("/_next/") || path.startsWith("/m/") || /\.[a-z0-9]+$/i.test(path)) return NEXT;

  const params = new URLSearchParams(search);
  const next = params.get("next") ?? "";

  if (NEWS_HOSTS.has(host)) {
    if (host !== "hawalnoos.com") return { kind: "redirect", url: `${NEWSROOM_ORIGIN}${path}${search}` };
    if (path === "/") return { kind: "rewrite", path: "/newsroom" };
    if (SHOP_ONLY.test(path)) return { kind: "redirect", url: `${SHOP_ORIGIN}${path}${search}` };
    if (AUTH_PAGES.has(path)) {
      if (next.startsWith("/app")) return { kind: "redirect", url: `${SHOP_ORIGIN}${path}${search}` };
      if (!next && !params.has("callbackUrl")) {
        params.set("next", "/newsroom/news");
        return { kind: "redirect", url: `${NEWSROOM_ORIGIN}${path}?${params.toString()}` };
      }
    }
    return NEXT;
  }

  // The shop domain: its root opens the shop (or the shop's sign-in).
  if (host !== "gituas.com") return { kind: "redirect", url: `${SHOP_ORIGIN}${path}${search}` };
  if (path === "/") return { kind: "redirect", url: `${SHOP_ORIGIN}/app` };
  if (NEWSROOM.test(path)) return { kind: "redirect", url: `${NEWSROOM_ORIGIN}${path}${search}` };
  if (AUTH_PAGES.has(path)) {
    if (next.startsWith("/newsroom")) return { kind: "redirect", url: `${NEWSROOM_ORIGIN}${path}${search}` };
    // A bare sign-in is the shop's. A failed attempt (?error=) keeps the login page's own cookie-based fallback.
    if (!next && !params.has("callbackUrl") && !params.has("error")) {
      params.set("next", "/app");
      return { kind: "redirect", url: `${SHOP_ORIGIN}${path}?${params.toString()}` };
    }
  }
  return NEXT;
}

/** Origins our own pages may send people back to after a platform connect. */
export function isAppOrigin(origin: string): boolean {
  const allowed = new Set([
    SHOP_ORIGIN,
    NEWSROOM_ORIGIN,
    "https://www.gituas.com",
    "https://www.hawalnoos.com",
    "https://gituas.vercel.app",
    "http://localhost:3001",
  ]);
  const own = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (own) allowed.add(own);
  return allowed.has(origin);
}
