// Meta Data Deletion Request callback (required for App Review).
// Meta POSTs a signed_request form field; we verify the HMAC-SHA256 signature,
// delete any stored Instagram credentials for that user, and answer with a
// status URL + confirmation code.
// Spec: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback

import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function b64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const signed = form?.get("signed_request");
  if (typeof signed !== "string" || !signed.includes(".")) {
    return NextResponse.json({ error: "missing signed_request" }, { status: 400 });
  }

  const [sigPart, payloadPart] = signed.split(".", 2);
  const secret = process.env.INSTAGRAM_APP_SECRET ?? "";
  const expected = createHmac("sha256", secret).update(payloadPart).digest();
  const got = b64url(sigPart);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  let payload: { user_id?: string | number } = {};
  try {
    payload = JSON.parse(b64url(payloadPart).toString("utf8"));
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }
  const userId = payload.user_id != null ? String(payload.user_id) : "unknown";
  const code = `igdel_${Date.now().toString(36)}_${userId.slice(-6)}`;

  const creds = await db.oAuthCredential.findMany({
    where: { provider: "META_INSTAGRAM", providerAccountId: userId },
  });
  for (const c of creds) {
    await db.oAuthCredential.delete({ where: { id: c.id } });
    await db.auditLog.create({
      data: {
        tenantId: c.tenantId,
        actor: "SYSTEM",
        action: "integrations.data_deletion",
        reasoning: `Instagram data-deletion request for user ${userId}; stored tokens removed.`,
        metadata: { confirmationCode: code, provider: "META_INSTAGRAM" },
      },
    });
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://gituas.vercel.app";
  return NextResponse.json({
    url: `${base}/data-deletion?code=${code}`,
    confirmation_code: code,
  });
}
