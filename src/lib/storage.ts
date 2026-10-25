// Our file storage: Cloudflare R2 through its S3 API (bucket R2_BUCKET), served publicly from MEDIA_HOST.
// The same calls as the Vercel Blob SDK it replaced (put, head, list, del), so callers did not change.

import { AwsClient } from "aws4fetch";

import { MEDIA_HOST } from "./storage-host";

export { MEDIA_HOST, isStorageHost } from "./storage-host";

let client: AwsClient | null = null;

function s3(): AwsClient {
  if (client) return client;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey || !process.env.R2_ACCOUNT_ID) throw new Error("Storage is not configured (R2_*)");
  client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
  return client;
}

const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");
const bucketUrl = () => `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${process.env.R2_BUCKET || "gituas-media"}`;
const objectUrl = (pathname: string) => `${bucketUrl()}/${encodePath(pathname)}`;

/** The public address of a stored file. */
export const publicUrl = (pathname: string) => `https://${MEDIA_HOST}/${encodePath(pathname)}`;

/** The pathname of one of our files, from its pathname or its R2 address. An old Vercel Blob address gives null. */
function pathOf(urlOrPath: string): string | null {
  if (!/^https?:\/\//i.test(urlOrPath)) return urlOrPath;
  try {
    const u = new URL(urlOrPath);
    return u.hostname === MEDIA_HOST ? decodeURIComponent(u.pathname.slice(1)) : null;
  } catch {
    return null;
  }
}

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** 30 random letters and digits, put before the extension so a name cannot be guessed (what Blob's addRandomSuffix did). */
export function withRandomSuffix(pathname: string): string {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(30)), (b) => ALNUM[b % 62]).join("");
  const dot = pathname.lastIndexOf(".");
  return dot > pathname.lastIndexOf("/") ? `${pathname.slice(0, dot)}-${rand}${pathname.slice(dot)}` : `${pathname}-${rand}`;
}

export interface PutOptions {
  access?: "public";
  contentType?: string;
  addRandomSuffix?: boolean;
  /** Without it a file that already exists is never replaced (the put fails), as with Blob. */
  allowOverwrite?: boolean;
  abortSignal?: AbortSignal;
  cacheControlMaxAge?: number;
}

export async function put(pathname: string, body: string | Uint8Array | ArrayBuffer | Blob, o: PutOptions = {}): Promise<{ url: string; pathname: string }> {
  const key = o.addRandomSuffix ? withRandomSuffix(pathname) : pathname;
  // A file that can be replaced is cached briefly, so the new one is seen; any other never changes.
  const headers: Record<string, string> = { "cache-control": `public, max-age=${o.cacheControlMaxAge ?? (o.allowOverwrite ? 60 : 31536000)}` };
  if (o.contentType) headers["content-type"] = o.contentType;
  if (!o.allowOverwrite) headers["if-none-match"] = "*";
  // Plain bytes with their length: R2 refuses a body without one (411), and a body wrapped in a Request (as aws4fetch's
  // own fetch does) goes out as a stream with none on Vercel.
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : new Uint8Array(body);
  headers["content-length"] = String(bytes.byteLength);
  const signed = await s3().sign(objectUrl(key), { method: "PUT", body: bytes, headers });
  const r = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: bytes, signal: o.abortSignal });
  if (!r.ok) throw new Error(r.status === 412 ? `Storage: ${key} already exists` : `Storage: upload failed (${r.status})`);
  return { url: publicUrl(key), pathname: key };
}

/** Throws when the file does not exist. */
export async function head(urlOrPath: string): Promise<{ url: string; pathname: string; size: number; uploadedAt: Date; contentType: string }> {
  const key = pathOf(urlOrPath);
  if (!key) throw new Error("Storage: not found");
  const r = await s3().fetch(objectUrl(key), { method: "HEAD" });
  if (!r.ok) throw new Error(`Storage: not found (${r.status})`);
  return {
    url: publicUrl(key),
    pathname: key,
    size: Number(r.headers.get("content-length") ?? 0),
    uploadedAt: new Date(r.headers.get("last-modified") ?? 0),
    contentType: r.headers.get("content-type") ?? "",
  };
}

const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? "";

export async function list(o: { prefix?: string; limit?: number; cursor?: string } = {}) {
  const q = new URLSearchParams({ "list-type": "2", "max-keys": String(o.limit ?? 1000) });
  if (o.prefix) q.set("prefix", o.prefix);
  if (o.cursor) q.set("continuation-token", o.cursor);
  const r = await s3().fetch(`${bucketUrl()}?${q}`);
  if (!r.ok) throw new Error(`Storage: list failed (${r.status})`);
  const xml = await r.text();
  const blobs = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(([, c]) => {
    const pathname = unxml(tag(c, "Key"));
    return { pathname, url: publicUrl(pathname), size: Number(tag(c, "Size")), uploadedAt: new Date(tag(c, "LastModified")) };
  });
  const hasMore = tag(xml, "IsTruncated") === "true";
  return { blobs, hasMore, cursor: hasMore ? unxml(tag(xml, "NextContinuationToken")) : undefined };
}

/** Deletes files by pathname or address. ponytail: an old Vercel Blob address is skipped (that store is read-only now); fine until it is gone. */
export async function del(target: string | string[]): Promise<void> {
  const keys = (Array.isArray(target) ? target : [target]).map(pathOf).filter((k): k is string => !!k);
  await Promise.all(
    keys.map(async (k) => {
      const r = await s3().fetch(objectUrl(k), { method: "DELETE" });
      if (!r.ok && r.status !== 404) throw new Error(`Storage: delete failed (${r.status})`);
    }),
  );
}

/**
 * An address that lets whoever holds it upload exactly one file to this pathname, with this type (and this size, when
 * given: the browser must then send exactly that many bytes), until it expires. Used by the browser and the render workers.
 */
export async function presignPut(pathname: string, contentType: string, o: { size?: number; expiresSec?: number } = {}): Promise<string> {
  const headers: Record<string, string> = { "content-type": contentType };
  if (o.size !== undefined) headers["content-length"] = String(o.size);
  const u = new URL(objectUrl(pathname));
  u.searchParams.set("X-Amz-Expires", String(o.expiresSec ?? 900));
  const signed = await s3().sign(u.toString(), { method: "PUT", headers, aws: { signQuery: true, allHeaders: true } });
  return signed.url;
}
