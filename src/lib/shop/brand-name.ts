// The name a page goes by. A store is named after its account when it is made ("NSFW"); the Page can be renamed afterwards ("The Secret
// File"), and then the stored name is old. Anything the owner or the public reads (a card, a video's brand name) uses the names the
// connected accounts have now.

import { db } from "@/lib/db";

interface Accounts {
  tenantId: string;
  name: string;
  igUsername: string | null;
  fbPageId: string | null;
  igUserId: string | null;
}

/** The names the store's connected Page and Instagram account carry now (nothing for an account that is not connected here). */
async function liveNames(s: Accounts): Promise<{ fb: string | null; ig: string | null }> {
  const ids = [s.fbPageId, s.igUserId].filter((x): x is string => !!x);
  if (!ids.length) return { fb: null, ig: null };
  // A name that cannot be read is no reason to refuse the change: the stored name stands in.
  const rows = await Promise.resolve()
    .then(() => db.oAuthCredential.findMany({ where: { tenantId: s.tenantId, providerAccountId: { in: ids } }, select: { provider: true, providerAccountId: true, providerAccountName: true } }))
    .catch(() => [] as { provider: string; providerAccountId: string; providerAccountName: string | null }[]);
  const pick = (provider: string, id: string | null) => (id ? rows.find((r) => r.provider === provider && r.providerAccountId === id)?.providerAccountName?.replace(/\s+/g, " ").trim().slice(0, 60) || null : null);
  return { fb: pick("META_FACEBOOK", s.fbPageId), ig: pick("META_INSTAGRAM", s.igUserId) };
}

const handle = (s: Accounts, ig: string | null): string | null => (s.igUsername ? `@${s.igUsername}` : ig ? (ig.startsWith("@") ? ig : `@${ig}`) : null);

/** One name for a brand (a video's brand name): the Facebook Page's name, else the Instagram handle, else the stored name. */
export async function brandNameOf(s: Accounts): Promise<string> {
  const { fb, ig } = await liveNames(s);
  return fb || handle(s, ig) || s.name;
}

/** What a card says the change is for: the Page and the Instagram account it covers ("The Secret File + @thesecretfile26"), else the stored name. */
export async function accountsPhraseOf(s: Accounts): Promise<string> {
  const { fb, ig } = await liveNames(s);
  const parts = [fb, s.igUserId ? handle(s, ig) : null].filter((x): x is string => !!x);
  return parts.length ? parts.join(" + ") : s.name || (s.igUsername ? `@${s.igUsername}` : "");
}
