import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { confirmInvoice } from "@/lib/billing/invoices";
import { signatureValid } from "@/lib/billing/wayl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Wayl calls this when a link's status changes. The payload only tells us which
 * invoice to look at: confirmInvoice() asks Wayl's API itself before anything is
 * marked paid, so a forged call can at most trigger a harmless re-check.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  let ref: string | null = null;
  try {
    const j = JSON.parse(raw) as { referenceId?: unknown; data?: { referenceId?: unknown } };
    ref = typeof j.referenceId === "string" ? j.referenceId : typeof j.data?.referenceId === "string" ? j.data.referenceId : null;
  } catch {
    /* not JSON */
  }
  if (!ref) return NextResponse.json({ error: "bad payload" }, { status: 400 });
  const inv = await db.invoice.findUnique({ where: { id: ref }, select: { id: true, webhookSecret: true } });
  if (!inv) return NextResponse.json({ ok: true }); // not ours; don't make Wayl retry
  const sig = req.headers.get("x-wayl-signature-256");
  if (sig && !signatureValid(raw, sig, inv.webhookSecret)) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  const result = await confirmInvoice(inv.id);
  return NextResponse.json({ ok: true, result });
}
