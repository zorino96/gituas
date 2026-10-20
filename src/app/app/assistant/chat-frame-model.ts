// The parts of the chat frame and screen that differ between the shop (/app) and the news desk (/newsroom), kept free of React
// so they can be tested: which chat the address names, which links a card may draw, and when the history list is asked again.

import type { ChatKind, ThreadSummary } from "@/lib/chat/types";
import { safeHref } from "./chat-model";

/**
 * The server writes a better title for a new chat a few seconds after the first answer is finished (title.ts, after the 'done'
 * event). The history list is asked once, this long after that first 'done', so the better title shows without a reload.
 */
export const TITLE_REFRESH_MS = 4_000;

/** The frame is told "MERCHANT" or "NEWS" (the workspace's kind); the chat core calls the same two "shop" and "news". */
export const chatKindOf = (frameKind: "MERCHANT" | "NEWS"): ChatKind => (frameKind === "NEWS" ? "news" : "shop");

/**
 * The stored chat the address names, or null. The prefix is whatever `thread("")` gives ("/app/assistant/", "/newsroom/assistant/"),
 * so no screen has its own pattern. A prefix with a query in it (the dev preview) never matches a path.
 */
export function activeThreadId(path: string, threadHref: (id: string) => string): string | null {
  const prefix = threadHref("");
  if (!prefix.endsWith("/") || /[?#]/.test(prefix) || !path.startsWith(prefix)) return null;
  return /^[^/?#]+/.exec(path.slice(prefix.length))?.[0] ?? null;
}

/** Whether a path is one of the chat's screens: `<base>/assistant` or anything below it. */
export const isChatPathFor = (base: "/app" | "/newsroom", path: string): boolean => path === `${base}/assistant` || path.startsWith(`${base}/assistant/`);

/**
 * A link from a view block. The shop's blocks may link anywhere inside the app. A desk's may only link inside /newsroom (or to an
 * https address): hawalnoos.com bounces every /app path to the shop's domain, so a link to /app would leave the desk.
 */
export function safeHrefFor(kind: ChatKind, href: string | undefined): { href: string; external: boolean } | null {
  const safe = safeHref(href);
  if (!safe || safe.external || kind === "shop") return safe;
  return /^\/newsroom(?:[/?#]|$)/.test(safe.href) ? safe : null;
}

/**
 * The header's title after the history list was read again: the better title of the chat that is open, if the server has one.
 * Nothing changes while the header does not know its title yet (null) or when another chat is open by now.
 */
export function headerTitleAfterRefresh(current: string | null, list: readonly ThreadSummary[], threadId: string, activeId: string | null): string | null {
  if (current === null || activeId !== threadId) return current;
  const fresh = list.find((x) => x.id === threadId)?.title;
  return fresh ? fresh : current;
}

/**
 * The shortcut buttons a screen draws. The weekly note's button ("coach") is shown only while the weekly note is switched on
 * (BUSINESS_PROFILE_ENABLED, which the server page reads and hands down as `coachOn`): with it off the button would take one of the day's
 * shortcut uses, open a chat titled "Weekly note" and answer "not switched on yet". The same list comes back when nothing is hidden.
 */
export function visibleQuickIds(ids: readonly string[], opts: { coachOn: boolean; creator?: boolean }): readonly string[] {
  // The Orders shortcut is for people who sell: a creator (someone who earns from content) never sees it.
  const shown = ids.filter((id) => (opts.coachOn || id !== "coach") && !(opts.creator && id === "orders"));
  return shown.length === ids.length ? ids : shown;
}

/**
 * Whether the screen's page and the frame around it were made for different workspaces. The frame comes from the layout, which a move
 * between two chats does not draw again, so after the person switched workspace in another tab the page can be for the new workspace
 * while the frame still wears the old one's name. A frame that does not know its workspace (null, as in a test) never mismatches.
 */
export const workspaceMismatch = (frameWorkspaceId: string | null, pageWorkspaceId: string): boolean =>
  frameWorkspaceId !== null && frameWorkspaceId !== pageWorkspaceId;

/**
 * A history read that always names the workspace the frame was opened for. The server answers { ok: false, code: "workspace" } when the
 * session has moved to another workspace (the person switched in another tab): `onStale` hears it, and the answer is handed on unchanged.
 */
export function listForWorkspace<I extends object, R extends { ok: boolean }>(
  list: (input?: I & { workspaceId?: string }) => Promise<R>,
  workspaceId: string,
  onStale: () => void,
): (input?: I) => Promise<R> {
  return async (input) => {
    const answer = await list({ ...(input ?? ({} as I)), workspaceId });
    if (!answer.ok && (answer as { code?: unknown }).code === "workspace") onStale();
    return answer;
  };
}
