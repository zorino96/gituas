import Link from "next/link";

import { dict, getLang } from "@/lib/i18n";
import { can, NOT_ALLOWED } from "@/lib/newsroom/roles";
import { loadShopState } from "@/lib/shop/state";
import { currentWorkspace, loadConnections } from "../data";
import { ProductsClient } from "./products-client";

export const dynamic = "force-dynamic";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const ws = (await currentWorkspace())!;
  if (!can(ws.role, "configure")) return <p className="gm-note warn">{NOT_ALLOWED}</p>;

  const sp = await searchParams;
  const t = dict(await getLang());
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

  return (
    <ProductsClient
      key={state.store.id}
      workspaceId={ws.id}
      storeId={state.store.id}
      stores={state.stores.map((s) => ({ id: s.id, name: s.name || (s.igUsername ? `@${s.igUsername}` : "—") }))}
      products={state.products.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description ?? "",
        photos: p.photos,
        variants: p.variants.map((v) => ({ label: v.label, amountMinor: v.amountMinor, currency: v.currency, inStock: v.inStock })),
      }))}
    />
  );
}
