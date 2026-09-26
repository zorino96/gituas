import { XMLParser } from "fast-xml-parser";

import type { RawItem } from "../types";
import { guessLang, stripHtml } from "../text";

const SNIPPET_MAX = 500;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  isArray: (name) => name === "item" || name === "entry" || name === "link",
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

/** Fetch and parse one feed. Throws when the URL does not answer with a feed. */
export async function fetchFeed(url: string, sourceName: string): Promise<RawItem[]> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "GituasNewsDesk/1.0 (+https://gituas.vercel.app)",
      Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.text();
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(body)) throw new Error("not an RSS or Atom feed");
  return parseFeed(body, sourceName);
}
