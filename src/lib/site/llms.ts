// /llms.txt and /llms-full.txt: the site in plain markdown for AI answer engines and agents (llmstxt.org).
// Generated from the same reviewed content as the pages, so the two cannot disagree.

import { CHROME } from "./chrome";
import { CONTENT_UPDATED, guidesFor, landingFor } from "./content";
import { SITE_LANG_NAMES, SITE_LANGS, SITE_ORIGIN, siteUrl, type SiteLang } from "./langs";
import { planRows } from "./pricing";

const iqd = (n: number) => `${n.toLocaleString("en-US")} IQD`;

/** One line per plan with every number of the pricing table (they are ceilings: see the notes). */
function planLines(): string[] {
  const p = CHROME.en.pricing;
  return planRows().map((r) => {
    const parts = [
      r.price === 0 ? "free, no time limit" : `${iqd(r.price)} per shop per month`,
      r.posts === null ? "automatic replies on all posts" : `automatic replies on the newest ${r.posts} posts`,
      `up to ${r.repliesPerDay.toLocaleString("en-US")} automatic replies a day`,
      `up to ${r.aiRepliesPerMonth.toLocaleString("en-US")} AI-written replies a month`,
      r.voiceNotesPerDay ? `up to ${r.voiceNotesPerDay} buyer voice notes read a day` : "no voice-note reading",
      `up to ${r.boostPerDay} Boost ${r.boostPerDay === 1 ? "analysis" : "analyses"} a day`,
      r.videosPerMonth ? `up to ${r.videosPerMonth} AI video ads a month` : "no AI video ads",
      r.picturesPerMonth ? `up to ${r.picturesPerMonth} AI pictures a month` : "no AI pictures",
      `up to ${r.accounts} connected accounts per platform`,
      r.opus ? "strongest AI model (Claude Opus) within a monthly share" : "standard AI model",
    ];
    return `- ${p.plans[r.plan].name}: ${parts.join("; ")}.`;
  });
}

const date = () => new Date(`${CONTENT_UPDATED}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function guideLinks(lang: SiteLang): string[] {
  return guidesFor(lang).map((g) => `- [${g.title}](${siteUrl(lang, `/guides/${g.slug}`)}): ${g.metaDescription}`);
}

export function llmsTxt(): string {
  const l = landingFor("en");
  const c = CHROME.en;
  return [
    `# Gituas`,
    ``,
    `> ${l.definition}`,
    ``,
    `Gituas (Kurdish: گیتواس) is built for Kurdistan and Iraq. The interface and the replies are in Kurdish (Sorani), Arabic and English. A "shop" is one connected Facebook Page or Instagram account; plans are priced per shop per month in Iraqi dinar (IQD) and paid through Wayl (FIB, ZainCash, QiCard, FastPay, card). Content last reviewed ${date()}.`,
    ``,
    `## Main pages`,
    `- [Home](${siteUrl("en")}): ${l.metaDescription}`,
    `- [Pricing](${siteUrl("en", "/pricing")}): ${c.pricing.metaDescription}`,
    `- [About and contact](${siteUrl("en", "/about")}): ${c.about.metaDescription}`,
    `- [Guides](${siteUrl("en", "/guides")}): ${c.guides.intro}`,
    ``,
    `## Guides (English)`,
    ...guideLinks("en"),
    ``,
    `## Plans (per shop per month; the numbers are ceilings on one shared monthly AI allowance)`,
    ...planLines(),
    ``,
    ...(["ku", "ar"] as const).flatMap((x) => [
      `## ${SITE_LANG_NAMES[x]} (${x === "ku" ? "Sorani Kurdish" : "Arabic"})`,
      `- [${CHROME[x].home}](${siteUrl(x)})`,
      `- [${CHROME[x].nav.pricing}](${siteUrl(x, "/pricing")})`,
      `- [${CHROME[x].nav.about}](${siteUrl(x, "/about")})`,
      ...guideLinks(x),
      ``,
    ]),
    `## Optional`,
    `- [Full text of the English pages](${SITE_ORIGIN}/llms-full.txt)`,
    `- [Privacy policy](${SITE_ORIGIN}/privacy)`,
    `- [Terms](${SITE_ORIGIN}/terms)`,
    `- [Hawalnoos](https://hawalnoos.com): a newsroom tool by the same team, for news agencies and news pages`,
    ``,
  ].join("\n");
}

export function llmsFullTxt(): string {
  const l = landingFor("en");
  const c = CHROME.en;
  const out: string[] = [`# Gituas`, ``, `> ${l.definition}`, ``, `Source: ${siteUrl("en")} · content last reviewed ${date()}`, ``];
  out.push(`## ${l.h1}`, ``, l.lead, ``);
  out.push(`### How it works`, ``, ...l.steps.map((s, i) => `${i + 1}. **${s.title}** ${s.body}`), ``);
  out.push(`### What Gituas does`, ``, ...l.features.map((f) => `- **${f.title}** ${f.body}`), ``);
  out.push(`### Who it is for`, ``, ...l.audience.map((a) => `- **${a.title}** ${a.body}`), ``);
  out.push(`### ${l.market.title}`, ``, ...l.market.paragraphs.flatMap((p) => [p, ``]));
  out.push(`### Frequently asked questions`, ``, ...l.faq.flatMap((f) => [`**${f.q}**`, f.a, ``]));

  out.push(`---`, ``, `## ${c.pricing.title}`, ``, `Source: ${siteUrl("en", "/pricing")}`, ``, c.pricing.intro, ``, c.pricing.checked(date()), ``, ...planLines(), ``);
  out.push(...c.pricing.notes.flatMap((n) => [n, ``]));
  out.push(`### Questions`, ``, ...c.pricing.faq(planRows().some((r) => r.plan === "MAX")).flatMap((f) => [`**${f.q}**`, f.a, ``]));

  out.push(`---`, ``, `## ${c.about.title}`, ``, `Source: ${siteUrl("en", "/about")}`, ``, ...c.about.paragraphs.flatMap((p) => [p, ``]), c.about.contact, ``);

  for (const g of guidesFor("en")) {
    out.push(`---`, ``, `## ${g.title}`, ``, `Source: ${siteUrl("en", `/guides/${g.slug}`)}`, ``, g.answer, ``);
    out.push(`Key points:`, ...g.keyPoints.map((k) => `- ${k}`), ``);
    for (const s of g.sections) out.push(`### ${s.h2}`, ``, ...s.paragraphs.flatMap((p) => [p, ``]), ...(s.bullets?.length ? [...s.bullets.map((b) => `- ${b}`), ``] : []));
    if (g.steps?.length) out.push(`### Steps`, ``, ...g.steps.map((s, i) => `${i + 1}. **${s.name}** ${s.text}`), ``);
    out.push(`### Questions`, ``, ...g.faq.flatMap((f) => [`**${f.q}**`, f.a, ``]));
  }
  return out.join("\n");
}

export const HAWALNOOS_LLMS = [
  `# Hawalnoos`,
  ``,
  `> Hawalnoos (هەواڵنووس) is a newsroom tool for news agencies and news pages in Iraqi Kurdistan and Iraq, made by the team behind Gituas. It collects stories from the desk's chosen sources, drafts short Sorani posts with AI, makes branded cards and publishes them to Facebook and Instagram, by hand or automatically.`,
  ``,
  `- It follows RSS feeds and news APIs and filters by topic, by keywords or by a prompt written by the desk.`,
  `- It writes facts-only drafts in Sorani from a headline and snippet, never copying the source text or images.`,
  `- Cards use the desk's own colours, logo and frame, and a section (breaking news, sports, economy) can have its own frame.`,
  `- An autopilot can prepare drafts or publish to Facebook and Instagram; TikTok and YouTube need a person's approval.`,
  `- Teams have roles (owner, editor-in-chief, editor).`,
  ``,
  `Website: https://hawalnoos.com`,
  `Gituas (for shops): https://gituas.com`,
  ``,
].join("\n");
