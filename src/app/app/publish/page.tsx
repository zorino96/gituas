import { currentWorkspace, loadConnections } from "../data";
import { PublishClient } from "./publish-client";

// Instagram video containers are polled for up to ~45 s before publishing.
export const maxDuration = 60;

export default async function PublishPage() {
  const ws = (await currentWorkspace())!;
  const conns = await loadConnections(ws.id);
  return (
    <PublishClient
      workspaceId={ws.id}
      accounts={{
        FB: conns.META_FACEBOOK.connected ? (conns.META_FACEBOOK.name ?? "پەیجی فەیسبووک") : null,
        IG: conns.META_INSTAGRAM.connected ? (conns.META_INSTAGRAM.name ?? "ئینستاگرام") : null,
        TT: conns.TIKTOK.connected ? (conns.TIKTOK.name ?? "تیکتۆک") : null,
      }}
    />
  );
}
