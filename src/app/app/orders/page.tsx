import { db } from "@/lib/db";
import { getLang } from "@/lib/i18n";
import { can, NOT_ALLOWED } from "@/lib/newsroom/roles";
import { ordersByCity } from "@/lib/orders/stats";
import { currentWorkspace } from "../data";
import { OrdersClient, type CityCard, type OrderView } from "./orders-client";

export const dynamic = "force-dynamic";

/** The newest orders shown in the list; the by-city card always counts all of them. */
const LIST_LIMIT = 200;

export default async function OrdersPage() {
  const ws = (await currentWorkspace())!;
  if (!can(ws.role, "engage")) return <p className="gm-note warn">{NOT_ALLOWED}</p>;

  const lang = await getLang();
  const [orders, forStats, products] = await Promise.all([
    db.order.findMany({ where: { tenantId: ws.id }, orderBy: { createdAt: "desc" }, take: LIST_LIMIT }),
    db.order.findMany({ where: { tenantId: ws.id }, select: { city: true, amountMinor: true, status: true, currency: true } }),
    db.product.findMany({ where: { active: true, store: { tenantId: ws.id } }, include: { variants: { orderBy: { position: "asc" } } }, orderBy: { name: "asc" } }),
  ]);

  // Dinars and dollars are never added together: one card section per currency.
  const currencies = [...new Set(forStats.map((o) => o.currency))].sort();
  const cityCards: CityCard[] = currencies.map((currency) => ({ currency, rows: ordersByCity(forStats.filter((o) => o.currency === currency), lang) })).filter((c) => c.rows.length > 0);

  const views: OrderView[] = orders.map((o) => ({
    id: o.id,
    customerName: o.customerName,
    phone: o.phone,
    city: o.city,
    address: o.address,
    productId: o.productId,
    productName: o.productName,
    variantLabel: o.variantLabel,
    amountMinor: o.amountMinor,
    currency: o.currency,
    deliveryFeeMinor: o.deliveryFeeMinor,
    cod: o.cod,
    status: o.status,
    source: o.source,
    note: o.note,
  }));

  return (
    <OrdersClient
      orders={views}
      cityCards={cityCards}
      products={products.map((p) => ({
        id: p.id,
        name: p.name,
        variants: p.variants.map((v) => ({ label: v.label, amountMinor: v.amountMinor, currency: v.currency, inStock: v.inStock })),
      }))}
    />
  );
}
