// How many accounts of one platform a single post may go to. Safe for the browser.
//
// A workspace may connect several Pages / Instagram accounts / channels, and one post may go to
// more than one of them. Sending identical posts to a long list of accounts is what the platforms'
// spam systems look for, so a post is capped (the composer says so and the server enforces it).

/** Accounts of one platform in one post. TikTok is always one (its rules show one creator's settings). */
export const MAX_ACCOUNTS_PER_POST = 5;

export function clampAccounts<T>(ids: T[], target: "FB" | "IG" | "TT" | "YT"): T[] {
  return ids.slice(0, target === "TT" ? 1 : MAX_ACCOUNTS_PER_POST);
}
