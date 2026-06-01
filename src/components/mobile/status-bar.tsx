import { Wifi, Signal, BatteryFull } from "lucide-react";

export function IosStatusBar() {
  return (
    <div className="h-11 flex items-center justify-between px-7 pt-2 text-fg text-xs font-mono">
      <span>9:41</span>
      <div className="flex items-center gap-1">
        <Signal className="h-3 w-3" />
        <Wifi className="h-3 w-3" />
        <BatteryFull className="h-3.5 w-3.5" />
      </div>
    </div>
  );
}

export function AndroidStatusBar() {
  return (
    <div className="h-9 flex items-center justify-between px-4 pt-1 text-fg text-[11px] font-mono">
      <span>9:30</span>
      <div className="flex items-center gap-1">
        <Signal className="h-3 w-3" />
        <Wifi className="h-3 w-3" />
        <BatteryFull className="h-3.5 w-3.5" />
      </div>
    </div>
  );
}

export function MobileTabBar({
  android,
  active,
}: {
  android?: boolean;
  active: "home" | "queue" | "wallet" | "agents" | "more" | "fleet" | "audit";
}) {
  const items = android
    ? ([
        { id: "fleet", glyph: "▣", label: "fleet" },
        { id: "queue", glyph: "✓", label: "12" },
        { id: "wallet", glyph: "$", label: "wallet" },
        { id: "audit", glyph: "≡", label: "audit" },
      ] as const)
    : ([
        { id: "home", glyph: "▣", label: "home" },
        { id: "queue", glyph: "✓", label: "queue" },
        { id: "wallet", glyph: "$", label: "wallet" },
        { id: "agents", glyph: "◉", label: "agents" },
        { id: "more", glyph: "≡", label: "more" },
      ] as const);

  return (
    <div className="absolute bottom-0 left-0 right-0 h-16 bg-panel border-t border-line flex items-center justify-around font-mono">
      {items.map((it) => {
        const isActive = it.id === active;
        return (
          <div key={it.id} className="flex flex-col items-center gap-0.5">
            <span className={isActive ? "text-money" : "text-fg-dim"}>{it.glyph}</span>
            <span className={`text-[10px] ${isActive ? "text-money" : "text-fg-dim"}`}>{it.label}</span>
          </div>
        );
      })}
    </div>
  );
}
