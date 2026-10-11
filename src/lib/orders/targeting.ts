// Boost settings for each platform, from what the shop's own buyers and followers show: where the
// orders come from, when buyers write, which language they use, and (when Instagram says) the age
// and gender of the followers. Pure, so the rules can be tested; the screens label the codes.

import type { IgAudience } from "@/lib/publishers/instagram-audience";
import type { BuyerProfile } from "./stats";

export const AD_PLATFORMS = ["FB", "IG", "TT", "YT"] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];

export type Objective = "messages" | "whatsapp_traffic" | "video_views";
export type Placement = "fb_feed" | "fb_reels" | "fb_stories" | "marketplace" | "ig_feed" | "ig_stories" | "ig_reels" | "ig_explore" | "for_you" | "yt_shorts" | "yt_instream";
export type Format = "photo_4_5" | "reel_9_16" | "video_9_16" | "shorts_or_16_9";

export interface PlatformTargeting {
  platform: AdPlatform;
  objective: Objective;
  /** Governorate codes. */
  locations: string[];
  ageMin: number;
  ageMax: number;
  gender: "all" | "women" | "men";
  languages: string[];
  placements: Placement[];
  format: Format;
  /** Baghdad hours to run the ad. */
  hours: number[];
  /** A sensible daily budget to start with, in IQD. */
  dailyIqd: [number, number];
  /** True when the age range came from the shop's own Instagram followers. */
  fromFollowers: boolean;
}

const KRI = ["erbil", "sulaymaniyah", "duhok", "halabja"];
const DEFAULT_HOURS = [13, 20, 22];

/** Who each platform reaches best in Iraq when the shop has no follower data yet. */
const DEFAULT_AGE: Record<AdPlatform, [number, number]> = { FB: [18, 55], IG: [18, 44], TT: [18, 34], YT: [18, 54] };

const PLATFORM: Record<AdPlatform, { objective: Objective; placements: Placement[]; format: Format; dailyIqd: [number, number] }> = {
  FB: { objective: "messages", placements: ["fb_feed", "fb_reels", "fb_stories", "marketplace"], format: "photo_4_5", dailyIqd: [5000, 15000] },
  IG: { objective: "messages", placements: ["ig_feed", "ig_stories", "ig_reels", "ig_explore"], format: "reel_9_16", dailyIqd: [5000, 15000] },
  // TikTok asks for a minimum daily budget per ad group (about $20); the range starts there.
  TT: { objective: "whatsapp_traffic", placements: ["for_you"], format: "video_9_16", dailyIqd: [35000, 60000] },
  YT: { objective: "video_views", placements: ["yt_shorts", "yt_instream"], format: "shorts_or_16_9", dailyIqd: [5000, 15000] },
};

/**
 * The narrowest run of age ranges that holds at least 70 % of the followers ("18-24", "25-34" →
 * 18–34). Null when Instagram gave too little to go on.
 */
export function coreAges(ages: IgAudience["ages"] | undefined): [number, number] | null {
  if (!ages?.length) return null;
  const parsed = ages
    .map((a) => {
      const m = /^(\d+)\s*[-–]\s*(\d+)$/.exec(a.range) ?? /^(\d+)\+$/.exec(a.range);
      return m ? { min: Number(m[1]), max: m[2] ? Number(m[2]) : 65, share: a.share } : null;
    })
    .filter((x): x is { min: number; max: number; share: number } => !!x)
    .sort((a, b) => a.min - b.min);
  if (!parsed.length) return null;
  let best: [number, number] | null = null;
  let bestWidth = Infinity;
  for (let i = 0; i < parsed.length; i++) {
    let share = 0;
    for (let j = i; j < parsed.length; j++) {
      share += parsed[j].share;
      if (share >= 0.7) {
        const width = parsed[j].max - parsed[i].min;
        if (width < bestWidth) {
          bestWidth = width;
          best = [Math.max(18, parsed[i].min), Math.min(65, parsed[j].max)];
        }
        break;
      }
    }
  }
  return best;
}

/** Women or men only when followers are clearly one of them (75 %+); otherwise everyone. */
export function coreGender(ig: IgAudience | null | undefined): PlatformTargeting["gender"] {
  if (ig?.women != null && ig.women >= 0.75) return "women";
  if (ig?.men != null && ig.men >= 0.75) return "men";
  return "all";
}

/**
 * Where to advertise: the cities orders come from, kept to the ones the shop delivers to when it
 * set city fees; with no orders yet, the delivery cities; else the four Kurdistan governorates.
 */
export function targetCities(buyerCities: string[], deliverCities: string[]): string[] {
  const delivers = new Set(deliverCities);
  const buyers = deliverCities.length ? buyerCities.filter((c) => delivers.has(c)) : buyerCities;
  if (buyers.length) return buyers.slice(0, 5);
  if (deliverCities.length) return deliverCities.slice(0, 8);
  return KRI;
}

export function targetingFor(profile: BuyerProfile, ig: IgAudience | null, deliverCities: string[]): Record<AdPlatform, PlatformTargeting> {
  const ages = coreAges(ig?.ages);
  const gender = coreGender(ig);
  const locations = targetCities(profile.cities, deliverCities);
  const hours = profile.hours.length ? profile.hours : DEFAULT_HOURS;
  const languages = profile.languages.length ? profile.languages : ["ckb"];
  const out = {} as Record<AdPlatform, PlatformTargeting>;
  for (const p of AD_PLATFORMS) {
    const [ageMin, ageMax] = ages ?? DEFAULT_AGE[p];
    out[p] = { platform: p, ...PLATFORM[p], locations, ageMin, ageMax, gender, languages, hours, fromFollowers: !!ages };
  }
  return out;
}

/** Where each platform's ads are set up. */
export const ADS_URL: Record<AdPlatform, string> = {
  FB: "https://adsmanager.facebook.com/",
  IG: "https://adsmanager.facebook.com/",
  TT: "https://ads.tiktok.com/",
  YT: "https://ads.google.com/",
};
