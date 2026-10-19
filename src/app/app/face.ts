// The two faces of the app, the classic screens and the chat, and how the app decides which one to open on.
//
// A cookie (gm_ui) remembers the face the person last used, so /app opens on it. The chat frame writes "chat" whenever it is
// shown. The classic "Today" link must always lead OUT of the chat, whatever the cookie says, on a wide window and on a phone, and
// also when the chat is switched off: it points at /app?ui=classic, which /app honours (see opensOnChat) and which writes "classic".

export const FACE_COOKIE = "gm_ui";
/** Where the classic "Today" goes: the query tells /app not to send the person back to the chat. */
export const CLASSIC_HOME = "/app?ui=classic";

/** The address a classic section link should use: Today carries the query, every other section is its own address. */
export const classicHref = (href: string): string => (href === "/app" ? CLASSIC_HOME : href);

/** Remembers the face for a year. Browser only; a browser that blocks cookies simply forgets it after this visit. */
export function rememberFace(face: "chat" | "classic"): void {
  try {
    document.cookie = `${FACE_COOKIE}=${face}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    /* cookies blocked: the choice only lasts for this visit */
  }
}

/**
 * Whether /app (Today) hands the person to the chat instead of showing Today. Only when everything agrees:
 *   - a shop, and a role that may use the chat;
 *   - the chat is switched on (a cookie left from before a switch-off must not trap anyone on the older assistant);
 *   - the last face was the chat;
 *   - the person did not ask for the classic screen with ?ui=classic.
 * The chat never sends anyone back to /app, so there is no loop.
 */
export function opensOnChat(i: { merchant: boolean; canConfigure: boolean; chatOn: boolean; cookie: string | undefined; ui: string | string[] | undefined }): boolean {
  const asked = Array.isArray(i.ui) ? i.ui[0] : i.ui;
  return i.merchant && i.canConfigure && i.chatOn && i.cookie === "chat" && asked !== "classic";
}
