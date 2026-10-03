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
  outputFileTracingIncludes: {
    "/api/cron/news": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/api/cron/card-check": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
