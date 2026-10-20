// Read-back of set_business_goal: the groups the owner has now hold the goal that was saved. Read-only, scoped by the workspace.

import { db } from "@/lib/db";
import { say } from "../tools/writes-common";
import type { VerifyFn } from "../types";

const OK = say(
  (n: number) => `ئامانجەکە لە ${n} گروپدا نووسراوە.`,
  (n: number) => `الهدف محفوظ في ${n} من المجموعات.`,
  (n: number) => `The goal is saved in ${n} ${n === 1 ? "group" : "groups"}.`,
);
const BAD = say(
  (n: number) => `ئامانجەکە لە ${n} گروپدا نەنووسراوە.`,
  (n: number) => `لم يُحفظ الهدف في ${n} من المجموعات.`,
  (n: number) => `The goal is not saved in ${n} ${n === 1 ? "group" : "groups"}.`,
);

const setBusinessGoal: VerifyFn = async (ctx, args) => {
  const goal = args && typeof args === "object" ? (args as { goal?: unknown }).goal : null;
  if (typeof goal !== "string") return null;
  const rows = await db.businessProfile.findMany({ where: { store: { tenantId: ctx.tenantId } }, select: { goal: true, storeId: true }, take: 30 });
  const right = rows.filter((r) => r.goal === goal).length;
  if (right) return { status: "ok", checked: [OK[ctx.lang](right)], problems: [] };
  return {
    status: "problem",
    checked: [],
    problems: [BAD[ctx.lang](Math.max(1, rows.length))],
    fix: "The goal was not saved. Call set_business_goal again; if it fails twice, tell the owner.",
  };
};

export const GOAL_VERIFIERS: Record<string, VerifyFn> = { set_business_goal: setBusinessGoal };
