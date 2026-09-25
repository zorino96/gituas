import { auth } from "@/auth";
import { db } from "@/lib/db";
import { currentWorkspace, loadConnections } from "../data";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const ws = (await currentWorkspace())!;
  const session = await auth();
  const [conns, me] = await Promise.all([
    loadConnections(ws.id),
    db.user.findUnique({ where: { id: session!.user!.id! }, select: { email: true, passwordHash: true } }),
  ]);
  return (
    <SettingsClient
      slug={ws.slug}
      whatsappNumber={ws.whatsappNumber}
      connected={sp.connected}
      connectError={sp.error}
      account={{ email: me?.email ?? null, hasPassword: !!me?.passwordHash }}
      connections={[
        { provider: "META_FACEBOOK", label: "فەیسبووک", note: "کۆمێنت، مەسنجەر، بڵاوکردنەوە و ئامار", ...conns.META_FACEBOOK },
        { provider: "META_INSTAGRAM", label: "ئینستاگرام", note: "کۆمێنت، دایرێکت، بڵاوکردنەوە و ئامار", ...conns.META_INSTAGRAM },
        { provider: "TIKTOK", label: "تیکتۆک", note: "بڵاوکردنەوەی ڤیدیۆ", ...conns.TIKTOK },
      ]}
    />
  );
}
