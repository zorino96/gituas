import { db } from "@/lib/db";
import type { ShopPlatform } from "./meta-client";

/** The merchant answered this thread by hand: automation stays out of it from now on. */
export async function pauseThread(tenantId: string, platform: ShopPlatform, threadKey: string): Promise<void> {
  await db.threadPause.upsert({
    where: { tenantId_platform_threadKey: { tenantId, platform, threadKey } },
    create: { tenantId, platform, threadKey },
    update: {},
  });
}
