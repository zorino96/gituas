import type { Metadata, Viewport } from "next";
import Link from "next/link";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { dict, getLang } from "@/lib/i18n";
import { hashInviteToken, inviteState } from "@/lib/newsroom/invite";
import { NewsroomRoot } from "../../desk-shell";
import { JoinButton, SwitchAccountButton } from "./join-client";

export async function generateMetadata(): Promise<Metadata> {
  const t = dict(await getLang()).nr.shell;
  return { title: t.join.metaTitle, robots: { index: false, follow: false } };
}
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export const dynamic = "force-dynamic";

async function Frame({ children }: { children: React.ReactNode }) {
  const t = dict(await getLang()).nr.shell;
  return (
    <NewsroomRoot>
      <div className="gm-auth">
        <p className="nr-brand kufi" style={{ padding: 0 }}>
          <span className="nr-live" aria-hidden="true" />
          {t.name}
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
  const { nr } = dict(await getLang());
  const t = nr.shell.join;
  const invite = await db.invite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: { email: true, role: true, acceptedAt: true, expiresAt: true, tenant: { select: { name: true } } },
  });
  if (!invite) return <Frame><p style={{ margin: 0 }}>{t.notFound}</p></Frame>;

  const state = inviteState(invite);
  if (state === "used") {
    return (
      <Frame>
        <p style={{ margin: 0 }}>{t.used}</p>
        <Link href="/newsroom/news" className="gm-btn block">{t.goNewsroom}</Link>
      </Frame>
    );
  }
  if (state === "expired") {
    return <Frame><p style={{ margin: 0 }}>{t.expired}</p></Frame>;
  }

  const here = `/newsroom/join/${token}`;
  const intro = (
    <>
      <h1 className="gm-title kufi" style={{ margin: 0 }}>{t.title(invite.tenant.name)}</h1>
      <p className="gm-sub" style={{ margin: 0 }}>
        {t.as(nr.team.roles.label[invite.role])} · <span className="gm-ltr" dir="ltr">{invite.email}</span>
      </p>
    </>
  );

  const session = await auth();
  if (!session?.user?.id) {
    return (
      <Frame>
        {intro}
        <Link href={`/login?next=${encodeURIComponent(here)}`} className="gm-btn block">{t.signIn}</Link>
        <Link href={`/signup?next=${encodeURIComponent(here)}`} className="gm-btn quiet block">{t.signUp}</Link>
        <p className="gm-hint" style={{ margin: 0 }}>{t.sameEmail}</p>
      </Frame>
    );
  }

  const me = await db.user.findUnique({ where: { id: session.user.id }, select: { email: true, emailVerified: true } });
  if (me?.email?.toLowerCase() !== invite.email) {
    return (
      <Frame>
        {intro}
        <p className="gm-note warn" style={{ margin: 0 }}>
          {t.otherBefore} <span className="gm-ltr" dir="ltr">{me?.email ?? "—"}</span> {t.otherAfter}
        </p>
        <SwitchAccountButton next={here} />
      </Frame>
    );
  }
  if (!me.emailVerified) {
    return (
      <Frame>
        {intro}
        <p className="gm-note warn" style={{ margin: 0 }}>
          {t.unverified}
        </p>
        <Link href={`/forgot?next=${encodeURIComponent(here)}`} className="gm-btn block">
          {t.verify}
        </Link>
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
