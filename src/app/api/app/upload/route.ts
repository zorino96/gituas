import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

import { currentWorkspace } from "@/app/app/data";
import { takeDaily } from "@/lib/ai/slots";
import { limitsOf } from "@/lib/shop/tenant-plans";
import { SHOP_LIMITS } from "@/lib/shop/plans";
import { db } from "@/lib/db";
import { REF_LIMITS, refKind, refStoreOf } from "@/lib/advideo/ref-paths";
import { can } from "@/lib/newsroom/roles";

export const runtime = "nodejs";

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"];
const MAX_BYTES = 250 * 1024 * 1024;
/** What a workspace that pays nothing may put on our storage: fewer, smaller files (it only needs them for its own posts). */
const FREE_MAX_BYTES = 40 * 1024 * 1024;
const FILES_PER_DAY = { free: 20, paid: 100, unlimited: 2000 };

/** A newsroom desk with a plan that is running (not a trial, not frozen). */
async function newsDeskPays(tenantId: string): Promise<boolean> {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { planPaidUntil: true } });
  return !!t?.planPaidUntil && t.planPaidUntil.getTime() > Date.now();
}

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
        // Storage is not free and nothing deletes a file: a count a day and a size by plan, for every kind of upload.
        const shopAi = ws.kind === "MERCHANT" ? (await limitsOf(ws.id)).aiUsd : 0;
        const paid = ws.kind === "MERCHANT" ? shopAi > SHOP_LIMITS.FREE.aiUsd : await newsDeskPays(ws.id);
        // A workspace with a test code (its shops are UNLIMITED) has a far higher number of files a day.
        const cap = shopAi >= SHOP_LIMITS.UNLIMITED.aiUsd ? FILES_PER_DAY.unlimited : paid ? FILES_PER_DAY.paid : FILES_PER_DAY.free;
        const today = await takeDaily(ws.id, "upload_day", 1, cap);
        if (today < 1) throw new Error("Too many uploads today");
        // Reference pictures and clips for AI video ads end up inside ads that may be posted by themselves: only people who
        // can publish may add them, only to a store of this workspace, and each kind has its own types and size.
        if (pathname.startsWith(`merchant/${ws.id}/advideo-ref/`)) {
          const storeId = refStoreOf(pathname, ws.id);
          const kind = refKind(pathname);
          if (!storeId || !kind) throw new Error("Invalid path");
          if (!can(ws.role, "publish")) throw new Error("Not allowed");
          const store = await db.store.findFirst({ where: { id: storeId, tenantId: ws.id }, select: { id: true } });
          if (!store) throw new Error("Invalid path");
          return {
            allowedContentTypes: kind === "image" ? ["image/jpeg", "image/png", "image/webp"] : ["video/mp4", "video/quicktime"],
            maximumSizeInBytes: kind === "image" ? REF_LIMITS.imageBytes : REF_LIMITS.videoBytes,
            addRandomSuffix: true,
            tokenPayload: JSON.stringify({ tenantId: ws.id }),
          };
        }
        return {
          allowedContentTypes: ALLOWED,
          maximumSizeInBytes: paid ? MAX_BYTES : FREE_MAX_BYTES,
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
