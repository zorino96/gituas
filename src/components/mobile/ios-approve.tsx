import { IosStatusBar, MobileTabBar } from "./status-bar";

export function IosApprove() {
  return (
    <div className="relative h-full">
      <IosStatusBar />

      <div className="px-5 pt-2 pb-24">
        <div className="flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">queue · approvals</div>
          <span className="font-mono text-[10px] text-amber">auto · 14m</span>
        </div>
        <div className="mt-1 font-mono text-xs text-fg-dim">2 / 12 reviewed · swipe →</div>

        <div className="mt-4 rounded-2xl border border-money/40 bg-panel-2 overflow-hidden shadow-money-lg">
          {/* preview area */}
          <div className="h-40 bg-money/10 relative grid place-items-center font-mono text-xs text-money">
            6s video preview · merch-mage
          </div>

          <div className="p-4">
            <div className="flex items-center justify-between font-mono text-[10px]">
              <span className="text-money">@gemini · merch-mage</span>
              <span className="text-money">$10 spend</span>
            </div>
            <div className="mt-2 text-xs uppercase tracking-wider text-fg-dim font-mono">tiktok 6s promo · 'before/after'</div>
            <p className="mt-2 text-[13px] leading-snug">
              "one product photo → fifty on-brand mockups in one prompt. no designers harmed."
            </p>
            <div className="mt-3 rounded-md bg-bg/40 border border-line p-2 text-[11px] text-fg-dim">
              <span className="text-money">↳ why</span> trending sound · audience match 0.87 · predicted roas 4.6x
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 font-mono text-xs">
          <button className="rounded-xl border border-line py-3 text-red">← reject</button>
          <button className="rounded-xl border border-line py-3 text-fg-dim">✎ edit</button>
          <button className="rounded-xl bg-money text-bg py-3">approve →</button>
        </div>

        <div className="mt-6">
          <div className="font-mono text-[10px] uppercase tracking-wider text-fg-dim mb-2">up next</div>
          <ul className="space-y-1.5 text-[11px]">
            <UpNextRow actor="@claude" project="merch-mage" action="merge PR #284" />
            <UpNextRow actor="@gemini" project="vibedb" action="ig carousel · 6 frames" />
            <UpNextRow actor="@router" project="tiny-rss" action="scale up → 6 dynos" />
          </ul>
        </div>
      </div>

      <MobileTabBar active="queue" />
    </div>
  );
}

function UpNextRow({ actor, project, action }: { actor: string; project: string; action: string }) {
  return (
    <li className="rounded-md border border-line bg-panel-2 px-3 py-2 flex items-center justify-between">
      <div className="font-mono">
        <span className="text-money">{actor}</span>
        <span className="text-fg-dim mx-1">·</span>
        <span className="text-fg-dim">{project}</span>
        <div className="text-fg lowercase mt-0.5">{action}</div>
      </div>
      <span className="font-mono text-[10px] text-fg-dim">›</span>
    </li>
  );
}
