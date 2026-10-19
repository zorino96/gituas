// The chat can be switched off without a deploy-time code change: CHAT_ENABLED=0 sends everyone back to the older assistant.

export const chatEnabled = (): boolean => process.env.CHAT_ENABLED?.trim() !== "0";
