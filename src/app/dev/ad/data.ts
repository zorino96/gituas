// Sample data for /dev/ad: a made-up shoe shop ("پێڵاوی ئاسۆ") with made-up buyers, so the real screens can be
// filmed for an ad without any real customer's name, message or number.
import type { ComponentProps } from "react";

import type { CommentsClient } from "@/app/app/comments/comments-client";
import type { MessagesClient } from "@/app/app/messages/messages-client";
import type { OrdersClient } from "@/app/app/orders/orders-client";
import type { VideoClient } from "@/app/app/video/video-client";
import type { PublishClient } from "@/app/app/publish/publish-client";
import type { BoostClient } from "@/app/app/boost/boost-client";
import { targetingFor } from "@/lib/orders/targeting";
import { cityHashtags } from "@/lib/orders/hashtags";

export const SHOP = "پێڵاوی ئاسۆ";
const now = Date.now();
const ago = (min: number) => new Date(now - min * 60_000).toISOString();

/** A square product picture drawn as SVG (an emoji on the shop's colours). */
export function thumb(emoji: string, a: string, b: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><defs><radialGradient id="g" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient></defs><rect width="600" height="600" fill="url(#g)"/><text x="300" y="370" font-size="300" text-anchor="middle">${emoji}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
/** A product photo made with the shop's own AI picture feature (public/demo/ai-shoe.jpg). */
const SHOE = "/demo/ai-shoe.jpg";
const SHOE2 = SHOE;
const BOOT = thumb("🥾", "#e8b48a", "#5a2d12");

// ── comments ──
type CommentsProps = ComponentProps<typeof CommentsClient>;
const reply = (id: string, name: string) => ({ id, author: SHOP, text: `سڵاو ${name} گیان 🌙 وردەکارییەکانمان لە نامەدا بۆت نارد`, createdAt: ago(1), fromUs: true });
export const comments: CommentsProps = {
  initialPosts: [
    {
      platform: "IG",
      id: "p1",
      caption: "پێڵاوی وەرزشی نوێ 🔥 قەبارە ٣٩ تا ٤٤ · گەیاندن بۆ هەموو شارەکان",
      thumbUrl: SHOE,
      createdAt: ago(95),
      commentCount: 5,
      comments: [
        { platform: "IG", id: "c1", postId: "p1", author: "hevi.erbil", text: "نرخی چەندە؟", createdAt: ago(3), hidden: false, fromUs: false, replies: [reply("r1", "هێڤی")] },
        { platform: "IG", id: "c2", postId: "p1", author: "aso_duhok", text: "گەیاندن هەیە بۆ دهۆک؟", createdAt: ago(5), hidden: false, fromUs: false, replies: [reply("r2", "ئاسۆ")] },
        { platform: "IG", id: "c3", postId: "p1", author: "shno.k", text: "نرخ؟ 😍", createdAt: ago(8), hidden: false, fromUs: false, replies: [reply("r3", "شنۆ")] },
        { platform: "IG", id: "c4", postId: "p1", author: "dana_slemani", text: "قەبارەی ٤٢ ماوە؟", createdAt: ago(11), hidden: false, fromUs: false, replies: [reply("r4", "دانا")] },
      ],
    },
  ],
  errors: [],
  outcomes: { c1: { outcome: "AUTO_REPLIED", reason: null }, c2: { outcome: "AUTO_REPLIED", reason: null }, c3: { outcome: "AUTO_REPLIED", reason: null }, c4: { outcome: "AUTO_REPLIED", reason: null } },
  whatsappPath: "/w/aso",
  connected: { FB: true, IG: true },
};

export const spam: CommentsProps = {
  ...comments,
  initialPosts: [
    {
      ...comments.initialPosts[0],
      commentCount: 6,
      comments: [
        { platform: "IG", id: "s1", postId: "p1", author: "lava.k", text: "زۆر جوانە، چۆن داوای بکەم؟ ❤️", createdAt: ago(2), hidden: false, fromUs: false, replies: [reply("sr1", "لاڤا")] },
        { platform: "IG", id: "s2", postId: "p1", author: "win.money.now", text: "💰 پارە ببەرەوە، کلیک لە لینکی بایۆ بکە", createdAt: ago(4), hidden: true, fromUs: false, replies: [] },
        { platform: "IG", id: "s3", postId: "p1", author: "karwan_kirkuk", text: "گەیاندن بۆ کەرکوک هەیە؟", createdAt: ago(6), hidden: false, fromUs: false, replies: [reply("sr3", "کاروان")] },
        { platform: "IG", id: "s4", postId: "p1", author: "follow4follow.iq", text: "فۆڵۆم بکە فۆڵۆت دەکەم 🔁🔁🔁", createdAt: ago(7), hidden: true, fromUs: false, replies: [] },
      ],
    },
  ],
  outcomes: { s1: { outcome: "AUTO_REPLIED", reason: null }, s3: { outcome: "AUTO_REPLIED", reason: null } },
};

// ── messages ──
type MessagesProps = ComponentProps<typeof MessagesClient>;
export const messages: MessagesProps = {
  initial: [
    {
      platform: "FB",
      id: "m1",
      participantId: "u1",
      participantName: "ڕێژنە ئەحمەد",
      withinWindow: true,
      updatedAt: ago(1),
      messages: [
        { id: "a1", text: "سڵاو، ئەم پێڵاوە قەبارەی ٤٠ هەیە؟ نرخی چەندە؟", fromUs: false, createdAt: ago(4) },
        { id: "a2", text: "سڵاو ڕێژنە گیان 🌸 بەڵێ قەبارەی ٤٠ هەیە. نرخی ٢٧،٠٠٠ دینارە، گەیاندن بۆ هەموو شارەکان ١-٢ ڕۆژ 🚚", fromUs: true, createdAt: ago(4) },
        { id: "a3", text: "زۆر باشە، دەمەوێت 👍", fromUs: false, createdAt: ago(2) },
        { id: "a4", text: "دەستت خۆش 🌙 تکایە ناو و ژمارەی مۆبایل و شارەکەت بنووسە بۆ تۆمارکردنی داواکارییەکە", fromUs: true, createdAt: ago(1) },
      ],
    },
    {
      platform: "IG",
      id: "m2",
      participantId: "u2",
      participantName: "karwan.slemani",
      withinWindow: true,
      updatedAt: ago(6),
      messages: [
        { id: "b1", text: "🎤 دوو دانەم دەوێت، دەتوانن بینێرن بۆ سلێمانی؟", fromUs: false, createdAt: ago(7) },
        { id: "b2", text: "بەڵێ کاروان گیان، دوو دانە بۆ سلێمانی دەنێرین 🚚 ناو و ژمارەکەت بنووسە تکایە", fromUs: true, createdAt: ago(6) },
      ],
    },
    {
      platform: "IG",
      id: "m3",
      participantId: "u3",
      participantName: "shno.k",
      withinWindow: true,
      updatedAt: ago(12),
      messages: [
        { id: "c1", text: "قەبارەی ٣٨ هەیە؟", fromUs: false, createdAt: ago(13) },
        { id: "c2", text: "سڵاو شنۆ گیان، قەبارەکان ٣٩ تا ٤٤ن 🌸 دەتەوێت ٣٩ بۆت بپارێزین؟", fromUs: true, createdAt: ago(12) },
      ],
    },
  ],
  flags: {},
  orderBuyers: ["u1"],
  unreadable: 0,
  errors: [],
  whatsappPath: "/w/aso",
  connected: { FB: true, IG: true },
};

// ── orders ──
type OrdersProps = ComponentProps<typeof OrdersClient>;
const order = (id: string, name: string, city: string, variant: string, status: string, source: string, collect: string | null, phone: string | null) => ({
  id,
  customerName: name,
  phone,
  city,
  address: null,
  productId: "pr1",
  productName: "پێڵاوی وەرزشی ئێیر",
  variantLabel: variant,
  amountMinor: 27000,
  currency: "IQD",
  deliveryFeeMinor: 5000,
  cod: true,
  status,
  source,
  note: null,
  collect,
});
export const orders: OrdersProps = {
  orders: [
    order("o1", "ڕێژنە ئەحمەد", "erbil", "٤٠", "NEW", "DM", "done", "9647501112233"),
    order("o2", "کاروان عومەر", "sulaymaniyah", "٤٢ × ٢", "CONFIRMED", "DM", "done", "9647702223344"),
    order("o3", "هێڤی", "duhok", "٣٩", "NEW", "COMMENT", "confirm", "9647513334455"),
    order("o4", "دانا", "kirkuk", "٤٢", "SENT", "COMMENT", "done", "9647714445566"),
    order("o5", "لاڤا", "erbil", "٤١", "DELIVERED", "DM", "done", "9647505556677"),
  ],
  cityCards: [{ currency: "IQD", rows: [{ city: "هەولێر", count: 14, totalMinor: 378000 }, { city: "سلێمانی", count: 9, totalMinor: 243000 }, { city: "دهۆک", count: 5, totalMinor: 135000 }, { city: "کەرکوک", count: 3, totalMinor: 81000 }] }],
  products: [{ id: "pr1", name: "پێڵاوی وەرزشی ئێیر", variants: ["٣٩", "٤٠", "٤١", "٤٢"].map((label) => ({ label, amountMinor: 27000, currency: "IQD", inStock: true })) }],
  week: { orders: 31, prevOrders: 19, totals: { IQD: 837000 }, topProduct: "پێڵاوی وەرزشی ئێیر", cancelled: 1 },
};

// ── AI video ──
type VideoProps = ComponentProps<typeof VideoClient>;
export const video: VideoProps = {
  storeId: "s1",
  stores: [{ id: "s1", name: SHOP }],
  canFb: true,
  canIg: true,
  products: [{ id: "pr1", name: "پێڵاوی وەرزشی ئێیر", hasPhoto: true }],
  allowances: { LITE: { limit: 30, used: 6, left: 24 }, PRO: { limit: 4, used: 1, left: 3 } },
  auto: { mode: "PUBLISH", tier: "LITE", hour: 19 },
  jobs: [
    { id: "j1", tier: "LITE", status: "RENDERING", source: "AUTO", topic: null, productName: "پێڵاوی وەرزشی ئێیر", caption: null, videoUrl: null, error: null, createdAt: ago(2), postedAt: null, objective: "new_arrival", why: null, look: null, comments: null, orders: null },
    { id: "j2", tier: "LITE", status: "POSTED", source: "AUTO", topic: null, productName: "پێڵاوی وەرزشی ئێیر", caption: "پێڵاوی هاوینە 🔥 سووک و جوان · گەیاندن بۆ هەموو شارەکان", videoUrl: "/demo/sample.webm", error: null, createdAt: ago(1440), postedAt: ago(1400), objective: "sell_product", why: null, look: null, comments: 23, orders: 4 },
  ],
  configure: true,
  workspaceId: "dev-ad",
  today: { used: 0, max: 1 },
  aiPercent: 22,
  refs: [],
  refLimits: { images: 8, videos: 3, imageMb: 10, videoMb: 60 },
  plan: {
    objective: "new_arrival",
    why: "ئەم هەفتەیە زۆرترین پرسیار لەسەر پێڵاوی وەرزشی بووە، و لە هەولێر و سلێمانی زۆرترین داواکاری هاتووە.",
    format: "showcase",
    priceMode: "conversion",
    cta: "dm",
    urgent: false,
    product: "پێڵاوی وەرزشی ئێیر",
    boost: { worth: true, cities: ["erbil", "sulaymaniyah"], note: "" },
    source: "model",
  },
  notes: "",
};

// ── publish ──
type PublishProps = ComponentProps<typeof PublishClient>;
export const publish: PublishProps = {
  workspaceId: "dev-ad",
  accounts: { FB: SHOP, IG: "@aso.shoes", TT: "@aso.shoes", YT: SHOP },
  accountLists: { FB: [{ id: "f1", name: SHOP, avatarUrl: null }], IG: [{ id: "i1", name: "@aso.shoes", avatarUrl: null }], TT: [], YT: [] },
  products: [{ id: "pr1", name: "پێڵاوی وەرزشی ئێیر" }],
  scheduled: [
    { id: "sc1", runAt: new Date(now + 15 * 3_600_000).toISOString(), caption: "کۆلێکشنی نوێی هاوین 🔥", targets: ["FB", "IG"], status: "PENDING", lastError: null },
    { id: "sc2", runAt: new Date(now + 39 * 3_600_000).toISOString(), caption: "داشکاندنی کۆتایی هەفتە", targets: ["FB", "IG"], status: "PENDING", lastError: null },
  ],
  ai: { storeId: "s1", paid: true, image: { on: true, configured: true, month: 6, day: 3 }, video: null, productStores: { pr1: "s1" } },
};
export const publishReady: PublishProps = {
  ...publish,
  initial: {
    productId: "pr1",
    caption: "پێڵاوی وەرزشی نوێ 🔥 سووک و جوان، قەبارە ٣٩ تا ٤٤\nگەیاندن بۆ هەموو شارەکان 🚚 بۆ داواکردن نامە بنێرە",
    media: { url: SHOE2, pathname: "dev/shoe.png", type: "IMAGE" },
    targets: ["FB", "IG"],
  },
};

// ── boost ──
type BoostProps = ComponentProps<typeof BoostClient>;
const audience = { cities: ["erbil", "sulaymaniyah", "duhok", "kirkuk"], hours: [21, 20, 22, 14], languages: ["ckb", "ar"], products: ["پێڵاوی وەرزشی ئێیر"], messages: 312, orders: 64 };
const ai = { interests: ["پێڵاوی وەرزشی", "مۆدە", "وەرزش و ڕاکردن"], angles: ["سووک و گونجاو بۆ هەموو ڕۆژێک", "گەیاندن بۆ هەموو شارەکان"], questions: ["نرخی چەندە؟", "قەبارەی ٤٢ هەیە؟"], note: "", genderLean: "mixed" as const };
export const boost: BoostProps = {
  business: SHOP,
  igElsewhere: null,
  audience,
  boost: {
    targeting: targetingFor(audience, null, ["erbil", "sulaymaniyah", "duhok", "kirkuk", "halabja"], ai),
    ig: null,
    ai: { ...ai, basedOn: 312, updatedAt: ago(600) },
    worked: ["#پێڵاو", "#هەولێر_سلێمانی_دهۆک", "#sneakers"],
    cityTags: cityHashtags(audience.cities),
  },
  posts: [
    { platform: "IG", account: "i1", id: "p1", caption: "پێڵاوی وەرزشی نوێ 🔥 قەبارە ٣٩ تا ٤٤", thumbUrl: SHOE, permalink: null, createdAt: ago(1500), mediaType: "IMAGE", likes: 412, comments: 58, messages: 41, orders: 12, productName: "پێڵاوی وەرزشی ئێیر" },
    { platform: "FB", account: "f1", id: "p2", caption: "کاتی کارکردنمان: ١٠ی بەیانی تا ١٠ی شەو", thumbUrl: BOOT, permalink: null, createdAt: ago(4000), mediaType: "IMAGE", likes: 31, comments: 2, messages: 0, orders: 0, productName: null },
  ],
  saved: {
    "IG:p1": {
      at: ago(30),
      basedOn: { likes: 412, comments: 58, messages: 41, orders: 12 },
      advice: {
        worthBoosting: true,
        reason: "ئەم پۆستە زۆرترین نامە و داواکاری هێناوە؛ پرسیارەکان زیاتر لەسەر نرخ و قەبارەن.",
        bestPlatform: "IG",
        platformWhy: "کڕیارەکانت زیاتر لە ئینستاگرام نامە دەنێرن.",
        objective: "messages",
        ageMin: 18,
        ageMax: 34,
        gender: "all",
        interests: ["پێڵاوی وەرزشی", "مۆدە"],
        locations: ["erbil", "sulaymaniyah", "duhok"],
        dailyIqd: [7000, 15000],
        creativeScore: 9,
        creativeNotes: ["وێنەکە ڕوون و ڕووناکە", "نرخ لە ناو نامەدا بنێرە"],
        observations: ["٥٨ کۆمێنت، زۆربەیان «نرخی چەندە؟»", "١٢ داواکاری لەم پۆستەوە"],
      },
    },
  },
  errors: [],
  left: 28,
  accounts: { fb: SHOP, ig: "@aso.shoes" },
};
