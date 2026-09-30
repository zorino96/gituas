"use client";

import { useState, useTransition } from "react";

import { PLAN_LABEL, priceFor, type BillingProduct } from "@/lib/billing/prices";
import { formatMoney } from "@/lib/shop/money";
import { kuDate } from "../format";
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
  result: "paid" | "pending" | null;
  targets: BillingTarget[];
  invoices: InvoiceRow[];
}

function StatusBadge({ status }: { status: InvoiceRow["status"] }) {
  if (status === "PAID") return <span className="gm-badge">دراوە</span>;
  if (status === "PENDING") return <span className="gm-badge warn">چاوەڕوان</span>;
  return <span className="gm-badge ghost">{status === "EXPIRED" ? "بەسەرچوو" : "هەڵوەشاوە"}</span>;
}

export function BillingClient({ product, configured, env, result, targets, invoices }: BillingProps) {
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
      <h2 className="gm-title kufi">پلان و پارەدان</h2>
      <p className="gm-sub">بە FIB، ZainCash، QiCard، FastPay یان کارت — لە ڕێگەی Wayl</p>

      {env === "test" && <p className="gm-note warn" style={{ marginBottom: 10 }}>مۆدی تاقیکردنەوە — هیچ پارەیەکی ڕاستەقینە وەرناگیرێت.</p>}
      {!configured && <p className="gm-note warn" style={{ marginBottom: 10 }}>پارەدان هێشتا ئامادە نییە.</p>}

      {result === "paid" && <p className="gm-ok">پارەدان سەرکەوتوو بوو — پلانەکەت چالاک کرا.</p>}
      {result === "pending" && <p className="gm-hint">پارەدانەکە هێشتا تەواو نەبووە. ئەگەر پارەت داوە، چەند خولەکێکی تر ئەم پەڕەیە نوێ بکەرەوە.</p>}

      {targets.length === 0 && <p className="gm-note">هێشتا پەیجێکت پەیوەست نەکردووە.</p>}

      {targets.map((t) => (
        <div key={t.id} className="gm-card" style={{ marginTop: 12 }}>
          <div className="gm-target">
            <div>
              <p>{t.name}</p>
              <small>پلان: {PLAN_LABEL[t.plan] ?? t.plan}</small>
              {t.paidUntil && <small>چالاکە تا {kuDate(t.paidUntil)}</small>}
            </div>
          </div>
          {PLANS[product].map((plan) => {
            const price = priceFor(product, plan);
            if (price == null) return null;
            const renewing = t.plan === plan && !!t.paidUntil;
            return (
              <button key={plan} type="button" className="gm-btn block" style={{ marginTop: 8 }} disabled={!configured || busy} onClick={() => buy(t, plan)}>
                {renewing ? "نوێکردنەوە" : "کڕین"} {PLAN_LABEL[plan]} — {formatMoney(price, "IQD", "ckb")} بۆ مانگێک
              </button>
            );
          })}
          {error?.targetId === t.id && <p className="gm-err">{error.text}</p>}
        </div>
      ))}

      {invoices.length > 0 && (
        <>
          <p className="gm-sec">مێژووی پارەدان</p>
          <div className="gm-card">
            {invoices.map((inv) => {
              const store = targets.length > 1 ? storeName(inv.storeId) : undefined;
              return (
                <div key={inv.id} className="gm-target">
                  <div>
                    <p>{PLAN_LABEL[inv.plan] ?? inv.plan}</p>
                    <small>
                      {kuDate(inv.createdAt)}
                      {store ? ` · ${store}` : ""}
                    </small>
                  </div>
                  <div style={{ textAlign: "end" }}>
                    <p>{formatMoney(inv.amountIqd, "IQD", "ckb")}</p>
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
