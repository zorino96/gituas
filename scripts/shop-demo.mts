// Configure one store for a live test: switch automation on, add a default
// template with Sorani samples and a demo product, and optionally tag a post.
// Run: npx tsx --env-file=.env --env-file=.env.local scripts/shop-demo.mts <storeId> [platform:postId]
import { db } from "../src/lib/db";

const [storeId, postArg] = process.argv.slice(2);
if (!storeId) throw new Error("usage: shop-demo.mts <storeId> [META_FACEBOOK:<postId>|META_INSTAGRAM:<mediaId>]");

const template =
  (await db.automationTemplate.findFirst({ where: { storeId, name: "بنەڕەت" } })) ??
  (await db.automationTemplate.create({
    data: {
      storeId,
      name: "بنەڕەت",
      publicSamples: ["نامەمان بۆت نارد، سەیری نامەکانت بکە 🌷", "وردەکارییەکانمان لە نامەدا بۆت نارد 🙏"],
      thanksSamples: ["زۆر سوپاس 🌷", "دەستت خۆش بێت 🙏"],
    },
  }));
const product =
  (await db.product.findFirst({ where: { storeId, name: "بەرهەمی تاقیکردنەوە" } })) ??
  (await db.product.create({
    data: {
      storeId,
      name: "بەرهەمی تاقیکردنەوە",
      photos: [],
      variants: { create: [{ label: "M", amountMinor: 25000, position: 0 }, { label: "L", amountMinor: 27000, position: 1 }] },
    },
  }));
await db.store.update({
  where: { id: storeId },
  data: { automationEnabled: true, defaultTemplateId: template.id, deliveryFeeMinor: 5000, deliveryTime: "١-٢ ڕۆژ" },
});
if (postArg) {
  const [platform, postId] = postArg.split(":") as ["META_FACEBOOK" | "META_INSTAGRAM", string];
  const now = new Date();
  await db.postAutomation.upsert({
    where: { storeId_platform_externalPostId: { storeId, platform, externalPostId: postId } },
    create: { storeId, platform, externalPostId: postId, postCreatedAt: now, activeUntil: new Date(now.getTime() + 30 * 86_400_000), productId: product.id },
    update: { productId: product.id, enabled: true },
  });
}
console.log(`store ${storeId}: automation on, template ${template.id}, product ${product.id}${postArg ? `, tagged ${postArg}` : ""}`);
await db.$disconnect();
