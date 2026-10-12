import { cityFees } from "@/lib/shop/compose";
import type { loadShopState } from "@/lib/shop/state";
import type { StoreView } from "./shared";

type Store = NonNullable<Awaited<ReturnType<typeof loadShopState>>["store"]>;

/** A store's settings as the Auto replies and Auto posts screens edit them. */
export function storeView(store: Store): StoreView {
  return {
    id: store.id,
    automationEnabled: store.automationEnabled,
    expiryDays: store.expiryDays,
    stopBefore: store.stopBefore ? new Date(store.stopBefore.getTime() + 3 * 3_600_000).toISOString().slice(0, 10) : "",
    likeComments: store.likeComments,
    autoHideSpam: store.autoHideSpam,
    deliveryFee: store.deliveryFeeMinor == null ? "" : String(store.deliveryFeeMinor),
    deliveryTime: store.deliveryTime ?? "",
    cityFees: Object.fromEntries(Object.entries(cityFees(store)).map(([k, v]) => [k, String(v)])),
    autoMode: store.autoMode,
    autoPerDay: store.autoPerDay,
    aiReplies: store.aiReplies,
    aiBrief: store.aiBrief ?? "",
    defaultDm: store.defaultDm ?? "",
    defaultTemplateId: store.defaultTemplateId,
    pausedReason: store.pausedReason,
    webhooksAt: store.webhooksAt ? store.webhooksAt.toISOString() : null,
  };
}
