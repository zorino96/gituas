// The chat can be switched off without a deploy-time code change: CHAT_ENABLED=0 sends everyone back to the older assistant.

export const chatEnabled = (): boolean => process.env.CHAT_ENABLED?.trim() !== "0";

/**
 * The news desk's chat. NEWS_CHAT_ENABLED=1 switches it on for every desk. Until it has run on a real desk, NEWS_CHAT_TENANTS (a
 * comma-separated list of desk ids) switches it on for those desks only; every other desk keeps the older assistant.
 */
export const newsChatEnabled = (tenantId?: string): boolean => {
  if (!chatEnabled()) return false;
  if (process.env.NEWS_CHAT_ENABLED?.trim() === "1") return true;
  const only = (process.env.NEWS_CHAT_TENANTS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return !!tenantId && only.includes(tenantId);
};
