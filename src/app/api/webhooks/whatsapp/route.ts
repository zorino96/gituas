// WhatsApp Cloud API webhooks for the shop (the Gituas Chat Meta app).
//
//   GET  — subscription handshake: hub.verify_token must equal WA_VERIFY_TOKEN.
//   POST — X-Hub-Signature-256 HMAC with WHATSAPP_APP_SECRET; each buyer message
//          is stored once and handed to the shop pipeline, and a reply the
//          merchant sent from the WhatsApp Business app pauses that thread.
//
// Configure in the Gituas Chat app → WhatsApp → Configuration, field `messages`
// (and `smb_message_echoes` for numbers that stay on the WhatsApp Business app).

import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { pauseThread } from "@/lib/shop/pause";
import { processMessage } from "@/lib/shop/pipeline";
import { WA_VERIFY_TOKEN } from "@/lib/whatsapp/cloud";
import { parseWaPayload, type WaEvent } from "@/lib/whatsapp/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === WA_VERIFY_TOKEN) {
    return new NextResponse(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

function signatureValid(raw: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const got = Buffer.from(header.slice("sha256=".length), "hex");
  const expected = Buffer.from(createHmac("sha256", secret).update(raw).digest("hex"), "hex");
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** Store a buyer message once; Meta redelivers, and the unique key makes the second copy a no-op. */
async function ingest(storeId: string, ev: Extract<WaEvent, { kind: "message" }>): Promise<string | null> {
  try {
    const row = await db.conversationMessage.create({
      data: {
        storeId,
        platform: "WHATSAPP",
        channelType: "DM",
        direction: "INBOUND",
        status: "RECEIVED",
        content: ev.text,
        externalMessageId: ev.messageId,
        externalThreadId: ev.from,
        authorId: ev.from,
        authorHandle: ev.from,
        authorName: ev.name,
      },
      select: { id: true },
    });
    return row.id;
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return null;
    throw e;
  }
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!signatureValid(raw, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const stores = new Map<string, { id: string; tenantId: string } | null>();
  for (const ev of parseWaPayload(body)) {
    if (!stores.has(ev.phoneNumberId)) {
      stores.set(ev.phoneNumberId, await db.store.findFirst({ where: { waPhoneNumberId: ev.phoneNumberId }, select: { id: true, tenantId: true } }));
    }
    const store = stores.get(ev.phoneNumberId);
    if (!store) continue;
    if (ev.kind === "echo") {
      await pauseThread(store.tenantId, "WHATSAPP", ev.to);
      continue;
    }
    const id = await ingest(store.id, ev);
    if (id) {
      after(() => processMessage(id).catch((e) => console.error("[shop] whatsapp processing failed:", e instanceof Error ? e.message : "unknown error")));
    }
  }
  // Always 200 quickly so Meta doesn't retry/back off.
  return NextResponse.json({ received: true });
}
