"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { mergeFacts, profileEnabled, sanitizePatch } from "@/lib/shop/profile-shared";
import { currentWorkspace } from "@/app/app/data";

export type SetupResult = { ok: true; dropped?: string[] } | { ok: false; error: string };

/** The signed-in shop workspace's own store, for roles that may configure; nothing at all while the interview is switched off. */
async function ownedStore(storeId: unknown) {
  const [ws, t] = await Promise.all([currentWorkspace(), getLang().then(dict)]);
  if (!ws) return { error: t.actions.common.signIn } as const;
  if (ws.kind !== "MERCHANT" || !can(ws.role, "configure") || !profileEnabled()) return { error: t.nr.team.roles.notAllowed } as const;
  if (typeof storeId !== "string" || !storeId) return { error: t.actions.automation.storeNotFound } as const;
  const store = await db.store.findFirst({ where: { id: storeId, tenantId: ws.id }, select: { id: true } });
  if (!store) return { error: t.actions.automation.storeNotFound } as const;
  return { store, t } as const;
}

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 20) : []);
/** Saves one screen of the interview: only the fields it sends, and where the owner got to. A skipped screen saves nothing else. */
export async function saveProfileStepAction(storeId: string, patch: unknown, meta: { step: string; index: number; skipped: boolean }): Promise<SetupResult> {
  const r = await ownedStore(storeId);
  if (r.error !== undefined) return { ok: false, error: r.error };
  const id = r.store.id;
  try {
    const sent = meta.skipped ? {} : sanitizePatch(patch);
    const row = await db.businessProfile.findUnique({ where: { storeId: id }, select: { interview: true, facts: true } });
    const iv = (row?.interview && typeof row.interview === "object" ? row.interview : {}) as Record<string, unknown>;
    const name = String(meta.step).slice(0, 20);
    const answered = new Set(strs(iv.answered));
    const skipped = new Set(strs(iv.skipped));
    if (meta.skipped) {
      skipped.add(name);
      answered.delete(name);
    } else {
      answered.add(name);
      skipped.delete(name);
    }
    const interview = { ...iv, step: Math.max(0, Math.min(20, Math.trunc(Number(meta.index) + 1) || 0)), answered: [...answered], skipped: [...skipped] } as Prisma.InputJsonObject;
    const { facts, ...rest } = sent;
    const merged = facts ? mergeFacts(sanitizePatch({ facts: row?.facts }).facts ?? [], facts) : undefined;
    const fields = { ...rest, ...(merged ? { facts: merged as unknown as Prisma.InputJsonArray } : {}), interview };
    await db.businessProfile.upsert({ where: { storeId: id }, create: { storeId: id, ...fields }, update: fields });
    // A typed fact the server refused (a link, a phone number, a fourth one) is reported, not dropped silently.
    const asked = !meta.skipped && patch && typeof patch === "object" ? (patch as { facts?: unknown }).facts : undefined;
    const dropped = Array.isArray(asked)
      ? asked.filter((f): f is { k: string; v: string } => !!f && (f as { k?: unknown }).k === "custom" && typeof (f as { v?: unknown }).v === "string").map((f) => f.v).filter((v) => !merged?.some((m) => m.k === "custom" && m.v === v.trim()))
      : [];
    // The same for the offer line and the goal: a link or a phone number in them is refused, and the owner is told.
    const rawPatch = !meta.skipped && patch && typeof patch === "object" ? (patch as Record<string, unknown>) : {};
    const refusedLines = (["offerLine", "goalText"] as const)
      .filter((k) => typeof rawPatch[k] === "string" && (rawPatch[k] as string).trim() && (sent as Record<string, unknown>)[k] == null)
      .map((k) => (rawPatch[k] as string).trim().slice(0, 60));
    const all = [...dropped, ...refusedLines];
    return { ok: true, dropped: all.length ? all.slice(0, 5) : undefined };
  } catch (e) {
    console.error("[setup] save failed:", e instanceof Error ? e.message.slice(0, 80) : "unknown error");
    return { ok: false, error: r.t.common.error };
  }
}

/** The owner confirmed the last screen: the facts they left switched on may now be told to buyers. */
export async function finishInterviewAction(storeId: string, facts: unknown): Promise<SetupResult> {
  const r = await ownedStore(storeId);
  if (r.error !== undefined) return { ok: false, error: r.error };
  const id = r.store.id;
  try {
    const clean = sanitizePatch({ facts }).facts ?? [];
    const row = await db.businessProfile.findUnique({ where: { storeId: id }, select: { interview: true } });
    const iv = (row?.interview && typeof row.interview === "object" ? row.interview : {}) as Record<string, unknown>;
    const interview = { ...iv, doneAt: new Date().toISOString() } as Prisma.InputJsonObject;
    const fields = { facts: clean as unknown as Prisma.InputJsonArray, interview };
    await db.businessProfile.upsert({ where: { storeId: id }, create: { storeId: id, ...fields }, update: fields });
    revalidatePath("/app");
    return { ok: true };
  } catch (e) {
    console.error("[setup] finish failed:", e instanceof Error ? e.message.slice(0, 80) : "unknown error");
    return { ok: false, error: r.t.common.error };
  }
}
