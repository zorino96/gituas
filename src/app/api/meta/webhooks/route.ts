// Meta / Instagram webhooks — ingest inbound comments & DMs so the reply-agent
// has real ConversationMessage rows to act on.
//
//   GET  — subscription verification handshake (hub.challenge)
//   POST — event delivery; we verify the X-Hub-Signature-256 HMAC, then map the
//          IG business account to a project and upsert INBOUND messages.
//
// Configure in the App Dashboard → Instagram → Webhooks with verify token
// META_WEBHOOK_VERIFY_TOKEN, subscribing to the `comments` and `messages` fields.
// Docs: https://developers.facebook.com/docs/instagram-platform/webhooks/

import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---- GET: verification handshake ------------------------------------------

export function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

// ---- POST: event delivery -------------------------------------------------

function signatureValid(raw: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const secret = process.env.INSTAGRAM_APP_SECRET ?? "";
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const got = header.slice("sha256=".length);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(got, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Resolve the project that owns a connected IG business account. */
async function projectForIgAccount(igAccountId: string): Promise<string | null> {
  const cred = await db.oAuthCredential.findFirst({
    where: { provider: "META_INSTAGRAM", providerAccountId: igAccountId },
    select: { tenantId: true },
  });
  if (!cred) return null;
  const project = await db.project.findFirst({
    where: { tenantId: cred.tenantId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return project?.id ?? null;
}

/** Idempotently store an inbound comment/DM. */
async function ingest(input: {
  projectId: string;
  channelType: "DM" | "COMMENT";
  externalMessageId: string;
  externalThreadId?: string;
  authorHandle?: string;
  content: string;
}) {
  const existing = await db.conversationMessage.findFirst({
    where: { projectId: input.projectId, externalMessageId: input.externalMessageId },
    select: { id: true },
  });
  if (existing) return;
  await db.conversationMessage.create({
    data: {
      projectId: input.projectId,
      platform: "META_INSTAGRAM",
      channelType: input.channelType,
      direction: "INBOUND",
      status: "RECEIVED",
      externalMessageId: input.externalMessageId,
      externalThreadId: input.externalThreadId ?? null,
      authorHandle: input.authorHandle ?? null,
      content: input.content,
    },
  });
}

interface IgEntry {
  id?: string;
  changes?: { field?: string; value?: Record<string, unknown> }[];
  messaging?: {
    sender?: { id?: string };
    message?: { mid?: string; text?: string; is_echo?: boolean };
  }[];
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!signatureValid(raw, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let body: { entry?: IgEntry[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  for (const entry of body.entry ?? []) {
    const projectId = entry.id ? await projectForIgAccount(entry.id) : null;
    if (!projectId) continue;

    // Comment events
    for (const change of entry.changes ?? []) {
      if (change.field !== "comments" || !change.value) continue;
      const v = change.value as {
        id?: string;
        text?: string;
        media?: { id?: string };
        from?: { id?: string; username?: string };
      };
      if (!v.id) continue;
      await ingest({
        projectId,
        channelType: "COMMENT",
        externalMessageId: v.id,
        externalThreadId: v.media?.id,
        authorHandle: v.from?.username ?? v.from?.id,
        content: v.text ?? "",
      });
    }

    // Direct-message events (skip our own echoes)
    for (const m of entry.messaging ?? []) {
      const msg = m.message;
      if (!msg?.mid || msg.is_echo || !m.sender?.id) continue;
      await ingest({
        projectId,
        channelType: "DM",
        externalMessageId: msg.mid,
        externalThreadId: m.sender.id,
        authorHandle: m.sender.id,
        content: msg.text ?? "",
      });
    }
  }

  // Always 200 quickly so Meta doesn't retry/back off.
  return NextResponse.json({ received: true });
}
