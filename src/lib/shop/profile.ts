// The server half of the business profile: reading a store's row. The rest (ids, checks, sentences, prompt lines) is in
// ./profile-shared.ts so the setup screen in the browser can use it without the database.
import { db } from "@/lib/db";
import { profileEnabled, sanitizePatch, type Profile } from "./profile-shared";

export * from "./profile-shared";

/** A row as the code uses it (Json columns checked, nothing trusted). */
function fromRow(row: {
  storeId: string; goal: string | null; goalText: string | null; category: string | null; offerLine: string | null; customer: string[]; sellsTo: string[];
  language: string | null; tone: string | null; facts: unknown; interview: unknown;
}): Profile {
  const patch = sanitizePatch({ goal: row.goal, goalText: row.goalText, category: row.category, offerLine: row.offerLine, customer: row.customer, sellsTo: row.sellsTo, language: row.language, tone: row.tone, facts: row.facts });
  const iv = (row.interview && typeof row.interview === "object" ? row.interview : {}) as Record<string, unknown>;
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 20) : []);
  return {
    storeId: row.storeId,
    goal: patch.goal ?? null,
    goalText: patch.goalText ?? null,
    category: patch.category ?? null,
    offerLine: patch.offerLine ?? null,
    customer: patch.customer ?? [],
    sellsTo: patch.sellsTo ?? [],
    language: patch.language ?? null,
    tone: patch.tone ?? null,
    facts: patch.facts ?? [],
    interview: { step: Number.isInteger(iv.step) ? Math.max(0, Math.min(20, iv.step as number)) : 0, answered: strs(iv.answered), skipped: strs(iv.skipped), doneAt: typeof iv.doneAt === "string" ? iv.doneAt : undefined },
  };
}

/** The store's profile, or null: the switch is off, nothing was answered yet, or the table cannot be read. Never throws. */
export async function loadProfile(storeId: string): Promise<Profile | null> {
  if (!profileEnabled()) return null;
  try {
    const row = await db.businessProfile.findUnique({ where: { storeId } });
    return row ? fromRow(row) : null;
  } catch (e) {
    console.error("[profile] read failed:", e instanceof Error ? e.message.slice(0, 80) : "unknown error");
    return null;
  }
}

