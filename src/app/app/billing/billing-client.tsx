"use client";

import { useState, useTransition } from "react";

import { planLabel, priceFor, type BillingProduct } from "@/lib/billing/prices";
import { useLang, useT } from "@/lib/i18n/client";
import { formatMoney } from "@/lib/shop/money";
import { kuDate } from "../format";
import type { PlatformChip } from "./chips";
import { startNewsCheckoutAction, startShopCheckoutAction } from "./actions";

/** What can be bought for each product, in the order the buttons appear. */
const PLANS: Record<BillingProduct, readonly string[]> = {
  SHOP: ["MERCHANT", "PRO"],
  NEWS: ["LITE", "MANUAL", "AUTO", "ENTERPRISE"],
};

/** One thing a plan is bought for: a store for the shop, the workspace for the newsroom. */
export interface BillingTarget {
  id: string;
  name: string;
  plan: string;
  /** ISO string, or null when it was never paid. */
  paidUntil: string | null;
  /** Every platform account this plan covers. */
  chips: PlatformChip[];
  /** Whole days left of a newsroom's free trial; null or absent when it is not in one. */
  trialDaysLeft?: number | null;
}

export interface InvoiceRow {
  id: string;
  plan: string;
  amountIqd: number;
  status: "PENDING" | "PAID" | "EXPIRED" | "CANCELLED";
  createdAt: string;
  paidAt: string | null;
  storeId: string | null;
}

export interface BillingProps {
  product: BillingProduct;
  configured: boolean;
  env: "test" | "live";
  /** What Wayl said about the invoice the buyer just came back from, if any. */
  result: "paid" | "paid_test" | "pending" | null;
  targets: BillingTarget[];
  invoices: InvoiceRow[];
}

function StatusBadge({ status }: { status: InvoiceRow["status"] }) {
  const s = useT().billing.status;
  if (status === "PAID") return <span className="gm-badge">{s.PAID}</span>;
  if (status === "PENDING") return <span className="gm-badge warn">{s.PENDING}</span>;
  return <span className="gm-badge ghost">{status === "EXPIRED" ? s.EXPIRED : s.CANCELLED}</span>;
}

export function BillingClient({ product, configured, env, result, targets, invoices }: BillingProps) {
  const tr = useT();
  const b = tr.billing;
  const lang = useLang();
  const [pending, start] = useTransition();
  // Stays true after a successful checkout so the buttons stay off while the browser leaves for Wayl.
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<{ targetId: string; text: string } | null>(null);
  const busy = pending || leaving;

  function buy(target: BillingTarget, plan: string) {
    setError(null);
    start(async () => {
      const r = product === "SHOP" ? await startShopCheckoutAction(target.id, plan) : await startNewsCheckoutAction(plan);
      if (r.ok) {
        setLeaving(true);
        window.location.href = r.url;
      } else {
        setError({ targetId: target.id, text: r.error });
      }
    });
  }

  const storeName = (id: string | null) => (id ? targets.find((t) => t.id === id)?.name : undefined);

  return (
    <div>
      <h2 className="gm-title kufi">{b.title}</h2>
      <p className="gm-sub">{b.sub}</p>

      {env === "test" && <p className="gm-note warn" style={{ marginBottom: 10 }}>{b.testMode}</p>}
      {!configured && <p className="gm-note warn" style={{ marginBottom: 10 }}>{b.notReady}</p>}

      {result === "paid" && <p className="gm-ok">{b.result.paid}</p>}
      {result === "paid_test" && <p className="gm-note">{b.result.paidTest}</p>}
      {result === "pending" && <p className="gm-hint">{b.result.pending}</p>}

      {targets.length === 0 && <p className="gm-note">{b.noPage}</p>}

      <div className="gm-grid lg" style={{ marginTop: 12 }}>
        {targets.map((t) => (
          <div key={t.id} className="gm-card">
            <div className="gm-target">
              <div>
                <p>{t.name}</p>
                <small>{b.plan(planLabel(t.plan, lang))}</small>
                {t.paidUntil && <small>{b.activeUntil(kuDate(t.paidUntil, tr))}</small>}
              </div>
            </div>
            {t.chips.length > 0 && (
              <div className="gm-chips" style={{ marginTop: 8 }}>
                {t.chips.map((c) => (
                  <span key={c.platform} className="gm-chip" style={{ cursor: "default" }}>
                    {tr.platform[c.platform]} · {c.name}
                  </span>
                ))}
              </div>
            )}
            <p className="gm-hint">{b.coversAll}</p>
            {product === "NEWS" && t.trialDaysLeft != null && <p className="gm-hint">{b.trialLeft(t.trialDaysLeft)}</p>}
            {PLANS[product].map((plan) => {
              const price = priceFor(product, plan);
              if (price == null) return null;
              const name = planLabel(plan, lang);
              const amount = formatMoney(price, "IQD", lang);
              const renewing = t.plan === plan && !!t.paidUntil;
              return (
                <button key={plan} type="button" className="gm-btn block" style={{ marginTop: 8 }} disabled={!configured || busy} onClick={() => buy(t, plan)}>
                  {renewing ? b.renew(name, amount) : b.buy(name, amount)}
                </button>
              );
            })}
            {error?.targetId === t.id && <p className="gm-err">{error.text}</p>}
          </div>
        ))}
      </div>

      {invoices.length > 0 && (
        <>
          <p className="gm-sec">{b.historySec}</p>
          <div className="gm-card">
            {invoices.map((inv) => {
              const store = targets.length > 1 ? storeName(inv.storeId) : undefined;
              return (
                <div key={inv.id} className="gm-target">
                  <div>
                    <p>{planLabel(inv.plan, lang)}</p>
                    <small>
                      {kuDate(inv.createdAt, tr)}
                      {store ? ` · ${store}` : ""}
                    </small>
                  </div>
                  <div style={{ textAlign: "end" }}>
                    <p>{formatMoney(inv.amountIqd, "IQD", lang)}</p>
                    <StatusBadge status={inv.status} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
