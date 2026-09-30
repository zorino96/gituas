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
import { after, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { processMessage } from "@/lib/shop/pipeline";
import { parseEntry, type ShopEvent } from "@/lib/shop/webhook-parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Shop replies wait 8-30 s (human pace) inside after(); keep the whole run under Hobby's 60 s.
export const maxDuration = 60;

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
  const got = Buffer.from(header.slice("sha256=".length), "hex");
  // Instagram-Login and Facebook events may arrive on the same endpoint signed
  // with different app secrets; accept a match against either.
  const secrets = [process.env.INSTAGRAM_APP_SECRET, process.env.FACEBOOK_APP_SECRET].filter(Boolean) as string[];
  for (const secret of secrets) {
    const expected = Buffer.from(createHmac("sha256", secret).update(raw).digest("hex"), "hex");
    if (expected.length === got.length && timingSafeEqual(expected, got)) return true;
  }
  return false;
}

/** Resolve the project that owns a connected Meta (IG business / FB Page) account. */
async function projectForAccount(
  provider: "META_INSTAGRAM" | "META_FACEBOOK",
  accountId: string,
): Promise<string | null> {
  const cred = await db.oAuthCredential.findFirst({
    where: { provider, providerAccountId: accountId },
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
  platform: "META_INSTAGRAM" | "META_FACEBOOK";
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
      platform: input.platform,
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

/** The shop store behind a connected Page or Instagram account, if the account belongs to one. */
async function storeForAccount(platform: "META_INSTAGRAM" | "META_FACEBOOK", accountId: string) {
  return db.store.findFirst({ where: platform === "META_FACEBOOK" ? { fbPageId: accountId } : { igUserId: accountId }, select: { id: true } });
}

/** Store a shop event once; Meta redelivers, and the unique key makes the second copy a no-op. */
async function ingestShop(storeId: string, ev: ShopEvent): Promise<string | null> {
  const fields =
    ev.kind === "comment"
      ? { channelType: "COMMENT" as const, externalMessageId: ev.commentId, externalThreadId: ev.postId, authorId: ev.authorId, authorHandle: ev.authorName ?? ev.authorId, parentCommentId: ev.parentCommentId }
      : { channelType: "DM" as const, externalMessageId: ev.messageId, externalThreadId: ev.senderId, authorId: ev.senderId, authorHandle: ev.senderId, parentCommentId: null };
  try {
    const row = await db.conversationMessage.create({
      data: { storeId, platform: ev.platform, direction: "INBOUND", status: "RECEIVED", content: ev.text, ...fields },
      select: { id: true },
    });
    return row.id;
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return null;
    throw e;
  }
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

  let body: { object?: string; entry?: IgEntry[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  // `object` is "instagram" for Instagram-Login events, "page" for Facebook Page.
  const isPage = body.object === "page";
  const platform = isPage ? "META_FACEBOOK" : "META_INSTAGRAM";

  for (const entry of body.entry ?? []) {
    const store = entry.id ? await storeForAccount(platform, entry.id) : null;
    if (store) {
      for (const ev of parseEntry(body.object, entry)) {
        const id = await ingestShop(store.id, ev);
        if (id) {
          after(() =>
            processMessage(id, { delay: ev.kind === "comment" }).catch((e) =>
              console.error("[shop] processing failed:", e instanceof Error ? e.message : "unknown error"),
            ),
          );
        }
      }
      continue;
    }

    const projectId = entry.id ? await projectForAccount(platform, entry.id) : null;
    if (!projectId) continue;

    // Comment events. IG delivers field "comments"; Page delivers field "feed"
    // with item === "comment".
    for (const change of entry.changes ?? []) {
      const v = (change.value ?? {}) as {
        id?: string;
        comment_id?: string;
        item?: string;
        verb?: string;
        message?: string;
        text?: string;
        media?: { id?: string };
        post_id?: string;
        from?: { id?: string; name?: string; username?: string };
      };
      if (isPage) {
        if (change.field !== "feed" || v.item !== "comment" || v.verb === "remove") continue;
        const commentId = v.comment_id ?? v.id;
        if (!commentId) continue;
        await ingest({
          projectId,
          platform,
          channelType: "COMMENT",
          externalMessageId: commentId,
          externalThreadId: v.post_id,
          authorHandle: v.from?.name ?? v.from?.id,
          content: v.message ?? v.text ?? "",
        });
      } else {
        if (change.field !== "comments" || !v.id) continue;
        await ingest({
          projectId,
          platform,
          channelType: "COMMENT",
          externalMessageId: v.id,
          externalThreadId: v.media?.id,
          authorHandle: v.from?.username ?? v.from?.id,
          content: v.text ?? "",
        });
      }
    }

    // Direct-message / Messenger events (skip our own echoes).
    for (const m of entry.messaging ?? []) {
      const msg = m.message;
      if (!msg?.mid || msg.is_echo || !m.sender?.id) continue;
      await ingest({
        projectId,
        platform,
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
