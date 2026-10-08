import { db } from "@/lib/db";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { accountFor } from "@/lib/shop/meta-client";
import { listTemplates, WA_APP_ID, WA_CONFIG_ID, WA_GRAPH, type WaTemplate } from "@/lib/whatsapp/cloud";
import { mediaToken } from "@/lib/whatsapp/webhook";
import { currentWorkspace } from "../data";
import { WhatsAppClient, type WaChat, type WaLine } from "./whatsapp-client";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
/** Chats shown: the last 30 days of WhatsApp messages. */
const SINCE_DAYS = 30;

export default async function WhatsAppPage() {
  const ws = (await currentWorkspace())!;
  const t = dict(await getLang());
  if (ws.kind !== "MERCHANT") return <p className="gm-note warn">{t.wa.shopOnly}</p>;
  if (!can(ws.role, "engage")) return <p className="gm-note warn">{t.nr.team.roles.notAllowed}</p>;

  const store = await db.store.findFirst({
    where: { tenantId: ws.id, waPhoneNumberId: { not: null } },
    select: { id: true, tenantId: true, fbPageId: true, igUserId: true, waPhoneNumberId: true, waBusinessId: true, waDisplayPhone: true },
  });

  let chats: WaChat[] = [];
  let templates: WaTemplate[] | null = [];
  let verifiedName = "";
  if (store) {
    const since = new Date(Date.now() - SINCE_DAYS * DAY);
    const [rows, jobs, acc, cred] = await Promise.all([
      db.conversationMessage.findMany({
        where: { storeId: store.id, platform: "WHATSAPP", createdAt: { gt: since } },
        orderBy: { createdAt: "asc" },
        take: 3000,
        select: { id: true, direction: true, content: true, authorId: true, authorName: true, createdAt: true },
      }),
      db.outboxJob.findMany({
        where: { storeId: store.id, status: "SENT", kind: { in: ["DM_ANSWER", "DM_PHOTOS"] }, message: { platform: "WHATSAPP" }, updatedAt: { gt: since } },
        select: { id: true, kind: true, payload: true, recipientId: true, updatedAt: true },
      }),
      accountFor(store, "WHATSAPP"),
      db.oAuthCredential.findFirst({ where: { tenantId: ws.id, provider: "META_WHATSAPP", providerAccountId: store.waPhoneNumberId! }, select: { providerAccountName: true } }),
    ]);
    verifiedName = cred?.providerAccountName ?? "";

    const label = (text: string): string => {
      const m = mediaToken(text);
      if (m) return [t.wa.media[m.type], m.caption].filter(Boolean).join(" · ");
      return text.startsWith("[template] ") ? `📋 ${text.slice("[template] ".length)}` : text;
    };
    const byChat = new Map<string, WaChat>();
    const chat = (id: string): WaChat => {
      let c = byChat.get(id);
      if (!c) byChat.set(id, (c = { id, name: null, lines: [], lastInboundAt: null }));
      return c;
    };
    for (const r of rows) {
      if (!r.authorId) continue;
      const c = chat(r.authorId);
      const inbound = r.direction === "INBOUND";
      if (inbound) {
        c.name = r.authorName ?? c.name;
        c.lastInboundAt = r.createdAt.toISOString();
      }
      c.lines.push({ id: r.id, from: inbound ? "them" : "you", text: label(r.content ?? ""), at: r.createdAt.toISOString() });
    }
    for (const j of jobs) {
      if (!j.recipientId) continue;
      const p = j.payload as { message?: { text?: string }; urls?: string[] };
      const text = j.kind === "DM_ANSWER" ? (p.message?.text ?? "") : `${t.wa.media.image} × ${p.urls?.length ?? 0}`;
      chat(j.recipientId).lines.push({ id: j.id, from: "bot", text, at: j.updatedAt.toISOString() });
    }
    chats = [...byChat.values()]
      .map((c) => ({ ...c, lines: c.lines.sort((a: WaLine, b: WaLine) => a.at.localeCompare(b.at)) }))
      .sort((a, b) => b.lines[b.lines.length - 1].at.localeCompare(a.lines[a.lines.length - 1].at))
      .slice(0, 100);

    if (acc && store.waBusinessId) {
      const r = await listTemplates(store.waBusinessId, acc.token);
      templates = r.ok ? r.templates : null;
    } else {
      templates = null;
    }
  }

  return (
    <WhatsAppClient
      connected={store ? { phone: store.waDisplayPhone ?? "", name: verifiedName } : null}
      canConfigure={can(ws.role, "configure")}
      sdk={WA_CONFIG_ID ? { appId: WA_APP_ID, configId: WA_CONFIG_ID, version: WA_GRAPH } : null}
      chats={chats}
      templates={templates}
    />
  );
}
