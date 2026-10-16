import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { profileEnabled, sanitizePatch, type Interview } from "@/lib/shop/profile";
import { requireWorkspace } from "../data";
import { SetupClient, type SetupInitial } from "./setup-client";

export const dynamic = "force-dynamic";

/** The setup interview: a few short screens about the owner's work. Off (a plain 404) until BUSINESS_PROFILE_ENABLED=1. */
export default async function SetupPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  if (!profileEnabled()) notFound();
  const ws = await requireWorkspace("/app/setup");
  const t = dict(await getLang());
  if (ws.kind !== "MERCHANT" || !can(ws.role, "configure")) return <p className="gm-note warn">{t.nr.team.roles.notAllowed}</p>;

  const sp = await searchParams;
  const stores = await db.store.findMany({ where: { tenantId: ws.id }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, igUsername: true, deliveryCityFees: true } });
  // The store asked for, else the first one whose interview is not finished.
  const profiles = await db.businessProfile.findMany({ where: { storeId: { in: stores.map((s) => s.id) } } });
  const done = (id: string) => {
    const iv = profiles.find((p) => p.storeId === id)?.interview as Interview | undefined;
    return !!iv?.doneAt;
  };
  const store = stores.find((s) => s.id === sp.store) ?? stores.find((s) => !done(s.id)) ?? stores[0];
  if (!store) {
    return (
      <div className="gm-empty">
        <b className="kufi">{t.setup.noStoreTitle}</b>
        {t.setup.noStoreBody}{" "}
        <Link href="/app/settings" className="gm-link">
          {t.setup.noStoreLink}
        </Link>
      </div>
    );
  }

  const row = profiles.find((p) => p.storeId === store.id);
  const clean = sanitizePatch({ goal: row?.goal, goalText: row?.goalText, category: row?.category, offerLine: row?.offerLine, customer: row?.customer, sellsTo: row?.sellsTo, language: row?.language, tone: row?.tone, facts: row?.facts });
  // Cities the owner already set delivery fees for are ticked from the start.
  const feeCities = store.deliveryCityFees && typeof store.deliveryCityFees === "object" ? Object.keys(store.deliveryCityFees as Record<string, unknown>) : [];
  const initial: SetupInitial = {
    goal: clean.goal ?? null,
    goalText: clean.goalText ?? "",
    category: clean.category ?? null,
    offerLine: clean.offerLine ?? "",
    customer: clean.customer ?? [],
    sellsTo: (clean.sellsTo && clean.sellsTo.length ? clean.sellsTo : sanitizePatch({ sellsTo: feeCities }).sellsTo) ?? [],
    language: clean.language ?? "ckb",
    tone: clean.tone ?? null,
    facts: clean.facts ?? [],
    finished: done(store.id),
  };

  return <SetupClient key={store.id} storeId={store.id} storeName={store.name || (store.igUsername ? `@${store.igUsername}` : "")} initial={initial} />;
}
