"use server";

import { db } from "@/lib/db";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { loadAutopilotSignals, ordersByPost } from "@/lib/orders/audience";
import { cityHashtags, mergeSuggestions, productHashtags, workedHashtags } from "@/lib/orders/hashtags";
import { fetchIgPosts } from "@/lib/publishers/instagram-audience";
import { currentWorkspace } from "../data";

/**
 * Hashtags for the post being written: the product's own (AI), the ones on the shop's Instagram
 * posts that brought comments and orders, and its buyers' cities in both scripts.
 */
export async function suggestHashtagsAction(productId: string | null): Promise<{ ok: true; tags: string[] } | { ok: false; error: string }> {
  const [ws, t] = await Promise.all([currentWorkspace(), getLang().then(dict)]);
  if (!ws) return { ok: false, error: t.actions.common.signIn };
  if (ws.kind !== "MERCHANT" || !can(ws.role, "publish")) return { ok: false, error: t.nr.team.roles.notAllowed };
  const product = productId ? await db.product.findFirst({ where: { id: productId, store: { tenantId: ws.id } }, select: { name: true, description: true } }) : null;
  const [signals, posts, fromProduct] = await Promise.all([
    loadAutopilotSignals(ws.id),
    fetchIgPosts(ws.id),
    product ? productHashtags(product.name, product.description) : Promise.resolve([]),
  ]);
  const perPost = await ordersByPost(ws.id, posts.map((p) => p.id));
  return { ok: true, tags: mergeSuggestions(fromProduct, workedHashtags(posts, perPost), cityHashtags(signals.cities)) };
}
