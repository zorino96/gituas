// /llms.txt and /llms-full.txt: the site in plain markdown for AI answer engines and agents (llmstxt.org).
// Generated from the same reviewed content as the pages, so the two cannot disagree.

import { CHROME } from "./chrome";
import { guideSlugs, guidesFor, landingFor } from "./content";
import { SITE_LANG_NAMES, SITE_LANGS, SITE_ORIGIN, siteUrl } from "./langs";
import { planRows } from "./pricing";

const iqd = (n: number) => `${n.toLocaleString("en-US")} IQD`;

function planLines(): string[] {
  const p = CHROME.en.pricing;
  return planRows().map((r) => {
    const parts = [
      r.price === 0 ? "free" : `${iqd(r.price)} per shop per month`,
      r.posts === null ? "automatic replies on all posts" : `automatic replies on the newest ${r.posts} posts`,
      `up to ${r.repliesPerDay.toLocaleString("en-US")} automatic replies a day`,
      r.videosPerMonth ? `${r.videosPerMonth} AI video ads a month` : "no AI video ads",
      r.picturesPerMonth ? `${r.picturesPerMonth} AI pictures a month` : "no AI pictures",
    ];
    return `- ${p.plans[r.plan].name}: ${parts.join("; ")}.`;
  });
}

export function llmsTxt(): string {
  const l = landingFor("en");
  const guides = guidesFor("en");
  return [
    `# Gituas`,
    ``,
    `> ${l.definition}`,
    ``,
    `Gituas is built for Kurdistan and Iraq. The interface and the replies are in Kurdish (Sorani), Arabic and English. A "shop" is one connected Facebook Page or Instagram account; plans are priced per shop per month in Iraqi dinar (IQD) and paid through Wayl (FIB, ZainCash, QiCard, FastPay, card).`,
    ``,
    `## Main pages`,
    `- [Home](${siteUrl("en")}): ${l.metaDescription}`,
    `- [Pricing](${siteUrl("en", "/pricing")}): ${CHROME.en.pricing.metaDescription}`,
    `- [Guides](${siteUrl("en", "/guides")}): ${CHROME.en.guides.intro}`,
    ``,
    `## Guides`,
    ...guides.map((g) => `- [${g.title}](${siteUrl("en", `/guides/${g.slug}`)}): ${g.metaDescription}`),
    ``,
    `## Plans`,
    ...planLines(),
    ``,
    `## Other languages`,
    ...SITE_LANGS.filter((x) => x !== "en").map((x) => `- [${SITE_LANG_NAMES[x]}](${siteUrl(x)}): the same pages in ${SITE_LANG_NAMES[x]}`),
    ``,
    `## Optional`,
    `- [Full text of these pages](${SITE_ORIGIN}/llms-full.txt)`,
    `- [Privacy policy](${SITE_ORIGIN}/privacy)`,
    `- [Terms](${SITE_ORIGIN}/terms)`,
    `- [Hawalnoos](https://hawalnoos.com): a newsroom tool by the same team, for news agencies and news pages`,
    ``,
  ].join("\n");
}

export function llmsFullTxt(): string {
  const l = landingFor("en");
  const out: string[] = [`# Gituas`, ``, `> ${l.definition}`, ``, `Source: ${siteUrl("en")}`, ``];
  out.push(`## ${l.h1}`, ``, l.lead, ``);
  out.push(`### How it works`, ``, ...l.steps.map((s, i) => `${i + 1}. **${s.title}** ${s.body}`), ``);
  out.push(`### What Gituas does`, ``, ...l.features.map((f) => `- **${f.title}** ${f.body}`), ``);
  out.push(`### Who it is for`, ``, ...l.audience.map((a) => `- **${a.title}** ${a.body}`), ``);
  out.push(`### ${l.market.title}`, ``, ...l.market.paragraphs.flatMap((p) => [p, ``]));
  out.push(`### Plans and pricing`, ``, l.pricing.intro, ``, ...planLines(), ``, l.pricing.note, ``);
  out.push(`### Frequently asked questions`, ``, ...l.faq.flatMap((f) => [`**${f.q}**`, f.a, ``]));
  for (const slug of guideSlugs()) {
    const g = guidesFor("en").find((x) => x.slug === slug)!;
    out.push(`---`, ``, `## ${g.title}`, ``, `Source: ${siteUrl("en", `/guides/${slug}`)}`, ``, g.answer, ``);
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
