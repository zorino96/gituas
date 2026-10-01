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
  // for the one function that renders cards: the background news tick.
  outputFileTracingIncludes: {
    "/api/cron/news": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
};

export default nextConfig;
