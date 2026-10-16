import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { profileEnabled, sanitizePatch, type Interview } from "@/lib/shop/profile";
import { requireWorkspace } from "../data";
import { SetupClient, type SetupInitial } from "./setup-client";

export const dynamic = "force-dynamic";

/** The setup interview: a few short screens about the owner's work. Off (a plain 404) until BUSINESS_PROFILE_ENABLED=1. */
export default async function SetupPage({ searchParams }: { searchParams: Promise<{ store?: string; error?: string }> }) {
  if (!profileEnabled()) notFound();
  const ws = await requireWorkspace("/app/setup");
  const t = dict(await getLang());
  if (ws.kind !== "MERCHANT" || !can(ws.role, "configure")) return <p className="gm-note warn">{t.nr.team.roles.notAllowed}</p>;

  const sp = await searchParams;
  // A connection that failed on the way here: Settings shows what went wrong.
  if (sp.error) redirect(`/app/settings?error=${encodeURIComponent(sp.error)}`);
  const stores = await db.store.findMany({ where: { tenantId: ws.id }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, igUsername: true, deliveryCityFees: true } });
  // The store asked for, else the first one whose interview is not finished.
  const profiles = await db.businessProfile.findMany({ where: { storeId: { in: stores.map((s) => s.id) } } }).catch(() => []);
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
    language: clean.language ?? null,
    tone: clean.tone ?? null,
    facts: clean.facts ?? [],
    finished: done(store.id),
    confirmedBefore: (clean.facts ?? []).filter((f) => f.on).map((f) => `${f.k}:${f.v}`),
  };
  // Back to the screen the owner left on (a finished interview starts again from the first, to change an answer).
  const savedStep = (row?.interview as { step?: unknown } | undefined)?.step;
  const initialStep = !initial.finished && typeof savedStep === "number" && Number.isInteger(savedStep) ? Math.max(0, Math.min(savedStep, 3)) : 0;

  return <SetupClient key={store.id} storeId={store.id} storeName={store.name || (store.igUsername ? `@${store.igUsername}` : "")} initial={initial} initialStep={initialStep} />;
}
