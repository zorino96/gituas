import { headers } from "next/headers";

import { HAWALNOOS_LLMS, llmsTxt } from "@/lib/site/llms";

export const dynamic = "force-dynamic";

export async function GET() {
  const host = ((await headers()).get("host") ?? "").toLowerCase().split(":")[0];
  const body = host.endsWith("hawalnoos.com") ? HAWALNOOS_LLMS : llmsTxt();
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600, s-maxage=3600" } });
}
