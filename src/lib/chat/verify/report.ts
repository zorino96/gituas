// The shape of a check's report, read safely from stored JSON. Pure (no database), so the server and the screen share it.

import type { VerifyReport } from "../types";

const MAX_LINES = 6;
const MAX_PROBLEMS = 4;

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  if (!t) return null;
  const chars = Array.from(t);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : t;
};

const lines = (v: unknown, max: number, cap: number): string[] => (Array.isArray(v) ? v.map((x) => text(x, cap)).filter((x): x is string => !!x).slice(0, max) : []);

/**
 * A report as it may be stored and shown: short lines, a status that follows the problems (a report with a problem is a problem,
 * whatever it says), and nothing at all when there is nothing to show. Anything else is dropped, never guessed.
 */
export function parseVerify(v: unknown): VerifyReport | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const checked = lines(o.checked, MAX_LINES, 160);
  const problems = lines(o.problems, MAX_PROBLEMS, 220);
  if (!problems.length && !checked.length) return undefined;
  const fix = text(o.fix, 400);
  return { status: problems.length ? "problem" : "ok", checked, problems, ...(problems.length && fix ? { fix } : {}) };
}
