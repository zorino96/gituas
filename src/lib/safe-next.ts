// A post-login destination must stay on this site. Parsing against a dummy
// origin catches every trick browsers normalise into another host
// (`//x`, `/\x`, `/<tab>/x`); only the path, query and hash survive. The
// parsed path is checked too: dot-segments — even percent-encoded ones like
// `/a/%2e%2e//x` — can collapse it to `//x`, which a browser reads as a host.
const BASE = "https://gituas.invalid";

export function safeNext(next: string | string[] | undefined | null, fallback: string): string {
  const n = Array.isArray(next) ? next[0] : next;
  if (!n || !n.startsWith("/") || n.includes("..")) return fallback;
  try {
    const u = new URL(n, BASE);
    if (u.origin !== BASE || u.pathname.startsWith("//")) return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}
