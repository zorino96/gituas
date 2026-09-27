import type { Metadata, Viewport } from "next";
import Link from "next/link";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { hashInviteToken, inviteState } from "@/lib/newsroom/invite";
import { ROLE_LABEL } from "@/lib/newsroom/roles";
import { NewsroomRoot } from "../../desk-shell";
import { JoinButton, SwitchAccountButton } from "./join-client";

export const metadata: Metadata = { title: "بانگهێشت — گیتواس نیوزڕووم", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <NewsroomRoot>
      <div className="gm-auth">
        <p className="nr-brand kufi" style={{ padding: 0 }}>
          <span className="nr-live" aria-hidden="true" />
          گیتواس نیوزڕووم
        </p>
        <div className="gm-card gm-stack" style={{ marginTop: 18 }}>
          {children}
        </div>
      </div>
    </NewsroomRoot>
  );
}

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await db.invite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: { email: true, role: true, acceptedAt: true, expiresAt: true, tenant: { select: { name: true } } },
  });
  if (!invite) return <Frame><p style={{ margin: 0 }}>ئەم بانگهێشتە نەدۆزرایەوە یان هەڵوەشێنراوەتەوە.</p></Frame>;

  const state = inviteState(invite);
  if (state === "used") {
    return (
      <Frame>
        <p style={{ margin: 0 }}>ئەم بانگهێشتە پێشتر بەکارهاتووە.</p>
        <Link href="/newsroom/news" className="gm-btn block">بچۆ نیوزڕووم</Link>
      </Frame>
    );
  }
  if (state === "expired") {
    return <Frame><p style={{ margin: 0 }}>ئەم بانگهێشتە بەسەرچووە. داوای بانگهێشتێکی نوێ لە خاوەنی مێزەکە بکە.</p></Frame>;
  }

  const here = `/newsroom/join/${token}`;
  const intro = (
    <>
      <h1 className="gm-title kufi" style={{ margin: 0 }}>بانگهێشت بۆ «{invite.tenant.name}»</h1>
      <p className="gm-sub" style={{ margin: 0 }}>
        وەک {ROLE_LABEL[invite.role]} · <span className="gm-ltr" dir="ltr">{invite.email}</span>
      </p>
    </>
  );

  const session = await auth();
  if (!session?.user?.id) {
    return (
      <Frame>
        {intro}
        <Link href={`/login?next=${encodeURIComponent(here)}`} className="gm-btn block">بچۆ ژوورەوە</Link>
        <Link href={`/signup?next=${encodeURIComponent(here)}`} className="gm-btn quiet block">هەژمارێکی نوێ دروست بکە</Link>
        <p className="gm-hint" style={{ margin: 0 }}>بە هەمان ئیمەیڵی سەرەوە بچۆ ژوورەوە یان خۆت تۆمار بکە.</p>
      </Frame>
    );
  }

  const me = await db.user.findUnique({ where: { id: session.user.id }, select: { email: true, emailVerified: true } });
  if (me?.email?.toLowerCase() !== invite.email) {
    return (
      <Frame>
        {intro}
        <p className="gm-note warn" style={{ margin: 0 }}>
          ئێستا بە <span className="gm-ltr" dir="ltr">{me?.email ?? "—"}</span> چوویتە ژوورەوە. ئەم بانگهێشتە بۆ ئیمەیڵێکی ترە.
        </p>
        <SwitchAccountButton next={here} />
      </Frame>
    );
  }
  if (!me.emailVerified) {
    return (
      <Frame>
        {intro}
        <p className="gm-note warn" style={{ margin: 0 }}>ئیمەیڵی ئەم هەژمارە پشتڕاست نەکراوەتەوە، بۆیە ناتوانێت بانگهێشت وەربگرێت.</p>
      </Frame>
    );
  }
  return (
    <Frame>
      {intro}
      <JoinButton token={token} />
    </Frame>
  );
}
