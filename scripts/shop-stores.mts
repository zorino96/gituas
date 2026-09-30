// Create or link a Store for every connected Page / Instagram account of merchant
// workspaces, and subscribe each to webhooks. Safe to re-run.
// Run: npx tsx --env-file=.env --env-file=.env.local scripts/shop-stores.mts
import { db } from "../src/lib/db";
import { connectStore } from "../src/lib/shop/store";

const creds = await db.oAuthCredential.findMany({
  where: { provider: { in: ["META_FACEBOOK", "META_INSTAGRAM"] }, tenant: { kind: "MERCHANT" } },
  select: { tenantId: true, provider: true, providerAccountId: true, providerAccountName: true },
  orderBy: { updatedAt: "asc" }, // oldest first, so the newest connection ends up owning each account
});
let linked = 0;
for (const c of creds) {
  if (c.provider === "META_FACEBOOK" && c.providerAccountId.startsWith("act_")) continue;
  const id = await connectStore(c.tenantId, c.provider as "META_FACEBOOK" | "META_INSTAGRAM", c.providerAccountId, c.providerAccountName ?? "");
  if (id) linked++;
}
const stores = await db.store.findMany({ select: { id: true, name: true, fbPageId: true, igUserId: true, webhooksAt: true, automationEnabled: true } });
console.log(`credentials: ${creds.length}, linked: ${linked}`);
for (const s of stores) console.log(`${s.id}  ${s.name}  fb=${s.fbPageId ?? "-"}  ig=${s.igUserId ?? "-"}  webhooks=${s.webhooksAt ? "yes" : "NO"}  on=${s.automationEnabled}`);
await db.$disconnect();
