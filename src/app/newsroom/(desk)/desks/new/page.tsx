import { auth } from "@/auth";
import { db } from "@/lib/db";
import { deskLimit } from "@/lib/billing/plans";
import { dict, getLang } from "@/lib/i18n";
import { NewDeskForm } from "./new-desk-form";

export default async function NewDeskPage() {
  const session = await auth();
  const owned = await db.tenant.findMany({
    where: { ownerId: session!.user!.id!, kind: "NEWS", kindChosen: true },
    select: { plan: true },
  });
  const limit = deskLimit(owned.map((o) => o.plan));
  const t = dict(await getLang()).nr.shell.newDesk;
  return (
    <div className="gm-stack gm-narrow">
      <h2 className="gm-title kufi">{t.title}</h2>
      <p className="gm-sub" style={{ margin: 0 }}>
        {t.sub}
      </p>
      {owned.length >= limit ? <p className="gm-note">{t.full(limit)}</p> : <NewDeskForm />}
    </div>
  );
}
