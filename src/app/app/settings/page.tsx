import { currentWorkspace, loadConnections } from "../data";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const ws = (await currentWorkspace())!;
  const conns = await loadConnections(ws.id);
  return (
    <SettingsClient
      slug={ws.slug}
      whatsappNumber={ws.whatsappNumber}
      connected={sp.connected}
      connectError={sp.error}
      connections={[
        { provider: "META_FACEBOOK", label: "فەیسبووک", note: "کۆمێنت، مەسنجەر، بڵاوکردنەوە و ئامار", ...conns.META_FACEBOOK },
        { provider: "META_INSTAGRAM", label: "ئینستاگرام", note: "کۆمێنت، دایرێکت، بڵاوکردنەوە و ئامار", ...conns.META_INSTAGRAM },
        { provider: "TIKTOK", label: "تیکتۆک", note: "بڵاوکردنەوەی ڤیدیۆ", ...conns.TIKTOK },
      ]}
    />
  );
}
