// After a change is made, the chat reads it back from the live data and says whether it is what was asked. A tool with no check
// here simply has none; a check that cannot run says nothing (it never says "checked" without having looked).

import type { ToolCtx, VerifyFn, VerifyReport, WriteTool } from "../types";
import { withTimeout } from "../util";
import { parseVerify } from "./report";

/**
 * The check of a tool in a workspace kind. A tool that both kinds share is checked only where its check was written for that kind.
 * The files are loaded when a change has been made, not with the chat's core: they reach into the shop's and the desk's own code.
 */
export async function verifierFor(kind: ToolCtx["kind"], name: string): Promise<VerifyFn | undefined> {
  if (kind === "news") return (await import("./news")).NEWS_VERIFIERS[name];
  const [shop, rules, accounts, reset, goal] = await Promise.all([import("./shop"), import("./rules"), import("./accounts"), import("./reset"), import("./goal")]);
  return shop.SHOP_VERIFIERS[name] ?? rules.RULE_VERIFIERS[name] ?? accounts.ACCOUNT_VERIFIERS[name] ?? reset.RESET_VERIFIERS[name] ?? goal.GOAL_VERIFIERS[name];
}

/** How long a check may take, and how much room the request must still have for it to start. */
export const VERIFY_BUDGET_MS = 6_000;
const MIN_ROOM_MS = 3_000;

/** CHAT_VERIFY=0 switches the read-back off (the changes themselves are not touched). */
export const verifyEnabled = (): boolean => process.env.CHAT_VERIFY?.trim() !== "0";

export interface VerifiedChange {
  text: string;
  data?: unknown;
  runId: string;
}

/**
 * Reads one finished change back. `leftMs` is the time the request has left: with too little, the check is skipped rather than
 * risking the answer. Never throws.
 */
export async function verifyChange(tool: Pick<WriteTool, "name">, ctx: ToolCtx, args: unknown, done: VerifiedChange, leftMs: number): Promise<VerifyReport | undefined> {
  if (!verifyEnabled() || leftMs < MIN_ROOM_MS + 1_000) return undefined;
  try {
    const fn = await verifierFor(ctx.kind, tool.name);
    if (!fn) return undefined;
    return parseVerify(await withTimeout(fn(ctx, args, done), Math.min(VERIFY_BUDGET_MS, leftMs - MIN_ROOM_MS)));
  } catch (e) {
    console.error("[chat] verify failed:", tool.name, e instanceof Error ? e.name : "unknown");
    return undefined;
  }
}

/** What the model is told about a report (English, one object). */
export function verifyForModel(v: VerifyReport): Record<string, unknown> {
  return v.status === "ok"
    ? { status: "ok", checked: v.checked }
    : {
        status: "problem",
        problems: v.problems,
        ...(v.fix ? { fix: v.fix } : {}),
        note: "The change was read back from the live data and something is not as asked. Say this plainly to the owner in one or two sentences, and propose the fix as a card. Never say it is fine.",
      };
}
