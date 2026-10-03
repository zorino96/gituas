/** One platform account shown under a plan on the billing page; the page names the platform from `t.platform[platform]`. */
export interface PlatformChip {
  platform: "FB" | "IG" | "TT" | "YT";
  name: string;
}

interface Account {
  connected: boolean;
  name?: string;
  accountId?: string;
}

/** The workspace's connected accounts, as the billing page needs them. */
export interface WorkspaceAccounts {
  fb: Account;
  ig: Account;
  tt: Account;
  yt: Account;
}

const at = (name: string) => (name.startsWith("@") ? name : `@${name}`);

/** TikTok and YouTube belong to the workspace, not to one store, so every plan shows them. */
function videoChips(a: WorkspaceAccounts): PlatformChip[] {
  const out: PlatformChip[] = [];
  if (a.tt.connected) out.push({ platform: "TT", name: a.tt.name || "—" });
  if (a.yt.connected) out.push({ platform: "YT", name: a.yt.name || "—" });
  return out;
}

/** A store's own Page and Instagram, then the workspace's TikTok and YouTube. */
export function storeChips(
  store: { name: string; fbPageId: string | null; igUserId: string | null; igUsername: string | null },
  a: WorkspaceAccounts,
): PlatformChip[] {
  const out: PlatformChip[] = [];
  if (store.fbPageId) {
    const conn = a.fb.connected && a.fb.accountId === store.fbPageId ? a.fb.name : undefined;
    out.push({ platform: "FB", name: conn || store.name || "—" });
  }
  if (store.igUserId || store.igUsername) {
    const conn = a.ig.connected && a.ig.accountId === store.igUserId ? a.ig.name : undefined;
    const handle = store.igUsername || conn;
    out.push({ platform: "IG", name: handle ? at(handle) : "—" });
  }
  return [...out, ...videoChips(a)];
}

/** The newsroom variant: every connected account of the workspace. */
export function workspaceChips(a: WorkspaceAccounts): PlatformChip[] {
  const out: PlatformChip[] = [];
  if (a.fb.connected) out.push({ platform: "FB", name: a.fb.name || "—" });
  if (a.ig.connected) out.push({ platform: "IG", name: a.ig.name ? at(a.ig.name) : "—" });
  return [...out, ...videoChips(a)];
}
