// The chat can be switched off without a deploy-time code change: CHAT_ENABLED=0 sends everyone back to the older assistant.

export const chatEnabled = (): boolean => process.env.CHAT_ENABLED?.trim() !== "0";

/** The news desk's chat is switched on only when NEWS_CHAT_ENABLED=1 (until it has run on a real desk, the older assistant stays). */
export const newsChatEnabled = (): boolean => chatEnabled() && process.env.NEWS_CHAT_ENABLED?.trim() === "1";
