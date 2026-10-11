import { db } from "@/lib/db";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { loadBuyerProfile } from "@/lib/orders/audience";
import { ordersByCity, weekReport } from "@/lib/orders/stats";
import { currentWorkspace } from "../data";
import { OrdersClient, type CityCard, type OrderView } from "./orders-client";

export const dynamic = "force-dynamic";

/** The newest orders shown in the list; the by-city card always counts all of them. */
const LIST_LIMIT = 200;

export default async function OrdersPage() {
  const ws = (await currentWorkspace())!;
  const lang = await getLang();
  if (!can(ws.role, "engage")) return <p className="gm-note warn">{dict(lang).nr.team.roles.notAllowed}</p>;

  const [orders, forStats, products, audience] = await Promise.all([
    db.order.findMany({ where: { tenantId: ws.id }, orderBy: { createdAt: "desc" }, take: LIST_LIMIT }),
    // The last year is enough for the cards; it keeps the page light as orders pile up.
    db.order.findMany({ where: { tenantId: ws.id, createdAt: { gt: new Date(Date.now() - 365 * 86_400_000) } }, select: { city: true, amountMinor: true, status: true, currency: true, createdAt: true, productName: true } }),
    db.product.findMany({ where: { active: true, store: { tenantId: ws.id } }, include: { variants: { orderBy: { position: "asc" } } }, orderBy: { name: "asc" } }),
    loadBuyerProfile(ws.id),
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
    collect: o.collect,
  }));

  return (
    <OrdersClient
      orders={views}
      cityCards={cityCards}
      audience={audience}
      week={weekReport(forStats, Date.now())}
      products={products.map((p) => ({
        id: p.id,
        name: p.name,
        variants: p.variants.map((v) => ({ label: v.label, amountMinor: v.amountMinor, currency: v.currency, inStock: v.inStock })),
      }))}
    />
  );
}
