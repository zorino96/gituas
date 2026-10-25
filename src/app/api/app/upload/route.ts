import { NextResponse } from "next/server";

import { currentWorkspace } from "@/app/app/data";
import { takeDaily } from "@/lib/ai/slots";
import { limitsOf } from "@/lib/shop/tenant-plans";
import { SHOP_LIMITS } from "@/lib/shop/plans";
import { db } from "@/lib/db";
import { REF_LIMITS, refKind, refStoreOf } from "@/lib/advideo/ref-paths";
import { can } from "@/lib/newsroom/roles";
import { presignPut, publicUrl, withRandomSuffix } from "@/lib/storage";

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

/** The types and size one upload to this path may have, after the checks of who may upload it (counted against the day). */
async function ruleFor(pathname: string): Promise<{ types: string[]; max: number }> {
  const ws = await currentWorkspace();
  if (!ws) throw new Error("Not signed in");
  if (!pathname.startsWith(`merchant/${ws.id}/`) || /\.\.|%|\\|\/\//.test(pathname)) throw new Error("Invalid path");
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
    return kind === "image"
      ? { types: ["image/jpeg", "image/png", "image/webp"], max: REF_LIMITS.imageBytes }
      : { types: ["video/mp4", "video/quicktime"], max: REF_LIMITS.videoBytes };
  }
  return { types: ALLOWED, max: paid ? MAX_BYTES : FREE_MAX_BYTES };
}

/**
 * Answers with a short-lived address that uploads one file straight from the browser to our storage (R2).
 * Media never passes through this function — Vercel caps function request bodies at 4.5 MB, far below a
 * product video. The address writes one new path (a random suffix is added) under this workspace's own
 * folder, with the type and the exact size checked here.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let body: { pathname?: unknown; contentType?: unknown; size?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const pathname = typeof body.pathname === "string" ? body.pathname : "";
    const contentType = typeof body.contentType === "string" ? body.contentType : "";
    const size = typeof body.size === "number" && Number.isInteger(body.size) && body.size > 0 ? body.size : 0;
    if (!pathname || !size) throw new Error("Invalid request");
    const rule = await ruleFor(pathname);
    if (!rule.types.includes(contentType)) throw new Error("File type not allowed");
    if (size > rule.max) throw new Error("File too large");
    const key = withRandomSuffix(pathname);
    const uploadUrl = await presignPut(key, contentType, { size, expiresSec: 3600 });
    return NextResponse.json({ uploadUrl, url: publicUrl(key), pathname: key });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Upload refused" }, { status: 400 });
  }
}
