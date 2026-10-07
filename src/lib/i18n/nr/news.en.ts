import type { nrNewsCkb } from "./news.ckb";

/** Whole numbers with thousands separators: 1,500. */
const n = (v: number): string => v.toLocaleString("en-US");

/** "1 source" / "5 sources". */
function sources(count: number): string {
  return `${n(count)} ${count === 1 ? "source" : "sources"}`;
}

// The newsroom's news text in English: exactly the keys of news.ckb.ts.
// Drafts, cards and captions stay Sorani whatever the UI language; only the interface is English.
export const nrNewsEn: typeof nrNewsCkb = {
  list: {
    title: "News",
    tabs: { new: "New", ready: "Ready", done: "Published" },
    autoRefresh: (every: string) => `Auto-refresh: ${every}`,
    refreshing: "Refreshing…",
    statDrafts: "Drafts this month",
    statSources: "Sources",
    noSources: "You have no active sources.",
    noSourcesLink: "Add sources in Settings",
    noKeywords: "GDELT and NewsData need keywords.",
    noKeywordsLink: "Set your keywords",
    noAnswer: (names: string) => `No response from: ${names}`,
    empty: "No stories here.",
    auto: "Auto",
    sourceCount: sources,
    attribBefore: "Some stories come through",
    attribAnd: " and ",
    attribAfter: ".",
  },

  filters: {
    topic: "Topic",
    allTopics: "All topics",
    region: "Region",
    allRegions: "All regions",
    source: "Source",
    allSources: "All sources",
  },

  langs: { ckb: "Kurdish", ku: "Kurdish", ar: "Arabic", en: "English", tr: "Turkish" },

  topics: {
    politics: "Politics",
    economy: "Economy",
    security: "Security",
    sports: "Sports",
    health: "Health",
    tech: "Science & technology",
    society: "Society",
    culture: "Culture & arts",
    other: "Other",
  },
  subtopics: {
    politics: {
      government: "Government & parliament",
      elections: "Elections",
      diplomacy: "International relations",
      parties: "Political parties",
    },
    economy: {
      energy: "Oil & energy",
      salaries: "Salaries & budget",
      markets: "Markets & currency",
      trade: "Trade & investment",
    },
    security: {
      conflict: "War & conflict",
      terrorism: "Terrorism",
      crime: "Crime & police",
      accidents: "Accidents & disasters",
    },
    sports: {
      football: "Football",
      local: "Kurdistan & Iraq sports",
      other: "Other sports",
    },
    society: {
      education: "Education",
      environment: "Environment & climate",
      services: "Electricity, water & services",
      humanitarian: "Migration & humanitarian situation",
    },
  },
  regions: { kurdistan: "Kurdistan", iraq: "Iraq", region: "The region", world: "World" },

  checklist: {
    title: "First steps",
    done: "Done",
    guide: "Read the full guide",
    steps: {
      connect: "Connect a Facebook, Instagram or TikTok page",
      brand: "Add your channel logo",
      sources: "Set keywords or an RSS feed",
      card: "Create your first card",
      publish: "Publish your first story",
    },
  },

  editor: {
    videoSec: "Video for this story",
    videoHint: "Upload up to 3 clips your team filmed. Hawalnoos turns them into a 9:16 highlight with voice and captions. No clips? A Hawalnoos-design video is made instead. Only upload video you own the rights to.",
    videoPick: "Choose video",
    videoUploading: (done: number, of: number) => `Uploading… ${n(done)}/${n(of)}`,
    videoClips: (count: number) => `${n(count)} clip(s) ready`,
    videoMakeHighlight: "Make highlight",
    videoMakeTemplate: "Make design video",
    videoWorking: "Making the video… about 5 to 10 minutes. You can leave this page.",
    videoFailed: "The video could not be made. Try again.",
    videoReady: "The video is ready.",
    videoPublish: "Publish the video",
    videoTooMany: "At most 3 clips.",
    listTitle: "Videos",
    listHint: "The autopilot posts reels to Facebook and Instagram by itself. TikTok's and YouTube's rules need a person to see and approve each post: publish them from here in one click.",
    listEmpty: "No videos in the last three days. Turn on auto video in Settings, or make a video inside a story.",
    listAuto: "Automatic: Facebook and Instagram",
    listToTikTok: "TikTok ← one click",
    listToYouTube: "YouTube ← one click",
    listWorking: "Being made…",
    sourceSec: "Source",
    open: "Open",
    summarySec: "Kurdish summary",
    improve: "Improve",
    dismiss: "Dismiss",
    improving: "Improving the wording… (up to 10 seconds)",
    drafting: "Preparing… (up to 20 seconds)",
    draftingShort: "Preparing…",
    headline: "Headline",
    body: "Body",
    kindAria: "Card type",
    kinds: { STANDARD: "Standard", BREAKING: "Breaking", STAT: "Stat", QUOTE: "Quote" },
    stat: "Stat",
    quote: "Quote",
    speaker: "Speaker",
    changePhoto: "Change photo",
    ownPhoto: "Your own photo",
    photoNote: "Your own photos only — no photo is taken from the sources.",
    photoTypes: "JPG/PNG/WEBP photos only.",
    uploadFailed: (msg: string) => `Upload failed: ${msg}`,
    tooLong: "The text is too long for the card. Shorten it.",
    cardSec: "Card",
    saving: "Saving…",
    rendering: "Creating the card…",
    uploadingCard: "Uploading the card…",
    prepare: "Prepare to publish",
    prepareHint:
      "The publish page opens next: you choose where to post and approve it. Nothing is published without your click.",
  },

  rules: {
    empty: "A headline and body text are both required.",
    headlineLong: (max: number) => `The headline is longer than ${n(max)} characters.`,
    bodyLong: (max: number) => `The body is longer than ${n(max)} characters.`,
    copy: {
      headline: "The headline is too close to the source's headline. Rewrite it in your own words.",
      body: "The body is too close to the source text. Rewrite it in your own words.",
      both: "The headline and body are too close to the source. Rewrite them in your own words.",
    },
  },

  actions: {
    notNews: "This section is only for news pages.",
    refreshFailed: "Refresh failed. Try again.",
    badStrength: "The requested type is not valid.",
    notFound: "Story not found.",
    limitDraft: (max: number) =>
      `You have reached this month's limit for preparing stories (${n(max)}). Upgrade your plan for more.`,
    limitImprove: (max: number) =>
      `You have reached this month's limit for improving stories (${n(max)}). Upgrade your plan for more.`,
    limitPublish: (max: number) =>
      `You have reached this month's publishing limit (${n(max)}). Upgrade your plan for more.`,
    limitVideo: (max: number) => `You have reached this month's video limit (${n(max)}). Upgrade your plan for more.`,
    frozen: "Your free trial has ended — to continue, choose a plan in “Plan & billing”.",
    aiDown: "Automatic writing isn't available right now. You can write it yourself.",
    draftFailed: "Preparing the story failed. Try again.",
    badKind: "The card type is not valid.",
    badPhoto: "The photo isn't recognized.",
    saveFirst: "Save the text first.",
    badCard: "The card isn't recognized.",
    sourceUnavailable: "This source isn't available.",
    sourceLimit: "Your plan's limit on the number of sources has been reached.",
    badLink: "The link is not valid.",
    needName: "Enter the source name.",
    emptyFeed: "This link has no stories.",
    notRss: "This link is not an RSS feed, or it isn't responding.",
    duplicate: "This source has already been added.",
    badColors: "The colors are not valid.",
    badFont: "The font is not valid.",
    badLogo: "The logo isn't recognized.",
    badAutopilot: "The Autopilot settings are not valid.",
    autoPlan: "Auto-publishing is only available on the Pro and Enterprise plans.",
    autoTargets: "For auto-publishing, choose at least one connected Facebook or Instagram page.",
  },

  settings: {
    groups: {
      api: "Keyword search",
      world: "World",
      region: "Middle East",
      kurdistan: "Kurdistan",
      official: "Official",
    },
    about: {
      gdelt: "World news in 65+ languages, based on your keywords. Free.",
      newsdata: "Arabic and English news based on your keywords. 12-hour delay.",
    },
  },
};
