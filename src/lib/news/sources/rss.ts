import { XMLParser } from "fast-xml-parser";
import { lookup } from "node:dns/promises";

import type { RawItem } from "../types";
import { guessLang, stripHtml } from "../text";

const SNIPPET_MAX = 500;
const MAX_REDIRECTS = 3;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  isArray: (name) => name === "item" || name === "entry" || name === "link",
  parseTagValue: false,
});

function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) return text((v as Record<string, unknown>)["#text"]);
  return "";
}

function first(v: unknown): unknown {
  return Array.isArray(v) ? v[0] : v;
}

function parseDate(s: string, now: Date): Date {
  const t = Date.parse(s);
  // A missing or future date sorts as "now" instead of jumping the queue.
  return Number.isFinite(t) && t <= now.getTime() ? new Date(t) : now;
}

/** RSS 2.0, RSS 1.0 (RDF) and Atom. Anything else, or broken XML, gives no items. */
export function parseFeed(xml: string, sourceName: string, now = new Date()): RawItem[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch {
    return [];
  }
  const out: RawItem[] = [];
  const push = (url: string, title: string, snippet: string, date: string) => {
    const u = url.trim();
    const t = stripHtml(title);
    if (!/^https?:\/\//i.test(u) || !t) return;
    const s = stripHtml(snippet).slice(0, SNIPPET_MAX);
    out.push({ url: u, title: t, snippet: s, publishedAt: parseDate(date, now), lang: guessLang(`${t} ${s}`), sourceName });
  };

  for (const it of doc?.rss?.channel?.item ?? doc?.["rdf:RDF"]?.item ?? []) {
    push(text(first(it.link)) || text(it.guid), text(it.title), text(it.description), text(it.pubDate) || text(it["dc:date"]));
  }
  for (const e of doc?.feed?.entry ?? []) {
    const links: Record<string, unknown>[] = Array.isArray(e.link) ? e.link : [];
    const alt = links.find((l) => !l["@rel"] || l["@rel"] === "alternate") ?? links[0];
    push(text(alt?.["@href"]), text(e.title), text(e.summary) || text(e.content), text(e.published) || text(e.updated));
  }
  return out;
}

function charsetFromContentType(contentType: string | null): string | null {
  const m = contentType?.match(/charset=([^;]+)/i);
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

/** The XML prolog is always ASCII-safe even when the document body isn't, so a byte-preserving decode is safe to sniff it. */
function charsetFromXmlProlog(buf: ArrayBuffer): string | null {
  const head = new TextDecoder("iso-8859-1").decode(buf.slice(0, 200));
  const m = head.match(/<\?xml[^>]*\sencoding=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

/** Falls back to utf-8 when the label is missing or not one TextDecoder knows. */
function decodeBody(buf: ArrayBuffer, label: string | null): string {
  try {
    return new TextDecoder(label || "utf-8").decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

/**
 * True for an address in a private, loopback, link-local, carrier-grade-NAT
 * or unspecified range: IPv4 0.0.0.0/8, 10/8, 127/8, 169.254/16, 172.16/12,
 * 192.168/16, 100.64/10, and their IPv6 counterparts (::1, ::, fc00::/7,
 * fe80::/10), including an IPv4-mapped IPv6 address of one of those.
 */
export function isPrivateAddress(ip: string): boolean {
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isPrivateAddress(mapped[1]);

  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    const firstGroup = lower.startsWith("::") ? "0" : lower.split(":")[0];
    const val = parseInt(firstGroup, 16);
    if (Number.isNaN(val)) return false;
    if (val >= 0xfc00 && val <= 0xfdff) return true; // fc00::/7 (unique local)
    if (val >= 0xfe80 && val <= 0xfebf) return true; // fe80::/10 (link-local)
    return false;
  }

  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // 127/8
  if (a === 169 && b === 254) return true; // 169.254/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 (CGNAT)
  return false;
}

/** Refuses `localhost` outright, and any host that resolves to a private address. */
async function assertPublicHost(hostname: string): Promise<void> {
  if (hostname.toLowerCase() === "localhost") throw new Error("Refused: private address");
  const records = await lookup(hostname, { all: true });
  if (records.some((r) => isPrivateAddress(r.address))) throw new Error("Refused: private address");
}

/**
 * Fetch and parse one feed. Throws when the URL does not answer with a feed.
 * Refuses http(s) hosts and redirect targets that resolve to a private
 * network address, following at most MAX_REDIRECTS redirects itself so each
 * hop can be checked before it is requested.
 */
export async function fetchFeed(url: string, sourceName: string): Promise<RawItem[]> {
  let current = new URL(url);
  for (let hop = 0; ; hop++) {
    if (current.protocol !== "http:" && current.protocol !== "https:") throw new Error("Refused: unsupported protocol");
    await assertPublicHost(current.hostname);

    const res = await fetch(current, {
      headers: {
        "User-Agent": "HawalnoosNewsDesk/1.0 (+https://hawalnoos.com)",
        Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });

    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= MAX_REDIRECTS) throw new Error("Too many redirects");
      current = new URL(location, current);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const charset = charsetFromContentType(res.headers.get("content-type")) ?? charsetFromXmlProlog(buf);
    const body = decodeBody(buf, charset);
    if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(body)) throw new Error("not an RSS or Atom feed");
    return parseFeed(body, sourceName);
  }
}
