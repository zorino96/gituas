import { auth } from "@/auth";
import { db } from "@/lib/db";
import { dict, getLang } from "@/lib/i18n";
import { currentWorkspace, loadAccountLists, loadConnections, requireWorkspace } from "../data";
import { profileEnabled } from "@/lib/shop/profile";
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

  // The interview follows the first connection while it is switched on and no store has finished it.
  const setupPending =
    profileEnabled() && ws.kind === "MERCHANT"
      ? await db.store
          .findMany({ where: { tenantId: ws.id }, select: { profile: { select: { interview: true } } } })
          .then((rows) => !rows.some((r) => !!(r.profile?.interview as { doneAt?: string } | undefined)?.doneAt))
          .catch(() => false)
      : false;

  return (
    <SettingsClient
      setupPending={setupPending}
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
