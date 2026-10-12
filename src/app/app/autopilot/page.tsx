import Link from "next/link";

import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import type { AutoDraft } from "@/lib/shop/autopilot";
import { loadShopState } from "@/lib/shop/state";
import { studioReadyFor } from "@/lib/studio/ready";
import { loadConnections, requireWorkspace } from "../data";
import { storeView } from "../automation/store-view";
import { AutopilotClient } from "./autopilot-client";

export const dynamic = "force-dynamic";

/** Auto posts: the shop autopilot (posts with the products' photos and videos), apart from the replies. */
export default async function AutopilotPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const ws = await requireWorkspace();
  const t = dict(await getLang());
  if (!can(ws.role, "configure")) return <p className="gm-note warn">{t.nr.team.roles.notAllowed}</p>;

  const sp = await searchParams;
  const conns = await loadConnections(ws.id);
  const connectedIds = [conns.META_FACEBOOK.accountId, conns.META_INSTAGRAM.accountId].filter((id): id is string => !!id);
  const state = await loadShopState(ws.id, sp.store, connectedIds);
  if (!state.store) {
    return (
      <div className="gm-empty">
        <b className="kufi">{t.automation.noPageTitle}</b>
        {t.automation.noPageBody}{" "}
        <Link href="/app/settings" className="gm-link">
          {t.automation.settingsLink}
        </Link>
      </div>
    );
  }
  const { store } = state;
  const draft = store.autoDraft as AutoDraft | null;
  return (
    <AutopilotClient
      key={store.id}
      store={storeView(store)}
      stores={state.stores.map((s) => ({ id: s.id, name: s.name || (s.igUsername ? `@${s.igUsername}` : "—") }))}
      paid={state.usage.plan === "MERCHANT" || state.usage.plan === "PRO"}
      lastDraft={draft?.media?.url ? { caption: draft.caption, thumb: draft.media.url, at: draft.at } : null}
      studio={studioReadyFor(ws.id)}
    />
  );
}
