// set_business_goal: the owner says how their page earns for them (selling, monetizing their content, or something else) and the chat
// writes it down, so Gituas stops treating a creator as a seller. It is the same answer the setup questions ask for; saying it in the chat is
// enough. It changes no account and sends nothing, so it is a small change ("low"), and it is saved for every group of the workspace.

import { z } from "zod";

import { db } from "@/lib/db";
import { profileEnabled } from "@/lib/shop/profile-shared";
import { defineWrite, type Card, type WriteResult, type WriteTool } from "../types";
import { clip, refuse, say, words } from "./writes-common";

const GOAL = {
  sell: words("فرۆشتن (بەرهەم یان خزمەتگوزاری)", "البيع (منتجات أو خدمات)", "Selling (products or services)"),
  monetize: words("مۆنەتایز (داهات لە ناوەڕۆک، بینین، ڕیکلام و هاوبەشی)", "تحقيق الدخل من المحتوى (المشاهدات والإعلانات والشراكات)", "Monetizing my content (views, ads, partnerships)"),
  other: words("شتێکی تر", "شيء آخر", "Something else"),
};
const LABEL = words("دەینووسم کە پەیجەکەت چۆن قازانج دەکات…", "أسجّل كيف تحقق صفحتك أرباحاً…", "Saving how your page earns…");
const TITLE = words("پەیجەکەت چۆن قازانج دەکات", "كيف تحقق صفحتك أرباحاً", "How your page earns");
const FIELD = { goal: words("ئامانج", "الهدف", "Goal"), note: words("بە وشەی خۆت", "بكلماتك", "In your words") };
const NONE = "There is no group to save this for: nothing is connected yet. Tell the owner to connect a Page or an Instagram account first (show_accounts).";
const OFF = "The setup questions are switched off on this server right now.";
const DONE = say(
  (g: string) => `نووسرایەوە: ${g}. گیتواس لەم کاتەوە بەم شێوەیە قسەت لەگەڵ دەکات.`,
  (g: string) => `تم الحفظ: ${g}. سيتحدث معك غيتواس على هذا الأساس من الآن.`,
  (g: string) => `Saved: ${g}. Gituas will talk to you that way from now on.`,
);

const schema = z
  .object({
    goal: z.enum(["sell", "monetize", "other"]).describe('"sell" = sells products or services; "monetize" = earns from content (views, audience, ads, partnerships: a creator); "other"'),
    note: z.string().trim().max(200).optional().describe("The owner's own words about it, if they gave any"),
  })
  .strict();

/** The groups this is saved for: the ones that hold an account, else every group of the workspace. */
async function groupsOf(tenantId: string): Promise<string[]> {
  const rows = await db.store.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" }, take: 15, select: { id: true, fbPageId: true, igUserId: true } });
  const holding = rows.filter((r) => r.fbPageId || r.igUserId);
  return (holding.length ? holding : rows).map((r) => r.id);
}

const set_business_goal = defineWrite({
  name: "set_business_goal",
  description:
    "Save how the owner's page earns for them, in the setup question's three choices: sell (products or services), monetize (earns from content: views, audience, ads, partnerships; a creator), other. " +
    "Use it when the owner says what they do (\"I make story videos\", \"I sell shoes\") or answers that question; do not guess it. note: their own words, if they gave any. " +
    "A creator is not a seller: after monetize, never talk to them about orders, products, prices or delivery.",
  schema,
  kinds: ["shop"],
  permission: "configure",
  risk: "low",
  textFields: ["note"],
  label: (lang) => LABEL[lang],
  async card(ctx, args): Promise<Card> {
    if (!profileEnabled()) return refuse(OFF);
    if (!(await groupsOf(ctx.tenantId)).length) return refuse(NONE);
    return {
      title: TITLE[ctx.lang],
      lines: [{ label: FIELD.goal[ctx.lang], value: GOAL[args.goal][ctx.lang] }, ...(args.note ? [{ label: FIELD.note[ctx.lang], value: clip(args.note, 120) }] : [])],
    };
  },
  async execute(ctx, args): Promise<WriteResult> {
    if (!profileEnabled()) return refuse(OFF);
    const ids = await groupsOf(ctx.tenantId);
    if (!ids.length) return refuse(NONE);
    const fields = { goal: args.goal, ...(args.note ? { goalText: args.note } : {}) };
    for (const id of ids) {
      await db.businessProfile.upsert({ where: { storeId: id }, create: { storeId: id, ...fields }, update: fields });
    }
    return { ok: true, text: DONE[ctx.lang](GOAL[args.goal][ctx.lang]), data: { goal: args.goal, groups: ids.length } };
  },
});

export const GOAL_WRITE_TOOLS: WriteTool[] = [set_business_goal];
