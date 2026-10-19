// A live check of the whole chat (the real model, the real tools, the real database) for the owner's CRON_SECRET-guarded health
// route: a throwaway workspace asks one question, the turn is summarised, and everything it made is deleted. The workspace is on the
// default autonomy (ASK), so a write the model proposes stays a proposal and never runs. Only shapes and short texts are returned.

import { db } from "@/lib/db";
import type { Lang } from "@/lib/i18n/lang";
import { loadMessages, runsOfThread } from "./store";
import { executeChatRequest } from "./turn";
import type { ChatEvent } from "./types";

export async function chatProbe(text: string, lang: Lang = "en"): Promise<Record<string, unknown>> {
  // A probe cut off by the function limit leaves its throwaway workspace behind: the next one clears what is over an hour old.
  const old = await db.tenant.findMany({ where: { slug: { startsWith: "probe" }, name: { startsWith: "probe" }, createdAt: { lt: new Date(Date.now() - 3_600_000) } }, select: { id: true, ownerId: true } });
  for (const t of old) {
    await db.tenant.delete({ where: { id: t.id } }).catch(() => undefined);
    await db.usage.deleteMany({ where: { tenantId: t.id } }).catch(() => undefined);
    await db.user.deleteMany({ where: { id: t.ownerId, email: { endsWith: "@example.invalid" } } }).catch(() => undefined);
  }
  const tag = `probe${Date.now().toString(36)}`;
  const user = await db.user.create({ data: { email: `${tag}@example.invalid`, name: "chat probe" } });
  const tenant = await db.tenant.create({ data: { name: tag, slug: tag, ownerId: user.id, kind: "MERCHANT", kindChosen: true, unlimited: true } });
  try {
    await db.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: "OWNER" } });
    await db.store.create({ data: { tenantId: tenant.id, name: `${tag} shop`, plan: "UNLIMITED" } });
    const events: ChatEvent[] = [];
    const t0 = Date.now();
    await executeChatRequest({ tenantId: tenant.id, userId: user.id, role: "OWNER", kind: "shop", lang }, { workspaceId: tenant.id, text }, (e) => events.push(e));
    const thread = events.find((e) => e.t === "thread") as { id: string } | undefined;
    const rows = thread ? await loadMessages(thread.id) : [];
    const runs = thread ? await runsOfThread(thread.id) : [];
    const calls = rows.flatMap((m) => (Array.isArray(m.toolCalls) ? (m.toolCalls as { name: string }[]).map((c) => c.name) : []));
    const answers = rows.filter((m) => m.role === "assistant" && m.content);
    return {
      ms: Date.now() - t0,
      events: events.map((e) => e.t),
      error: (events.find((e) => e.t === "error") as { code?: string } | undefined)?.code ?? null,
      toolCalls: calls,
      toolErrors: rows.filter((m) => m.role === "tool" && m.content.startsWith('{"error"')).map((m) => m.content.slice(0, 160)),
      runs: runs.map((r) => ({ tool: r.tool, risk: r.risk, status: r.status })),
      models: [...new Set(rows.map((m) => (m.meta as { model?: string } | null)?.model).filter(Boolean))],
      answer: answers.at(-1)?.content.slice(0, 400) ?? null,
    };
  } finally {
    await db.tenant.delete({ where: { id: tenant.id } }).catch(() => undefined);
    await db.usage.deleteMany({ where: { tenantId: tenant.id } }).catch(() => undefined);
    await db.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }
}
