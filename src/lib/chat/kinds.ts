// The two kinds of workspace the chat serves, and where each one lives (the shop on gituas.com/app, the newsroom on
// hawalnoos.com/newsroom: the host rules in src/lib/hosts.ts bounce the wrong prefix, so a link must use the right base).

import type { ChatKind } from "./types";

export const baseOf = (kind: ChatKind): "/app" | "/newsroom" => (kind === "news" ? "/newsroom" : "/app");
export const assistantPath = (kind: ChatKind): string => `${baseOf(kind)}/assistant`;
