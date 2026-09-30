"use client";

import { useId, useState } from "react";

import { useLang, useT } from "@/lib/i18n/client";
import { CITIES, cityLabel } from "@/lib/orders/cities";
import type { CityRow } from "@/lib/orders/stats";
import { formatMoney } from "@/lib/shop/money";
import { SaveMessage, useSaver } from "../automation/shared";
import { priceText } from "../products/products-client";
import { saveOrderAction, setOrderStatusAction } from "./actions";

export interface OrderView {
  id: string;
  customerName: string;
  phone: string | null;
  city: string | null;
  address: string | null;
  productId: string | null;
  productName: string;
  variantLabel: string;
  amountMinor: number;
  currency: string;
  deliveryFeeMinor: number | null;
  cod: boolean;
  status: string;
  source: string;
  note: string | null;
}

export interface OrderProduct {
  id: string;
  name: string;
  variants: { label: string; amountMinor: number; currency: string; inStock: boolean }[];
}

export interface CityCard {
  currency: string;
  rows: CityRow[];
}

/** The order statuses, in the order the filter and the status menu list them. Their names are in the dictionary. */
const STATUSES = ["NEW", "CONFIRMED", "SENT", "DELIVERED", "RETURNED", "CANCELLED"];

function OrderEditor({ order, products, onDone }: { order: OrderView | null; products: OrderProduct[]; onDone: () => void }) {
  const uid = useId();
  const lang = useLang();
  const od = useT().orders;
  const { pending, message, run } = useSaver();

  const [customerName, setCustomerName] = useState(order?.customerName ?? "");
  const [phone, setPhone] = useState(order?.phone ? `+${order.phone}` : "");
  const [city, setCity] = useState(order?.city ?? "");
  const [address, setAddress] = useState(order?.address ?? "");
  const [productId, setProductId] = useState(order?.productId ?? "");
  const [variantLabel, setVariantLabel] = useState(order?.variantLabel ?? "");
  const [price, setPrice] = useState(order && order.amountMinor > 0 ? priceText(order.amountMinor, order.currency) : "");
  const [currency, setCurrency] = useState(order?.currency ?? "IQD");
  const [deliveryFee, setDeliveryFee] = useState(order?.deliveryFeeMinor != null ? priceText(order.deliveryFeeMinor, order.currency) : "");
  const [cod, setCod] = useState(order?.cod ?? true);
  const [note, setNote] = useState(order?.note ?? "");

  // An order whose product was archived since still shows it, so saving does not quietly detach it.
  const options: OrderProduct[] =
    order?.productId && order.productName && !products.some((p) => p.id === order.productId)
      ? [...products, { id: order.productId, name: order.productName, variants: [] }]
      : products;
  const chosen = products.find((p) => p.id === productId);

  function pickProduct(id: string) {
    setProductId(id);
    const p = products.find((x) => x.id === id);
    const v = p?.variants.find((x) => x.inStock) ?? p?.variants[0];
    if (!v) return;
    // Fill what is still empty from the product's first variant; never overwrite what was typed.
    if (!price.trim()) {
      setPrice(priceText(v.amountMinor, v.currency));
      setCurrency(v.currency);
    }
    if (!variantLabel.trim()) setVariantLabel(v.label);
  }

  function save() {
    run(
      () =>
        saveOrderAction(order?.id ?? null, {
          customerName,
          phone,
          city,
          address,
          productId,
          variantLabel,
          price,
          currency,
          deliveryFee,
          cod,
          status: order?.status ?? "NEW",
          note,
        }),
      onDone,
    );
  }

  return (
    <div className="gm-stack">
      <div className="gm-field">
        <label htmlFor={`${uid}-name`}>{od.customerName}</label>
        <input id={`${uid}-name`} className="gm-input" value={customerName} maxLength={80} required onChange={(e) => setCustomerName(e.target.value)} />
      </div>
      <div className="gm-field">
        <label htmlFor={`${uid}-phone`}>{od.phone}</label>
        <input id={`${uid}-phone`} className="gm-input gm-ltr" inputMode="tel" value={phone} maxLength={24} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div className="gm-field">
        <label htmlFor={`${uid}-city`}>{od.city}</label>
        <select id={`${uid}-city`} className="gm-input" value={city} onChange={(e) => setCity(e.target.value)}>
          <option value="">—</option>
          {CITIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c[lang]}
            </option>
          ))}
        </select>
      </div>
      <div className="gm-field">
        <label htmlFor={`${uid}-addr`}>{od.address}</label>
        <input id={`${uid}-addr`} className="gm-input" value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <div className="gm-field">
        <label htmlFor={`${uid}-product`}>{od.product}</label>
        <select id={`${uid}-product`} className="gm-input" value={productId} onChange={(e) => pickProduct(e.target.value)}>
          <option value="">{od.otherProduct}</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="gm-field">
        <label htmlFor={`${uid}-variant`}>{od.variant}</label>
        <input id={`${uid}-variant`} className="gm-input" list={`${uid}-variants`} value={variantLabel} maxLength={40} onChange={(e) => setVariantLabel(e.target.value)} />
        <datalist id={`${uid}-variants`}>
          {(chosen?.variants ?? [])
            .filter((v) => v.label)
            .map((v) => (
              <option key={v.label} value={v.label} />
            ))}
        </datalist>
      </div>
      <div className="gm-row" style={{ gap: 8, alignItems: "flex-end" }}>
        <div className="gm-field" style={{ flex: 1 }}>
          <label htmlFor={`${uid}-price`}>{od.price}</label>
          <input id={`${uid}-price`} className="gm-input gm-ltr" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="gm-field">
          <label htmlFor={`${uid}-cur`}>{od.currency}</label>
          <select id={`${uid}-cur`} className="gm-input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="IQD">{od.iqd}</option>
            <option value="USD">{od.usd}</option>
          </select>
        </div>
      </div>
      <div className="gm-field">
        <label htmlFor={`${uid}-fee`}>{od.deliveryFee}</label>
        <input id={`${uid}-fee`} className="gm-input gm-ltr" inputMode="decimal" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} />
      </div>
      <label className="gm-radio">
        <input type="checkbox" checked={cod} onChange={(e) => setCod(e.target.checked)} />
        {od.cod}
      </label>
      <div className="gm-field">
        <label htmlFor={`${uid}-note`}>{od.note}</label>
        <textarea id={`${uid}-note`} className="gm-textarea" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </div>

      <div className="gm-row" style={{ gap: 8 }}>
        <button type="button" className="gm-btn" disabled={pending} onClick={save}>
          {od.save}
        </button>
        <button type="button" className="gm-btn quiet" disabled={pending} onClick={onDone}>
          {od.cancel}
        </button>
      </div>
      <SaveMessage message={message} />
    </div>
  );
}

export function OrdersClient({ orders, cityCards, products }: { orders: OrderView[]; cityCards: CityCard[]; products: OrderProduct[] }) {
  const lang = useLang();
  const od = useT().orders;
  const statusLabel: Record<string, string> = od.status;
  const sourceLabel: Record<string, string> = od.source;
  const [filter, setFilter] = useState<string>("ALL");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const { pending, message, setMessage, run } = useSaver();

  function open(key: string | "new") {
    setMessage(null);
    setEditing(key);
  }

  const shown = filter === "ALL" ? orders : orders.filter((o) => o.status === filter);

  return (
    <div>
      <h2 className="gm-title kufi">{od.title}</h2>
      <p className="gm-sub">{od.sub}</p>

      <div className="gm-chips" style={{ marginBottom: 12 }}>
        {["ALL", ...STATUSES].map((s) => (
          <button key={s} type="button" className="gm-chip" aria-pressed={filter === s} onClick={() => setFilter(s)}>
            {s === "ALL" ? od.filterAll : statusLabel[s]}
          </button>
        ))}
      </div>

      <div style={{ margin: "12px 0" }}>
        <button type="button" className="gm-btn" disabled={editing === "new"} onClick={() => open("new")}>
          {od.newOrder}
        </button>
      </div>

      {editing === "new" && (
        <div className="gm-card" style={{ marginBottom: 12 }}>
          <OrderEditor products={products} order={null} onDone={() => setEditing(null)} />
        </div>
      )}

      <SaveMessage message={message} />

      {cityCards.length > 0 && (
        <div className="gm-card" style={{ marginBottom: 12 }}>
          <p className="gm-sec" style={{ margin: 0 }}>
            {od.byCity}
          </p>
          {cityCards.map((card) => (
            <div key={card.currency}>
              {cityCards.length > 1 && (
                <p className="gm-hint" style={{ marginTop: 10 }}>
                  {card.currency === "USD" ? od.usd : od.iqd}
                </p>
              )}
              {card.rows.map((r) => (
                <div key={r.city} className="gm-target">
                  <div>
                    <p>{r.city}</p>
                    <small>{od.count(r.count)}</small>
                  </div>
                  <span>{formatMoney(r.totalMinor, card.currency, lang)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {orders.length === 0 && editing !== "new" ? (
        <div className="gm-empty">
          <b className="kufi">{od.emptyTitle}</b>
          {od.emptyBody}
        </div>
      ) : shown.length === 0 ? (
        <p className="gm-note">{od.noneInStatus}</p>
      ) : (
        <div className="gm-card">
          {shown.map((o) =>
            editing === o.id ? (
              <div key={o.id} style={{ padding: "12px 0" }}>
                <OrderEditor products={products} order={o} onDone={() => setEditing(null)} />
              </div>
            ) : (
              <div key={o.id} className="gm-target">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p>
                    {o.customerName || "—"} {sourceLabel[o.source] && <span className="gm-badge ghost">{sourceLabel[o.source]}</span>}
                  </p>
                  <small>{[cityLabel(o.city, lang), [o.productName, o.variantLabel].filter(Boolean).join(" — ")].filter(Boolean).join(" · ") || "—"}</small>
                  <small>
                    {o.amountMinor > 0 ? formatMoney(o.amountMinor, o.currency, lang) : "—"}
                    {o.cod ? ` · ${od.cod}` : ""}
                  </small>
                  {o.phone && (
                    <small className="gm-ltr" dir="ltr">
                      +{o.phone}
                    </small>
                  )}
                </div>
                <div className="gm-stack" style={{ alignItems: "stretch", gap: 6 }}>
                  <select className="gm-input" aria-label={od.statusAria} value={o.status} disabled={pending} onChange={(e) => run(() => setOrderStatusAction(o.id, e.target.value))}>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {statusLabel[s]}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="gm-btn small quiet" disabled={pending} onClick={() => open(o.id)}>
                    {od.edit}
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
