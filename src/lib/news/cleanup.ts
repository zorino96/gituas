// Daily clean-up of news items no desk used. Feeds stop listing a story long before 30 days, so
// an old item without a draft is never needed again; deleting it keeps the database small (the
// free plan has 500 MB). Items with a draft stay: deleting one would take its draft with it.

import { db } from "@/lib/db";

export const NEWS_ITEM_KEEP_DAYS = 30;

export async function pruneNewsItems(now = Date.now()): Promise<number> {
  const r = await db.newsItem.deleteMany({
    where: { createdAt: { lt: new Date(now - NEWS_ITEM_KEEP_DAYS * 86_400_000) }, draft: { is: null } },
  });
  return r.count;
}
