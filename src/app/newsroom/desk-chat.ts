// Where the news desk's chat lives and what its frame lists. Pure (no React, no server code), so it can be tested.
//
// The desk's chat is under /newsroom, never /app: hawalnoos.com bounces every /app path to the shop's domain (src/lib/hosts.ts), so a link,
// a redirect or an OAuth return that pointed at /app would throw the person out of the desk.

import type { ChatHrefs } from "@/app/app/assistant/chat-shell";
import { isChatPathFor } from "@/app/app/assistant/chat-frame-model";
import { baseOf } from "@/lib/chat/kinds";
import { NAV, type NavItem } from "@/lib/newsroom/nav";

export const DESK_BASE = baseOf("news");

export const DESK_HREFS: ChatHrefs = {
  newChat: `${DESK_BASE}/assistant`,
  thread: (id) => `${DESK_BASE}/assistant/${id}`,
};

/** Where the Settings link of the chat's sidebar goes. */
export const DESK_SETTINGS_HREF = `${DESK_BASE}/settings`;

/** Whether a path is one of the desk chat's screens (a new chat, or a stored one). */
export const isDeskChatPath = (path: string): boolean => isChatPathFor(DESK_BASE, path);

/**
 * The desk's other screens, for the chat sidebar's list. The assistant is the chat itself (the "New chat" button) and Settings has its
 * own link at the foot, so neither is repeated.
 */
export const deskSectionItems = (): NavItem[] => NAV.filter((i) => i.key !== "assistant" && i.key !== "settings");

/** The address of a stored chat; a new chat takes it once the server gave the chat an id. */
export const deskThreadHref = (id: string): string => DESK_HREFS.thread(id);
