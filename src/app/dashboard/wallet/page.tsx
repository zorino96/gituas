import { auth } from "@/auth";
import { db } from "@/lib/db";

const ALLOCATION = [
  { channel: "google-ads", pct: 40 },
  { channel: "tiktok promo", pct: 25 },
  { channel: "server & infra", pct: 20 },
  { channel: "ai api spend", pct: 10 },
  { channel: "reserve", pct: 5 },
];

export default async function WalletPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const tenant = await db.tenant.findFirst({
    where: { ownerId: session.user.id },
    select: { id: true },
  });
  if (!tenant) return null;

  const wallet = await db.wallet.findUnique({
    where: { tenantId: tenant.id },
    include: {
      transactions: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });

  const balance = (wallet?.balanceCents ?? 0) / 100;

  return (
    <div className="px-6 py-8 max-w-7xl mx-auto space-y-8">
      {/* Big balance + actions */}
      <div className="rounded-xl border border-line bg-panel p-6 shadow-money">
        <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">
          wallet · @{session.user.name?.toLowerCase() ?? "operator"}
        </div>
        <div className="mt-2 font-mono text-5xl text-money">${balance.toFixed(2)}</div>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <button className="px-4 py-2 rounded-md bg-money text-bg font-mono">deposit</button>
          <button className="px-4 py-2 rounded-md border border-line text-fg-dim font-mono">
            withdraw ${Math.max(balance - 14.22, 0).toFixed(2)}
          </button>
          <button className="px-4 py-2 rounded-md border border-line text-fg-dim font-mono">allocation rules</button>
        </div>
        <div className="mt-5 grid sm:grid-cols-3 gap-3 text-xs">
          <Stat label="available" value={`$${Math.max(balance - 14.22, 0).toFixed(2)}`} />
          <Stat label="routing" value="$14.22" />
          <Stat label="earned · mtd" value={`$${balance.toFixed(2)}`} />
        </div>
      </div>

      {/* Allocation */}
      <div>
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-fg-dim mb-3">
          active allocation · per $1 deposit · auto-tuned
        </h2>
        <div className="rounded-xl border border-line bg-panel p-5 space-y-3">
          {ALLOCATION.map((a) => (
            <div key={a.channel} className="space-y-1">
              <div className="flex items-center justify-between text-sm font-mono">
                <span className="text-fg-dim lowercase">{a.channel}</span>
                <span className="text-money">{a.pct}%</span>
              </div>
              <div className="h-1.5 bg-line rounded-full overflow-hidden">
                <div className="h-full bg-money" style={{ width: `${a.pct}%` }} />
              </div>
            </div>
          ))}
          <div className="pt-2 text-xs text-fg-dim font-mono">100% allocated</div>
        </div>
      </div>

      {/* Ledger */}
      <div>
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-fg-dim mb-3">
          ledger · last 20 transactions
        </h2>
        <div className="rounded-xl border border-line bg-panel overflow-hidden">
          {wallet?.transactions?.length ? (
            <ul className="divide-y divide-line">
              {wallet.transactions.map((t) => (
                <li key={t.id} className="px-5 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3 text-sm">
                    <span className="font-mono text-[10px] text-fg-dim">
                      {new Date(t.createdAt).toLocaleString("en-GB", { hour12: false })}
                    </span>
                    <span className={`font-mono text-xs ${typeColor(t.type)}`}>
                      {typeLabel(t.type)}
                    </span>
                    <span className="text-fg-dim lowercase">{t.description}</span>
                  </div>
                  <span className={`font-mono ${t.amountCents >= 0 ? "text-money" : "text-fg-dim"}`}>
                    {t.amountCents >= 0 ? "+" : "−"} ${Math.abs(t.amountCents / 100).toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-6 py-16 text-center text-sm text-fg-dim">
              no transactions yet — your first deposit creates this ledger.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-panel-2 px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">{label}</div>
      <div className="mt-1 font-mono text-base text-fg">{value}</div>
    </div>
  );
}
function typeLabel(t: string): string {
  return t.toLowerCase().replace(/_/g, " ");
}
function typeColor(t: string): string {
  if (t === "DEPOSIT" || t === "EARNINGS") return "text-money";
  if (t === "WITHDRAWAL") return "text-mint";
  return "text-amber";
}
