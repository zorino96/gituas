import { IosStatusBar, MobileTabBar } from "./status-bar";

const ALLOCATION = [
  { ch: "google-ads", pct: 40 },
  { ch: "tiktok promo", pct: 25 },
  { ch: "server & infra", pct: 20 },
  { ch: "ai api spend", pct: 10 },
  { ch: "reserve", pct: 5 },
];

const LEDGER = [
  { kind: "INCOME", desc: "stripe · merch-mage sub · 14 customers", time: "18m ago", amount: "+ $266.00" },
  { kind: "SPEND", desc: "google-ads · merch-mage · auto-spend", time: "22m ago", amount: "− $18.40" },
  { kind: "DEPOSIT", desc: "founder · stripe pm_4kZ", time: "2h ago", amount: "+ $50.00" },
  { kind: "WITHDRAW", desc: "wise · verified · yest 22:01", time: "yest", amount: "− $1,200.00" },
];

export function IosWallet({ walletDollars }: { walletDollars: string }) {
  return (
    <div className="relative h-full">
      <IosStatusBar />

      <div className="px-5 pt-2 pb-24">
        <div className="flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">wallet</div>
          <span className="font-mono text-[10px] text-money">healthy</span>
        </div>

        <div className="mt-3 rounded-2xl border border-money/40 bg-money/10 p-4 shadow-money">
          <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">available</div>
          <div className="mt-1 font-mono text-3xl text-money">${walletDollars}</div>
          <div className="mt-1 font-mono text-[10px] text-fg-dim">+ $14.22 routing · earnings mtd $842k</div>
          <button className="mt-3 w-full rounded-md bg-money text-bg py-2 font-mono text-xs">
            withdraw to wise →
          </button>
        </div>

        <div className="mt-5">
          <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">allocation · auto-tuned</div>
          <div className="mt-2 space-y-2">
            {ALLOCATION.map((a) => (
              <div key={a.ch}>
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className="text-fg-dim lowercase">{a.ch}</span>
                  <span className="text-money">{a.pct}%</span>
                </div>
                <div className="h-1 bg-line rounded-full mt-1 overflow-hidden">
                  <div className="h-full bg-money" style={{ width: `${a.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">recent ledger</div>
          <ul className="mt-2 space-y-1.5">
            {LEDGER.map((t, i) => (
              <li key={i} className="rounded-md border border-line bg-panel-2 px-3 py-2">
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className={t.kind === "INCOME" || t.kind === "DEPOSIT" ? "text-money" : "text-amber"}>
                    {t.kind.toLowerCase()}
                  </span>
                  <span className="text-fg-dim">{t.time}</span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-xs text-fg-dim lowercase truncate pr-2">{t.desc}</span>
                  <span className="font-mono text-xs">{t.amount}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <MobileTabBar active="wallet" />
    </div>
  );
}
