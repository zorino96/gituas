import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { waLink } from "@/lib/merchant/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The WhatsApp handoff link a merchant sends to buyers: `/w/<workspace>?t=<text>`.
 *
 * It exists to be counted — a raw wa.me link cannot tell us how many buyers
 * actually moved to WhatsApp, and that number is the evidence behind any future
 * WhatsApp Business API application. It only ever redirects to wa.me.
 */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await ctx.params;
  const tenant = await db.tenant.findUnique({ where: { slug }, select: { id: true, whatsappNumber: true } });
  if (!tenant?.whatsappNumber) {
    return new NextResponse("This shop has not set a WhatsApp number yet.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const text = new URL(req.url).searchParams.get("t")?.slice(0, 500) || undefined;
  // One counted tap per visitor per hour, so reloading or scripting the link cannot inflate the
  // count or fill the log. The visitor is a hash of their address, never the address itself.
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const visitor = createHash("sha256").update(`${tenant.id}:${ip}`).digest("hex").slice(0, 16);
  const seen = await db.auditLog.count({
    where: { tenantId: tenant.id, action: "wa.tap", createdAt: { gt: new Date(Date.now() - 3_600_000) }, metadata: { path: ["v"], equals: visitor } },
  });
  if (!seen) {
    await db.auditLog.create({
      data: { tenantId: tenant.id, actor: "SYSTEM", action: "wa.tap", reasoning: "A buyer opened the WhatsApp link.", metadata: { v: visitor } },
    });
  }
  return NextResponse.redirect(waLink(tenant.whatsappNumber, text), 302);
}
