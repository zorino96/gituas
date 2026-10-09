// What a desk may ask of the autopilot: its modes, the only platforms it may post to, and
// the ranges of its two numbers. Pure and free of server code, so the settings screen, the
// save action and the engine all read the same rules.

export const AUTO_MODES = ["OFF", "DRAFT", "PUBLISH"] as const;
export type AutoMode = (typeof AUTO_MODES)[number];

/**
 * The only platforms the autopilot may ever post to. TikTok's rules need a person to approve
 * every post, and YouTube takes video only, so neither can be added here.
 */
export const AUTO_TARGETS = ["FB", "IG"] as const;
export type AutoTarget = (typeof AUTO_TARGETS)[number];

export const AUTO_DAILY_MAX = { min: 1, max: 200, fallback: 20 } as const;
export const AUTO_MIN_GAP = { min: 1, max: 120, fallback: 3 } as const;

export function isAutoMode(v: unknown): v is AutoMode {
  return typeof v === "string" && (AUTO_MODES as readonly string[]).includes(v);
}

/**
 * Where the autopilot may post right now: what the desk saved, cut down to the allow-list
 * and to the pages that are actually connected. Whatever is saved, the answer can only
 * hold "FB" and "IG".
 */
/** The saved account choice ("FB:<id>", "IG:<id>") as per-target id lists, or undefined for the defaults. */
export function autoAccountsFor(saved: readonly unknown[] | null | undefined): Partial<Record<AutoTarget, string[]>> | undefined {
  const out: Partial<Record<AutoTarget, string[]>> = {};
  for (const v of saved ?? []) {
    const m = typeof v === "string" ? /^(FB|IG):([0-9]{3,40})$/.exec(v) : null;
    if (!m) continue;
    const target = m[1] as AutoTarget;
    const list = (out[target] ??= []);
    if (!list.includes(m[2])) list.push(m[2]);
  }
  return Object.keys(out).length ? out : undefined;
}

export function autoTargetsFor(saved: readonly unknown[] | null | undefined, connected: { FB: boolean; IG: boolean }): AutoTarget[] {
  const chosen = Array.isArray(saved) ? saved : [];
  return AUTO_TARGETS.filter((t) => chosen.includes(t) && connected[t] === true);
}

export interface AutopilotChoice {
  mode: AutoMode;
  targets: AutoTarget[];
  dailyMax: number;
  minGapMin: number;
  /** Quiet hours in Baghdad time (whole hours 0–23), or null for none. */
  quiet: { from: number; to: number } | null;
}

/** Baghdad is UTC+3 all year. */
export function baghdadHour(now: number): number {
  return (new Date(now).getUTCHours() + 3) % 24;
}

/** Whether `now` falls in the quiet hours [from, to), which may wrap past midnight (e.g. 1 → 8, or 23 → 7). */
export function inQuietHours(quiet: { from: number | null; to: number | null } | null | undefined, now: number): boolean {
  if (!quiet || quiet.from === null || quiet.to === null || quiet.from === quiet.to) return false;
  const h = baghdadHour(now);
  return quiet.from < quiet.to ? h >= quiet.from && h < quiet.to : h >= quiet.from || h < quiet.to;
}

function wholeWithin(v: unknown, range: { min: number; max: number }): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= range.min && v <= range.max ? v : null;
}

/** The settings form as a clean choice, or null when any part of it is not allowed. Nothing is repaired silently. */
export function parseAutopilot(input: unknown): AutopilotChoice | null {
  if (!input || typeof input !== "object") return null;
  const r = input as { mode?: unknown; targets?: unknown; dailyMax?: unknown; minGapMin?: unknown; quietFrom?: unknown; quietTo?: unknown };
  if (!isAutoMode(r.mode)) return null;
  if (!Array.isArray(r.targets) || r.targets.length > AUTO_TARGETS.length) return null;
  const asked = r.targets;
  if (!asked.every((t) => (AUTO_TARGETS as readonly unknown[]).includes(t))) return null;
  const dailyMax = wholeWithin(r.dailyMax, AUTO_DAILY_MAX);
  const minGapMin = wholeWithin(r.minGapMin, AUTO_MIN_GAP);
  if (dailyMax === null || minGapMin === null) return null;
  // Quiet hours: both empty (none), or two whole hours 0–23 that differ.
  let quiet: AutopilotChoice["quiet"] = null;
  const unset = (v: unknown) => v === null || v === undefined || v === "";
  if (!unset(r.quietFrom) || !unset(r.quietTo)) {
    const from = wholeWithin(r.quietFrom, { min: 0, max: 23 });
    const to = wholeWithin(r.quietTo, { min: 0, max: 23 });
    if (from === null || to === null || from === to) return null;
    quiet = { from, to };
  }
  return { mode: r.mode, targets: AUTO_TARGETS.filter((t) => asked.includes(t)), dailyMax, minGapMin, quiet };
}
