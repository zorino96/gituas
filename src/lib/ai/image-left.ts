import { limitsOf } from "@/lib/shop/tenant-plans";
import { IMAGE_SLOTS, slotsUsed } from "./slots";

/** How many AI pictures a workspace has left this month and today (for the composer's hint). */
export async function imagesLeft(tenantId: string): Promise<{ month: number; day: number }> {
  const [limits, used] = await Promise.all([limitsOf(tenantId), slotsUsed(tenantId, IMAGE_SLOTS)]);
  const month = Math.max(0, limits.images - used.month);
  // Today's number is never more than the month has left.
  return { month, day: Math.min(month, Math.max(0, limits.imagesPerDay - used.day)) };
}
