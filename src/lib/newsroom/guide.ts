// The newsroom guide, in Sorani, Arabic and English. Plain data so the guide page, the "?" links in
// the frame and later parts (team, own site, review, calendar) share one list.
// The text lives in the dictionaries (nr/shell.*.ts, `guide.sections`); this file adds the order and the links.

import type { Lang } from "@/lib/i18n";
import { nrShellAr } from "@/lib/i18n/nr/shell.ar";
import { nrShellCkb } from "@/lib/i18n/nr/shell.ckb";
import { nrShellEn } from "@/lib/i18n/nr/shell.en";

export const GUIDE_IDS = ["start", "connect", "brand", "sources", "stories", "publish", "comments", "insights", "team", "faq"] as const;
export type GuideId = (typeof GUIDE_IDS)[number];

export interface GuideSection {
  id: GuideId;
  title: string;
  intro: string;
  steps?: readonly string[];
  qa?: readonly { q: string; a: string }[];
  link?: { href: string; label: string };
}

interface SectionText {
  title: string;
  intro: string;
  steps?: readonly string[];
  qa?: readonly { q: string; a: string }[];
  link?: string;
}

const LINKS: Partial<Record<GuideId, string>> = {
  connect: "/newsroom/settings",
  brand: "/newsroom/settings",
  sources: "/newsroom/settings",
  stories: "/newsroom/news",
  publish: "/newsroom/publish",
  comments: "/newsroom/comments",
  insights: "/newsroom/insights",
  team: "/newsroom/team",
  faq: "/data-deletion",
};

function build(text: Record<GuideId, SectionText>): readonly GuideSection[] {
  return GUIDE_IDS.map((id) => {
    const { link, ...s } = text[id];
    const href = LINKS[id];
    return href && link ? { id, ...s, link: { href, label: link } } : { id, ...s };
  });
}

/** The guide in Sorani. */
export const GUIDE = build(nrShellCkb.guide.sections);
const GUIDE_AR = build(nrShellAr.guide.sections);
const GUIDE_EN = build(nrShellEn.guide.sections);

/** The guide in the given language. */
export function guideFor(lang: Lang): readonly GuideSection[] {
  return lang === "ar" ? GUIDE_AR : lang === "en" ? GUIDE_EN : GUIDE;
}
