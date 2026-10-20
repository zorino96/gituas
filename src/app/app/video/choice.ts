// Which language and which kind a video is made in. One rule for the Video screen's action and for the chat's card, so the card
// always shows what the run will really do (a plain module: the "use server" file next to it can only export actions).
//
//   language: what was asked, else the store's own video language (Store.videoLang), else Sorani.
//             Never the language of the person's screen and never the business profile's language.
//   kind:     what was asked; else an ad when a product was named or chosen (a video of a product is an ad for it, whatever the page is
//             for); else what the page is for (BusinessProfile.goal: growing or monetizing an audience is a story, the rest an ad);
//             a profile that cannot be read is an ad.

import { isVideoKind, isVideoLang, kindForGoal, videoLangOf, type VideoKind, type VideoLang } from "@/lib/advideo/lang";
import { loadProfile } from "@/lib/shop/profile";

export async function videoChoice(
  storeId: string,
  /** Store.videoLang as stored (null or missing = Sorani). */
  storeLang: string | null | undefined,
  asked: { lang?: unknown; kind?: unknown; /** A product was named or chosen: it is an ad for that product unless a kind says otherwise. */ hasProduct?: boolean } = {},
): Promise<{ lang: VideoLang; kind: VideoKind }> {
  const lang = isVideoLang(asked.lang) ? asked.lang : videoLangOf(storeLang);
  if (isVideoKind(asked.kind)) return { lang, kind: asked.kind };
  if (asked.hasProduct) return { lang, kind: "ad" };
  let profile: Awaited<ReturnType<typeof loadProfile>> = null;
  try {
    profile = await loadProfile(storeId);
  } catch {
    profile = null;
  }
  return { lang, kind: kindForGoal(profile?.goal ?? null) };
}
