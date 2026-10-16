// What the assistant knows about Gituas itself. The prices, the numbers of each plan, the account caps and the
// period are read from the same tables the product runs on, so this text cannot drift from them; what is not
// switched on for this deployment (the Max plan, AI video, AI pictures) is left out, so the assistant does not send
// an owner to a screen or a plan that does not exist. Everything else is written by hand from the code, and the
// assistant is told to state nothing that is not here or in the account's own data.

import { DAILY_ANALYSES } from "@/lib/boost/cache";
import { OPTIONAL_SHARE } from "@/lib/ai/meter";
import { PERIOD_DAYS, SHOP_PRICES } from "@/lib/billing/prices";
import { SHOP_ACCOUNT_CAP } from "@/lib/oauth/account-limit";
import { IMAGES_PER_DAY, SHOP_LIMITS, STORE_PLANS, VIDEOS_PER_DAY, type StorePlan } from "@/lib/shop/plans";
import { SUPPORT_WHATSAPP_DISPLAY } from "@/lib/support";

/** What is switched on in this deployment, and what this account has. */
export interface KnowledgeFeatures {
  /** Max can be bought now, or a shop of this account is on it already. */
  max: boolean;
  /** The AI video section exists. */
  video: boolean;
  /** AI pictures can be made in Publish. */
  pictures: boolean;
}

const LABEL: Record<StorePlan, string> = { FREE: "Free", MERCHANT: "Merchant", PRO: "Pro", MAX: "Max", UNLIMITED: "Test (no limits)" };

const iqd = (n: number) => `${n.toLocaleString("en-US")} IQD`;

/** One line per plan: price per shop per month, and what it includes. */
export function planFacts(f: KnowledgeFeatures = { max: true, video: true, pictures: true }): string {
  return STORE_PLANS.filter((plan) => plan !== "MAX" || f.max)
    .map((plan) => {
      const l = SHOP_LIMITS[plan];
      const price = SHOP_PRICES[plan];
      const parts = [
        price ? `${iqd(price)} per shop per month` : "free",
        l.posts === null ? "automatic replies on all posts" : `automatic replies on the newest ${l.posts} posts`,
        `up to ${l.repliesPerDay.toLocaleString("en-US")} automatic replies a day`,
        l.smartPerMonth > 0 ? `${l.smartPerMonth.toLocaleString("en-US")} AI-written replies a month` : "no AI-written replies",
        l.voiceNotesPerDay > 0 ? `${l.voiceNotesPerDay} buyer voice notes read a day` : "no voice-note reading",
        `Boost analyses a day: ${DAILY_ANALYSES[plan] ?? 1}`,
      ];
      if (f.video) parts.push(l.videosPerMonth > 0 ? `up to ${l.videosPerMonth} AI video ads a month (${VIDEOS_PER_DAY} a day at most)` : "no AI video ads");
      if (f.pictures) parts.push(l.imagesPerMonth > 0 ? `${l.imagesPerMonth} AI pictures a month (at most ${IMAGES_PER_DAY} a day)` : "no AI pictures");
      parts.push(plan === "MAX" ? "the strongest AI model (Claude Opus) for replies, post analysis and video scripts" : "the fast AI model");
      return `- ${LABEL[plan]}: ${parts.join("; ")}.`;
    })
    .join("\n");
}

const videoSection = () =>
  `- AI video: the AI writes the script, reads it aloud in a Kurdish voice and makes a short vertical video (about 35 seconds, five or six scenes) that promotes the brand, a product or a channel. It does not make long videos of several minutes, documentaries or story videos for YouTube monetization. At most ${VIDEOS_PER_DAY} video a day for each paid shop, counted across the whole account. Two kinds: Lite (script by the fast model) and Pro (script by the strongest model, on the Max plan). It can use the owner's reference pictures and clips, can plan the day's video itself, can be posted right away, or one can be made every day by itself.`;

/** The product, section by section. */
function product(f: KnowledgeFeatures): string {
  const makes = f.video || f.pictures ? ", makes AI " + [f.pictures ? "pictures" : "", f.video ? "video ads" : ""].filter(Boolean).join(" and ") : "";
  return `Gituas is a tool for anyone who runs a Facebook Page or Instagram account in Iraqi Kurdistan and Iraq, whatever the purpose (a shop, a brand, a creator, a service). It answers followers' and buyers' comments and messages automatically, publishes posts${makes} and keeps the orders. One connected Facebook Page or Instagram account is one "shop"; a plan is bought per shop and covers Facebook, Instagram, TikTok and YouTube for it.

Where things are (the names are in "ui_names"):
- Today: the day at a glance.
- Assistant (chat): the owner can write what to do and attach pictures or videos; it can make an AI picture or video, post now, schedule a post (Facebook and Instagram), switch automatic replies, automatic posts and the daily video on or off, change the shop's own switches and texts (likes, hiding spam, how many days a post keeps replying, the default private message, delivery fee and time, the note for the AI), add or hide a product, and save the shop's WhatsApp number. Every action is shown on a card and runs only after the owner presses Confirm. It cannot change plans, payments, passwords or connected accounts. The top of the app has a switch between the classic screens and the chat.
- Comments and Messages: what buyers wrote. Whatever Gituas could not settle by itself waits there under "needs you", with the reason.
- Orders: orders from comments and messages (the automatic reply asks the buyer for name, phone, city and address in the chat), or recorded by hand.
- WhatsApp: connects the shop's WhatsApp Business number so buyers can write there.
- Publish: write one post and choose Facebook, Instagram, TikTok, YouTube. Instagram and TikTok need a picture or video; YouTube needs a video; a text-only post goes to Facebook only. Facebook, Instagram and YouTube can be scheduled (from 10 minutes to 60 days ahead); TikTok is always posted at once. It suggests a caption and hashtags${f.pictures ? ", and can make an AI picture from an idea and reference pictures" : ""}${f.video ? " or an AI video" : ""}. Choosing a product tags the post, so the first comment already gets that product's card. One post goes to at most 5 accounts of a platform (TikTok 1).
${f.video ? videoSection() : ""}
${f.pictures || f.video ? `- "Gituas review": a switch under the idea box when making an AI picture or video. It rewrites the owner's idea with the brand's name, tagline and products in view, and shows what was asked. Switched off, the owner's words go through exactly as typed. If the review cannot be done, nothing is made or counted.` : ""}
- Auto replies: automatic replies START OFF; the owner switches them on there. For each post the owner picks a product (and a reply template; a default private message can stand in when a post has no product). Products are opened from "Products" on this page: name, JPEG photos, price per variant, in stock.
- Auto posts: the owner chooses Off, Prepare only or Post automatically, and 1 to 3 posts a day. Gituas picks the hours from when buyers message the most (otherwise 13:00, 20:00 and 22:00, Baghdad time). It needs a product that is in stock, has a photo the owner uploaded (JPEG) and was not posted in the last 7 days; best sellers first; the caption gets the price and city hashtags. Posting by itself goes to Facebook and Instagram on paid plans; on the Free plan it only prepares the latest post, which the owner opens in Publish. TikTok can take the prepared picture post after one tap by the owner; YouTube needs a video, so it cannot.
- Boost: advice on whom to target for the whole shop and post by post, from what each post already brought, to paste into Meta's Ads Manager. Gituas does not run or pay for ads.
- Insights: followers and reach, which posts got comments, WhatsApp taps, the last 28 days of buyer messages, comments and orders, and per-product questions and orders with suggestions.
- Settings (the gear at the top right, or under More): language, connect Facebook / Instagram / TikTok / YouTube (tick the authority box), the shop's WhatsApp number used in order links, password, and the Plan & billing link. Instagram messages also need "Allow access to messages" in the Instagram app. The logo, colours and tagline cannot be edited by the owner at the moment.
- Plan & billing: opened from Settings.

How automatic replies decide (comments): a question or an order gets a public answer and a private message with the product card; praise gets a public thank-you; negotiation, complaints and other things are not answered and wait under "needs you"; spam and abuse are hidden only if "hide spam" is on (off by default). Nothing is sent when: the switch is off; the page is paused (its access expired: reconnect it in Settings); the post's automation is off; the post is older than its expiry (30 days by default); the post is not among the newest posts the plan covers; the buyer already got a reply on that post today; the day's number of replies is used up; the comment is older than 7 days (no private message); or the AI was not sure (it waits under "needs you").
Buyers' voice notes (Messenger, Instagram, WhatsApp) are turned into text while automatic replies are on, up to the plan's daily number; if one cannot be heard, the owner listens to it on the platform.

The AI allowance: all AI features of an account share one monthly allowance that renews each month. At ${Math.round(OPTIONAL_SHARE * 100)} percent the optional ones stop (AI-written replies, caption and hashtag suggestions, ${f.pictures ? "AI pictures, " : ""}${f.video ? "AI video scripts, " : ""}Boost analyses, ${f.pictures || f.video ? '"Gituas review", ' : ""}this assistant); the fixed replies and the reading of buyers' messages go on until 100 percent. At 100 percent only simple price questions and emoji are still answered, and other messages wait under "needs you" with the reason that the AI allowance is used up.

Accounts and billing: how many Facebook Pages and Instagram accounts can be connected per platform depends on the best plan (${Object.entries(SHOP_ACCOUNT_CAP)
    .filter(([p]) => p !== "MAX" || f.max)
    .map(([p, n]) => `${LABEL[p as StorePlan] ?? p} ${n}`)
    .join(", ")}). A plan lasts ${PERIOD_DAYS} days and is paid by a payment link (through Wayl, for example FIB, ZainCash, QiCard, FastPay or card); it does not renew by itself. When the days end the shop goes back to Free and nothing is deleted. Upgrading turns the days left into credit.

Things that are NOT part of Gituas: it does not read links the owner pastes, it does not post to a Page that is not connected, it does not run or pay for ads, it does not see other people's ads or the market live, and it does not change prices by itself.`;
}

/** The text of the assistant's knowledge sheet. */
export function buildKnowledge(f: KnowledgeFeatures = { max: true, video: true, pictures: true }): string {
  return `${product(f)}

Plans (price is per shop per month):
${planFacts(f)}

Support: when something cannot be answered from this sheet or from the account's data, or something looks broken, say so plainly and give the support WhatsApp number ${SUPPORT_WHATSAPP_DISPLAY}.`;
}
