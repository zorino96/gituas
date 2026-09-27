// A post-login destination must stay on this site. Parsing against a dummy
// origin catches every trick browsers normalise into another host
// (`//x`, `/\x`, `/<tab>/x`); only the path, query and hash survive.
const BASE = "https://gituas.invalid";

export function safeNext(next: string | string[] | undefined, fallback: string): string {
  const n = Array.isArray(next) ? next[0] : next;
  if (!n || !n.startsWith("/") || n.includes("..")) return fallback;
  try {
    const u = new URL(n, BASE);
    return u.origin === BASE ? u.pathname + u.search + u.hash : fallback;
  } catch {
    return fallback;
  }
}
