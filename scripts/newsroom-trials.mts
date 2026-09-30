// Give every existing newsroom that has no trial and no running paid plan a 14-day free trial
// starting now, and print how many. New newsrooms get theirs automatically (setupNewsDesk).
// Safe to re-run: a newsroom that already has a trial date is left alone.
// Run it once, after the schema change is applied:
//   npx tsx --env-file=.env --env-file=.env.local scripts/newsroom-trials.mts
import { db } from "../src/lib/db";
import { trialEndsAtFrom } from "../src/lib/billing/trial";

const now = new Date();
const { count } = await db.tenant.updateMany({
  where: {
    kind: "NEWS",
    trialEndsAt: null,
    OR: [{ planPaidUntil: null }, { planPaidUntil: { lte: now } }],
  },
  data: { trialEndsAt: trialEndsAtFrom(now) },
});
console.log(`newsrooms given a ${trialEndsAtFrom(now).toISOString().slice(0, 10)} trial end: ${count}`);
await db.$disconnect();
