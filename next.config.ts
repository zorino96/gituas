import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  // The server-side card renderer (src/lib/cards/server-render.ts): both are loaded from
  // node_modules at run time, never bundled. @sparticuz/chromium finds its packed browser
  // next to its own files.
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
  // That packed browser (bin/*.br) is read from disk, not imported, so it is named here
  // for the one function that renders cards: the background news tick, whose autopilot
  // (src/lib/news/autopilot.ts) is the renderer's only caller. Pages and server actions
  // import src/lib/news/autopilot-settings.ts instead, which has no renderer in it. A new
  // route that imports the autopilot or the renderer must be added here.
  // The website's pages say which language they are in with a header too (Bing reads it; the document element
  // belongs to the one root layout). Files and API routes are not touched.
  async headers() {
    return [
      { source: "/en/:path*", headers: [{ key: "Content-Language", value: "en" }] },
      { source: "/ku/:path*", headers: [{ key: "Content-Language", value: "ckb" }] },
      { source: "/ar/:path*", headers: [{ key: "Content-Language", value: "ar" }] },
    ];
  },
  outputFileTracingIncludes: {
    "/api/cron/news": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/cron/card-check": ["./node_modules/@sparticuz/chromium/bin/**"],
    // The desk's chat makes a story's card when the person confirms it: that request renders in headless Chromium too.
    "/api/chat/runs/[id]": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
