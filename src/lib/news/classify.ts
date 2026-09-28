import { db } from "@/lib/db";
import { completeJson } from "@/lib/ai/provider";
import { parseClassification, REGIONS, TAXONOMY, type Classification } from "./taxonomy";

const BATCH = 20;
/** Per ingest run; the rest wait for the next run, newest first. */
const PER_RUN = 60;

export function classifyPrompt(items: { title: string; snippet: string }[]): { system: string; user: string } {
  const cats = TAXONOMY.map((c) => `- ${c.id}${c.subs.length ? ` (${c.subs.map((s) => s.id).join(", ")})` : ""}`).join("\n");
  return {
    system: `You sort news headlines for a newsroom in the Kurdistan Region of Iraq.
For each numbered item give its category, a subcategory if one fits, and its region.
Categories, with subcategories in brackets:
${cats}
Regions: ${REGIONS.map((r) => r.id).join(", ")}.
- kurdistan: the Kurdistan Region of Iraq and Kurdish affairs anywhere.
- iraq: the rest of Iraq.
- region: other Middle East countries.
- world: everything else.
Reply with JSON only, one entry per item, the same "i":
{"items":[{"i":0,"category":"economy","subcategory":"energy","region":"kurdistan"}]}
Use null for subcategory when none fits.`,
    user: items.map((it, i) => `${i}. ${it.title}${it.snippet ? ` — ${it.snippet.slice(0, 160)}` : ""}`).join("\n"),
  };
}

/** The AI's reply → one classification per input; entries it skipped become "other". Null if nothing usable. */
export function parseBatch(data: unknown, n: number): Classification[] | null {
  const arr = (data as { items?: unknown } | null)?.items;
  if (!Array.isArray(arr)) return null;
  const out: (Classification | null)[] = Array.from({ length: n }, () => null);
  for (const e of arr) {
    const i = (e as { i?: unknown } | null)?.i;
    if (typeof i === "number" && Number.isInteger(i) && i >= 0 && i < n) out[i] = parseClassification(e);
  }
  if (!out.some(Boolean)) return null;
  return out.map((c) => c ?? { category: "other", subcategory: null, region: "world" });
}

/** Classify a desk's newest unclassified stories, a few batches per run. Never throws. */
export async function classifyPending(tenantId: string): Promise<number> {
  const items = await db.newsItem.findMany({
    where: { tenantId, category: null },
    orderBy: { publishedAt: "desc" },
    take: PER_RUN,
    select: { id: true, title: true, snippet: true },
  });
  const batches: (typeof items)[] = [];
  for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH));
  const counts = await Promise.all(
    batches.map(async (b) => {
      try {
        const { system, user } = classifyPrompt(b);
        const { data } = await completeJson({ system, user, strength: "fast" }, (d) => parseBatch(d, b.length));
        await Promise.all(data.map((c, i) => db.newsItem.updateMany({ where: { id: b[i].id }, data: c })));
        return b.length;
      } catch (e) {
        console.error("[news] classify failed:", e instanceof Error ? e.message : "unknown error");
        return 0;
      }
    }),
  );
  return counts.reduce((a, b) => a + b, 0);
}
