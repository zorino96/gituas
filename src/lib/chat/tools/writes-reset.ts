// Starting again from nothing, from inside the chat: disconnect the connected accounts, and take the products off the Products screen.
// Both are destructive, so each is always a card that lists exactly what will go, and only the person's Confirm runs it (the card's
// request is the person's own, under their session, through the same actions the Settings and Products screens use). Nothing here
// deletes a group (a Store holds the billing records) or an order; the card says so.

import { z } from "zod";

import { disconnectAccountAction } from "@/app/app/actions";
import { db } from "@/lib/db";
import { defineWrite, type Card, type ToolCtx, type WriteResult, type WriteTool } from "../types";
import { clip, refuse, say, words } from "./writes-common";

type Provider = "META_FACEBOOK" | "META_INSTAGRAM" | "TIKTOK" | "YOUTUBE";
const PROVIDERS: readonly Provider[] = ["META_FACEBOOK", "META_INSTAGRAM", "TIKTOK", "YOUTUBE"];
const WHICH: Record<string, readonly Provider[]> = {
  all: PROVIDERS,
  facebook: ["META_FACEBOOK"],
  instagram: ["META_INSTAGRAM"],
  tiktok: ["TIKTOK"],
  youtube: ["YOUTUBE"],
};

const PLATFORM = {
  META_FACEBOOK: words("فەیسبووک", "فيسبوك", "Facebook"),
  META_INSTAGRAM: words("ئینستاگرام", "إنستغرام", "Instagram"),
  TIKTOK: words("تیکتۆک", "تيك توك", "TikTok"),
  YOUTUBE: words("یوتیوب", "يوتيوب", "YouTube"),
};

// ---------------------------------------------------------------------------------------------------------------------
// disconnect_accounts

const D = {
  label: words("ئەکاونتەکان دەپچڕێنم…", "أفصل الحسابات…", "Disconnecting the accounts…"),
  title: words("پچڕاندنی ئەکاونتەکان", "فصل الحسابات", "Disconnect accounts"),
  warning: words("ئاگاداری", "تنبيه", "Heads up"),
  warningText: words(
    "ئەم ئەکاونتانە دەپچڕێن: پۆست و وەڵامدانەوەی خۆکار بۆیان ڕادەوەستێت. ئەو کۆمێنت و نامانەی لە ڕێگەیانەوە هاتبوون و لە گیتواس پاشەکەوت کرابوون دەسڕێنەوە. بەرهەم و داواکارییەکان ناسڕدرێنەوە. دەتوانیت هەر کاتێک دووبارە ببەستیتەوە.",
    "ستُفصل هذه الحسابات: تتوقف المنشورات والردود التلقائية لها. تُحذف التعليقات والرسائل التي وصلت عبرها والمحفوظة في Gituas. المنتجات والطلبات لا تُحذف. يمكنك ربطها من جديد في أي وقت.",
    "These accounts are disconnected: automatic posts and replies for them stop. The comments and messages saved from them are removed from Gituas. Products and orders are not removed. You can connect them again any time.",
  ),
  none: "No connected account matches. Tell the owner that nothing of that kind is connected.",
  done: say(
    (n: number) => `${n} ئەکاونت پچڕێنران.`,
    (n: number) => `تم فصل ${n} من الحسابات.`,
    (n: number) => `${n} ${n === 1 ? "account was" : "accounts were"} disconnected.`,
  ),
  partial: say(
    (n: number, m: number) => `${n} ئەکاونت پچڕێنران، بەڵام ${m} پچڕاندنیان سەرنەکەوت.`,
    (n: number, m: number) => `تم فصل ${n} من الحسابات، لكن فشل فصل ${m}.`,
    (n: number, m: number) => `${n} disconnected, but ${m} could not be.`,
  ),
  failed: words("هیچ ئەکاونتێک نەپچڕا. دووبارە هەوڵ بدەرەوە.", "لم يُفصل أي حساب. حاول مرة أخرى.", "No account was disconnected. Try again."),
};

const disconnectSchema = z
  .object({
    which: z.enum(["all", "facebook", "instagram", "tiktok", "youtube"]).describe('"all" or one platform'),
    accounts: z.array(z.string().max(160)).max(40).optional().describe("Never set this: the card fills it with the accounts it showed"),
  })
  .strict();

interface Linked {
  provider: Provider;
  id: string;
  name: string;
}

/** Every credential of the workspace, including one whose token has expired (it still has to be removable). */
async function linkedAccounts(tenantId: string): Promise<Linked[]> {
  const rows = await db.oAuthCredential.findMany({
    where: { tenantId, provider: { in: [...PROVIDERS] } },
    orderBy: { createdAt: "asc" },
    select: { provider: true, providerAccountId: true, providerAccountName: true },
    take: 60,
  });
  return rows
    .filter((r) => !r.providerAccountId.startsWith("act_"))
    .map((r) => ({ provider: r.provider as Provider, id: r.providerAccountId, name: r.providerAccountName ?? r.providerAccountId }));
}

const key = (a: Linked) => `${a.provider}:${a.id}`;

async function targetsOf(ctx: ToolCtx, args: z.output<typeof disconnectSchema>): Promise<Linked[]> {
  const all = await linkedAccounts(ctx.tenantId);
  // The accounts the card showed are the ones that go (an account connected after the card is not added to them).
  if (args.accounts?.length) return all.filter((a) => args.accounts!.includes(key(a)));
  return all.filter((a) => WHICH[args.which].includes(a.provider));
}

const disconnect_accounts = defineWrite({
  name: "disconnect_accounts",
  description:
    "Disconnect connected accounts (Facebook Pages, Instagram accounts, TikTok, YouTube) from Gituas. which: \"all\" or one of facebook, instagram, tiktok, youtube. " +
    "Use it ONLY when the owner clearly asks to disconnect or remove their accounts (for example to start again from nothing); never offer it on your own. " +
    "The owner always confirms on a card that lists every account that will go. Comments and messages saved from those accounts are removed from Gituas; products, orders and billing are not. They can connect the accounts again.",
  schema: disconnectSchema,
  kinds: ["shop"],
  permission: "configure",
  risk: "destructive",
  label: (lang) => D.label[lang],
  async card(ctx, args): Promise<Card> {
    const targets = await targetsOf(ctx, args);
    if (!targets.length) return refuse(D.none);
    const lines = PROVIDERS.filter((p) => targets.some((t) => t.provider === p)).map((p) => {
      const names = targets.filter((t) => t.provider === p).map((t) => clip(t.name, 40));
      return { label: PLATFORM[p][ctx.lang], value: names.slice(0, 6).join(" ، ") + (names.length > 6 ? ` +${names.length - 6}` : "") };
    });
    lines.push({ label: D.warning[ctx.lang], value: D.warningText[ctx.lang] });
    return { title: D.title[ctx.lang], lines, pin: { accounts: targets.map(key) } };
  },
  async execute(ctx, args): Promise<WriteResult> {
    const targets = await targetsOf(ctx, args);
    if (!targets.length) return { ok: false, text: D.failed[ctx.lang] };
    let done = 0;
    for (const t of targets) {
      // The app's own action: it checks the session and the role again, removes the credential and what came in through it.
      const r = await disconnectAccountAction(t.provider, t.id).catch(() => ({ ok: false as const }));
      if (r.ok) done++;
    }
    const failed = targets.length - done;
    if (!done) return { ok: false, text: D.failed[ctx.lang] };
    return { ok: true, text: failed ? D.partial[ctx.lang](done, failed) : D.done[ctx.lang](done), data: { disconnected: done, failed } };
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// remove_all_products

const P = {
  label: words("بەرهەمەکان لادەبەم…", "أزيل المنتجات…", "Removing the products…"),
  title: words("لابردنی هەموو بەرهەمەکان", "إزالة كل المنتجات", "Remove all products"),
  count: words("ژمارەی بەرهەمەکان", "عدد المنتجات", "Products"),
  names: words("وەک", "مثل", "Such as"),
  warning: words("ئاگاداری", "تنبيه", "Heads up"),
  warningText: words(
    "ئەم بەرهەمانە لە شاشەی بەرهەمەکان دەڕۆن و لە ئەپەکەوە ناگەڕێنرێنەوە؛ تەنها وەک بەرهەمی نوێ (بە نرخ و وێنەوە) دووبارە زیاد دەکرێنەوە. داواکارییەکان ناسڕدرێنەوە.",
    "ستختفي هذه المنتجات من شاشة المنتجات ولا يمكن إرجاعها من التطبيق؛ يمكن فقط إضافتها من جديد كمنتجات جديدة (بالسعر والصور). الطلبات لا تُحذف.",
    "These products leave the Products screen and cannot be brought back from the app; they can only be added again as new products (with price and photos). Orders are not removed.",
  ),
  none: "There are no products to remove. Tell the owner.",
  done: say(
    (n: number) => `${n} بەرهەم لابران.`,
    (n: number) => `تمت إزالة ${n} من المنتجات.`,
    (n: number) => `${n} ${n === 1 ? "product was" : "products were"} removed.`,
  ),
};

const removeSchema = z.object({ all: z.literal(true).describe("Must be true: this removes EVERY product") }).strict();

const remove_all_products = defineWrite({
  name: "remove_all_products",
  description:
    "Remove EVERY product of the workspace from the Products screen (they cannot be brought back from the app; orders stay). " +
    "Use it ONLY when the owner clearly asks to remove all products, for example to start again from nothing; to remove one product use archive_product. Never offer it on your own. The owner always confirms on a card first.",
  schema: removeSchema,
  kinds: ["shop"],
  permission: "configure",
  risk: "destructive",
  label: (lang) => P.label[lang],
  async card(ctx): Promise<Card> {
    const where = { active: true, store: { tenantId: ctx.tenantId } };
    const [n, some] = await Promise.all([db.product.count({ where }), db.product.findMany({ where, orderBy: { updatedAt: "desc" }, take: 5, select: { name: true } })]);
    if (!n) return refuse(P.none);
    return {
      title: P.title[ctx.lang],
      lines: [
        { label: P.count[ctx.lang], value: String(n) },
        { label: P.names[ctx.lang], value: some.map((p) => clip(p.name, 40)).join(" ، ") + (n > some.length ? " …" : "") },
        { label: P.warning[ctx.lang], value: P.warningText[ctx.lang] },
      ],
    };
  },
  async execute(ctx): Promise<WriteResult> {
    const gone = await db.product.updateMany({ where: { active: true, store: { tenantId: ctx.tenantId } }, data: { active: false } });
    if (!gone.count) return refuse(P.none);
    return { ok: true, text: P.done[ctx.lang](gone.count), data: { removed: gone.count } };
  },
});

export const RESET_WRITE_TOOLS: WriteTool[] = [disconnect_accounts, remove_all_products];
