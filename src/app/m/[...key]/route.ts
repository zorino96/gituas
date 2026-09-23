import { head } from "@vercel/blob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Serves merchant media from our own domain.
 *
 * TikTok's Direct Post pulls the video from a URL, and only from a URL prefix
 * verified in the TikTok portal — `https://gituas.vercel.app/`. Files live in
 * Vercel Blob on another host, so TikTok is given `/m/<blob path>` and this
 * route streams the bytes through. Only paths under `merchant/` are served;
 * anything else is a 404, so the route cannot be used to read other blobs.
 * Range requests are forwarded, because video fetchers use them.
 */
export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }): Promise<Response> {
  const { key } = await ctx.params;
  const pathname = key.map(decodeURIComponent).join("/");
  if (!pathname.startsWith("merchant/") || pathname.includes("..")) {
    return new Response("Not found", { status: 404 });
  }

  let url: string;
  try {
    url = (await head(pathname)).url;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const range = req.headers.get("range");
  const upstream = await fetch(url, { headers: range ? { range } : {} });
  if (!upstream.ok && upstream.status !== 206) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "public, max-age=3600");
  return new Response(upstream.body, { status: upstream.status, headers });
}

export async function HEAD(req: Request, ctx: { params: Promise<{ key: string[] }> }): Promise<Response> {
  const res = await GET(req, ctx);
  return new Response(null, { status: res.status, headers: res.headers });
}
