import Link from "next/link";

import { can, NOT_ALLOWED } from "@/lib/newsroom/roles";
import { loadShopState } from "@/lib/shop/state";
import { currentWorkspace } from "../data";
import { ProductsClient } from "./products-client";

export const dynamic = "force-dynamic";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const ws = (await currentWorkspace())!;
  if (!can(ws.role, "configure")) return <p className="gm-note warn">{NOT_ALLOWED}</p>;

  const sp = await searchParams;
  const state = await loadShopState(ws.id, sp.store);
  if (!state.store) {
    return (
      <div className="gm-empty">
        <b className="kufi">هێشتا پەیجێکت پەیوەست نەکردووە</b>
        لە ڕێکخستنەکان فەیسبووک یان ئینستاگرام پەیوەست بکە، ئینجا ئۆتۆمەیشن لێرە دەردەکەوێت.{" "}
        <Link href="/app/settings" className="gm-link">
          ڕێکخستنەکان
        </Link>
      </div>
    );
  }

  return (
    <ProductsClient
      key={state.store.id}
      workspaceId={ws.id}
      storeId={state.store.id}
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
