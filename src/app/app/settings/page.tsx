import { auth } from "@/auth";
import { db } from "@/lib/db";
import { dict, getLang } from "@/lib/i18n";
import { currentWorkspace, loadAccountLists, loadConnections, requireWorkspace } from "../data";
import { can } from "@/lib/newsroom/roles";
import { profileEnabled } from "@/lib/shop/profile";
import { isUnlimited } from "@/lib/shop/redeem";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const t = dict(await getLang());
  const ws = await requireWorkspace();
  const session = await auth();
  const [conns, lists, me] = await Promise.all([
    loadConnections(ws.id),
    loadAccountLists(ws.id),
    db.user.findUnique({ where: { id: session!.user!.id! }, select: { email: true, passwordHash: true } }),
  ]);

  // The setup interview (only while it is switched on): the FIRST Facebook or Instagram connection of a shop workspace goes on to it,
  // and every store can be reopened from here to change its answers.
  const setupStores =
    profileEnabled() && ws.kind === "MERCHANT"
      ? await db.store
          .findMany({ where: { tenantId: ws.id }, orderBy: { createdAt: "asc" }, take: 15, select: { id: true, name: true, igUsername: true } })
          .catch(() => [])
      : [];
  const setupPending = profileEnabled() && ws.kind === "MERCHANT" && setupStores.length === 0;

  // The test-code card is for the workspace owner only.
  const redeem = can(ws.role, "team") ? { unlimited: await isUnlimited(ws.id) } : null;

  return (
    <SettingsClient
      redeem={redeem}
      setupPending={setupPending}
      setupStores={setupStores.map((s) => ({ id: s.id, name: s.name || (s.igUsername ? `@${s.igUsername}` : "") }))}
      slug={ws.slug}
      whatsappNumber={ws.whatsappNumber}
      connected={sp.connected}
      connectError={sp.error}
      account={{ email: me?.email ?? null, hasPassword: !!me?.passwordHash }}
      desk={ws.kind === "NEWS"}
      connections={[
        { provider: "META_FACEBOOK", label: t.platform.FB, note: t.settings.connNote.META_FACEBOOK, ...conns.META_FACEBOOK, accounts: lists.META_FACEBOOK },
        { provider: "META_INSTAGRAM", label: t.platform.IG, note: t.settings.connNote.META_INSTAGRAM, ...conns.META_INSTAGRAM, accounts: lists.META_INSTAGRAM },
        { provider: "TIKTOK", label: t.platform.TT, note: t.settings.connNote.TIKTOK, ...conns.TIKTOK, accounts: lists.TIKTOK },
        { provider: "YOUTUBE", label: t.platform.YT, note: t.settings.connNote.YOUTUBE, ...conns.YOUTUBE, accounts: lists.YOUTUBE },
      ]}
    />
  );
}
