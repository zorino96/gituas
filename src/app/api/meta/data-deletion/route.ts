// Meta Data Deletion Request callback (required for App Review).
// Meta POSTs a signed_request form field; we verify the HMAC-SHA256 signature,
// delete the requester's stored Meta credentials, and answer with a status URL
// + confirmation code.
// Spec: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
//
// Identifying the requester: signed_request carries an app-scoped USER id.
// That matches providerAccountId for META_INSTAGRAM (we store the IG user id),
// but NOT for META_FACEBOOK — there providerAccountId is the PAGE id, because
// /me on a page token resolves to the page. So we find the tenant via the
// Instagram credential and then clear every Meta credential that tenant holds:
// if someone asks Meta to erase them from this app, leaving their Page token
// behind is not a defensible reading of the request.
//
// The gap that remains: a tenant with ONLY a Facebook Page connected cannot be
// identified from user_id at all. Meta still requires a 200 with a
// confirmation code, so that case would look successful while deleting
// nothing -- exactly the silent failure this callback must not have. It is
// logged loudly below instead of being swallowed. Closing it for real needs
// the granting user's id stored at connect time (a nullable column), which is
// a schema change and therefore a separate, deliberate deployment.
//
// The same URL can be set as the deletion callback of the Instagram, Facebook Login and WhatsApp
// apps: the signature is checked against each app's secret. With a credential, the comments and
// messages stored from that account are deleted too, and the store forgets the account.

import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { forgetStoredMessages } from "@/lib/shop/forget";

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
  const secrets = [process.env.INSTAGRAM_APP_SECRET, process.env.FACEBOOK_APP_SECRET, process.env.WHATSAPP_APP_SECRET]
    .map((x) => x?.trim())
    .filter((x): x is string => !!x);
  if (!secrets.length) return NextResponse.json({ error: "misconfigured" }, { status: 500 });
  const got = b64url(sigPart);
  const signedBy = (secret: string) => {
    const expected = createHmac("sha256", secret).update(payloadPart).digest();
    return expected.length === got.length && timingSafeEqual(expected, got);
  };
  if (!secrets.some(signedBy)) {
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

  // user_id identifies an Instagram credential; the tenant behind it owns any
  // Facebook Page credentials that came from the same person.
  const matched = await db.oAuthCredential.findMany({
    where: { provider: "META_INSTAGRAM", providerAccountId: userId },
    select: { tenantId: true },
  });
  const tenantIds = [...new Set(matched.map((c) => c.tenantId))];

  if (tenantIds.length === 0) {
    // Nothing matched, so there is no tenant to hang an AuditLog row on --
    // its tenantId is a foreign key. Log loudly instead: Meta still requires a
    // 200 here, and a confirmation code that quietly means "we did nothing" is
    // the one outcome this endpoint must never produce unnoticed.
    console.error(
      `[data-deletion] UNMATCHED request. user_id=${userId} code=${code}. ` +
        `No stored credential has this id. If this person connected only a ` +
        `Facebook Page, we cannot identify them from user_id -- their Page ` +
        `token is still stored and needs manual removal.`,
    );
  }

  for (const tenantId of tenantIds) {
    const creds = await db.oAuthCredential.findMany({
      where: { tenantId, provider: { in: ["META_INSTAGRAM", "META_FACEBOOK"] } },
      select: { id: true, provider: true, providerAccountId: true },
    });
    await db.oAuthCredential.deleteMany({
      where: { id: { in: creds.map((c) => c.id) } },
    });
    let messages = 0;
    for (const c of creds) {
      const platform = c.provider as "META_INSTAGRAM" | "META_FACEBOOK";
      messages += await forgetStoredMessages(tenantId, platform, c.providerAccountId);
      if (platform === "META_FACEBOOK") await db.store.updateMany({ where: { tenantId, fbPageId: c.providerAccountId }, data: { fbPageId: null } });
      else await db.store.updateMany({ where: { tenantId, igUserId: c.providerAccountId }, data: { igUserId: null, igUsername: null } });
    }
    await db.auditLog.create({
      data: {
        tenantId,
        actor: "SYSTEM",
        action: "integrations.data_deletion",
        reasoning:
          `Meta data-deletion request for user ${userId}; removed ${creds.length} ` +
          `stored Meta credential(s): ${creds.map((c) => c.provider).join(", ") || "none"}, ` +
          `and ${messages} stored comment(s) and message(s).`,
        metadata: {
          confirmationCode: code,
          providers: creds.map((c) => c.provider),
          messages,
        },
      },
    });
  }

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://gituas.vercel.app";
  return NextResponse.json({
    url: `${base}/data-deletion?code=${code}`,
    confirmation_code: code,
  });
}
