// The chat's words for a news desk: the shop's chat text (chat.*.ts) with the desk's own wording laid over it (chat-news.*.ts).
// Nothing here is server-only, so the client provider can use it (ChatCopyProvider in client.tsx).

import { ar } from "./ar";
import { chatNewsAr } from "./chat-news.ar";
import { chatNewsCkb } from "./chat-news.ckb";
import { chatNewsEn } from "./chat-news.en";
import { ckb } from "./ckb";
import { en } from "./en";
import type { Lang } from "./lang";

type Chat = typeof ckb.chat;
export type NewsChatText = typeof chatNewsCkb;

const OVERLAY: Record<Lang, NewsChatText> = { ckb: chatNewsCkb, ar: chatNewsAr, en: chatNewsEn };
const BASE: Record<Lang, Chat> = { ckb: ckb.chat, ar: ar.chat, en: en.chat };

/** The desk's own sentences (also the few the shop's text has no place for, like settings.frozenNote). */
export const newsChatText = (lang: Lang): NewsChatText => OVERLAY[lang];

function merge(base: Chat, o: NewsChatText): Chat {
  return {
    ...base,
    sidebar: { ...base.sidebar, ...o.sidebar },
    screen: { ...base.screen, ...o.screen },
    empty: { ...base.empty, ...o.empty },
    // The shop's shortcuts stay in the table (nothing draws them for a desk): the desk's six are laid beside them.
    quick: { ...base.quick, ...o.quick },
    // A desk is not on the AI allowance (its turns are bounded by the plan's counts and the turn caps), so that error can never reach it; if
    // it ever did, the person reads the general one, never a sentence about an allowance or about buyers.
    errors: { ...base.errors, allowance: base.errors.internal, ...o.errors },
    // The overlay names the one risk line a desk words differently (what "money" means for a desk); the other four stay the shop's.
    runs: { ...base.runs, ...o.runs, risk: { ...base.runs.risk, ...o.runs.risk } },
    settings: {
      ...base.settings,
      levels: { ...base.settings.levels, LOW: { ...base.settings.levels.LOW, ...o.settings.levels.LOW }, ALL: { ...base.settings.levels.ALL, ...o.settings.levels.ALL } },
      ownerOnly: o.settings.ownerOnly,
      deleteHelp: o.settings.deleteHelp,
      retention: o.settings.retention,
    },
  };
}

// One object per language for the whole session: a component that keeps `t.chat` in a dependency list is not woken again for nothing.
const cache = new Map<Lang, Chat>();

/** The chat dictionary a desk's screens read as `t.chat`. */
export function newsChat(lang: Lang): Chat {
  let out = cache.get(lang);
  if (!out) {
    out = merge(BASE[lang], OVERLAY[lang]);
    cache.set(lang, out);
  }
  return out;
}
