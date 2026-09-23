import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

import { currentWorkspace } from "@/app/app/data";

export const runtime = "nodejs";

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"];
const MAX_BYTES = 250 * 1024 * 1024;

/**
 * Issues short-lived tokens so the browser can upload straight to Vercel Blob.
 * Media never passes through this function — Vercel caps function request
 * bodies at 4.5 MB, far below a product video. The token only allows paths
 * under this workspace's own folder, and only image and video types.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let body: HandleUploadBody;
  try {
    body = (await req.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        const ws = await currentWorkspace();
        if (!ws) throw new Error("Not signed in");
        if (!pathname.startsWith(`merchant/${ws.id}/`) || pathname.includes("..")) throw new Error("Invalid path");
        return {
          allowedContentTypes: ALLOWED,
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ tenantId: ws.id }),
        };
      },
      onUploadCompleted: async () => {
        // Nothing to record: the composer holds the URL until the post is published.
      },
    });
    return NextResponse.json(json);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Upload refused" }, { status: 400 });
  }
}
