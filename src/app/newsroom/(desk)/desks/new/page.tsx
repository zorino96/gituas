import { auth } from "@/auth";
import { db } from "@/lib/db";
import { num } from "@/app/app/format";
import { deskLimit } from "@/lib/billing/plans";
import { NewDeskForm } from "./new-desk-form";

export default async function NewDeskPage() {
  const session = await auth();
  const owned = await db.tenant.findMany({
    where: { ownerId: session!.user!.id!, kind: "NEWS", kindChosen: true },
    select: { plan: true },
  });
  const limit = deskLimit(owned.map((t) => t.plan));
  return (
    <div className="gm-stack">
      <h2 className="gm-title kufi">مێزی نوێ</h2>
      <p className="gm-sub" style={{ margin: 0 }}>
        مێزێکی جیا بۆ زمانێک، بەشێک یان براندێکی تری کەناڵەکەت. هەر مێزێک پەیج، سەرچاوە، براند و تیمی خۆی هەیە.
      </p>
      {owned.length >= limit ? (
        <p className="gm-note">
          پلانەکەت {num(limit)} مێزی تێدایە و هەمووی بەکارهاتووە. بۆ مێزی زیاتر پەیوەندیمان پێوە بکە.
        </p>
      ) : (
        <NewDeskForm />
      )}
    </div>
  );
}
