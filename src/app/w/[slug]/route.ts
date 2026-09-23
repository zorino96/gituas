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
  await db.auditLog.create({
    data: { tenantId: tenant.id, actor: "SYSTEM", action: "wa.tap", reasoning: "A buyer opened the WhatsApp link.", metadata: {} },
  });
  return NextResponse.redirect(waLink(tenant.whatsappNumber, text), 302);
}
