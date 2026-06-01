import { AndroidStatusBar, MobileTabBar } from "./status-bar";

export function AndroidBrain() {
  return (
    <div className="relative h-full">
      <AndroidStatusBar />

      <div className="px-4 pt-3 pb-32">
        <div className="flex items-center justify-between">
          <button className="font-mono text-base text-fg">≡</button>
          <span className="font-mono lowercase text-sm">gituas</span>
          <button className="font-mono text-fg-dim text-sm">⌕ N</button>
        </div>

        <h1 className="mt-5 text-2xl font-light tracking-tight lowercase">ask the brain</h1>

        <div className="mt-3 flex gap-1.5 text-[10px] font-mono overflow-x-auto pb-1">
          <Pill active>@router · auto</Pill>
          <Pill>@claude</Pill>
          <Pill>@gemini</Pill>
          <Pill>@higgsfield</Pill>
        </div>

        <div className="mt-4 space-y-3">
          <UserBubble>
            why did merch-mage sales drop last tuesday?
          </UserBubble>

          <SystemRow actor="ROUTER → GEMINI" detail="investigating · pulled stripe, ads, analytics, social mentions across 72h window" />

          <BrainBubble actor="GEMINI">
            <p className="text-[12px] leading-relaxed">three signals stacked tuesday 14:00 UTC:</p>
            <ul className="mt-1.5 text-[12px] text-fg-dim space-y-1">
              <li>· google-ads cpa spiked 38% (auction shift in 'merch ai')</li>
              <li>· competitor 'mockup-ai' launched product hunt push</li>
              <li>· checkout v1 had a 9.2% drop-off on mobile safari (claude has the patch in PR #284)</li>
            </ul>
            <p className="mt-2 text-[12px]">
              estimated lost revenue: <span className="text-money font-mono">$420</span>.
            </p>
            <p className="mt-1 text-[12px] text-fg-dim">
              recommend approving PR #284 and reallocating $20 of meta budget to retargeting.
            </p>
            <div className="mt-3 flex gap-2 font-mono text-[10px]">
              <button className="px-2.5 py-1.5 rounded bg-money text-bg">approve PR #284</button>
              <button className="px-2.5 py-1.5 rounded border border-line text-fg-dim">reallocate $20</button>
            </div>
          </BrainBubble>
        </div>

        <div className="absolute left-3 right-3 bottom-20">
          <div className="rounded-full border border-line bg-panel px-4 py-2.5 flex items-center gap-2 font-mono text-[11px] text-fg-dim">
            <span className="text-money">$</span>
            <span>ask anything · or mention @gemini</span>
          </div>
        </div>
      </div>

      <MobileTabBar android active="fleet" />
    </div>
  );
}

function Pill({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <span className={`px-2.5 py-1 rounded-full border whitespace-nowrap ${active ? "bg-money/20 border-money/40 text-money" : "border-line text-fg-dim"}`}>
      {children}
    </span>
  );
}

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-tr-md bg-line px-3 py-2 text-[12px]">{children}</div>
    </div>
  );
}

function BrainBubble({ actor, children }: { actor: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl rounded-tl-md border border-money/40 bg-money/10 p-3">
      <div className="font-mono text-[10px] text-money mb-1">{actor}</div>
      {children}
    </div>
  );
}

function SystemRow({ actor, detail }: { actor: string; detail: string }) {
  return (
    <div className="px-1 font-mono text-[10px] text-fg-dim">
      <div className="text-mint">{actor}</div>
      <div className="leading-snug">{detail}</div>
    </div>
  );
}
