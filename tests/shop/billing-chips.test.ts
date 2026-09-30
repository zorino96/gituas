import { describe, expect, it } from "vitest";
import { storeChips, workspaceChips, type WorkspaceAccounts } from "@/app/app/billing/chips";

const off = { connected: false };
const accounts = (over: Partial<WorkspaceAccounts> = {}): WorkspaceAccounts => ({ fb: off, ig: off, tt: off, yt: off, ...over });

describe("storeChips", () => {
  it("lists the store's Page and Instagram, then the workspace's TikTok and YouTube", () => {
    const a = accounts({ tt: { connected: true, name: "tt_name" }, yt: { connected: true, name: "My Channel" } });
    const chips = storeChips({ name: "NSFW", fbPageId: "P1", igUserId: "I1", igUsername: "nsfw" }, a);
    expect(chips).toEqual([
      { platform: "FB", name: "NSFW" },
      { platform: "IG", name: "@nsfw" },
      { platform: "TT", name: "tt_name" },
      { platform: "YT", name: "My Channel" },
    ]);
  });
  it("skips a slot the store does not have and platforms that are not connected", () => {
    expect(storeChips({ name: "Shop", fbPageId: null, igUserId: "I1", igUsername: "shop" }, accounts())).toEqual([{ platform: "IG", name: "@shop" }]);
  });
  it("falls back to the connection name when the store has no Instagram username", () => {
    const a = accounts({ ig: { connected: true, name: "@from_conn", accountId: "I1" } });
    expect(storeChips({ name: "Shop", fbPageId: null, igUserId: "I1", igUsername: null }, a)).toEqual([{ platform: "IG", name: "@from_conn" }]);
  });
});

describe("workspaceChips", () => {
  it("shows every connected account of the workspace", () => {
    const a = accounts({ fb: { connected: true, name: "News Page", accountId: "P" }, yt: { connected: true, name: "Channel" } });
    expect(workspaceChips(a)).toEqual([
      { platform: "FB", name: "News Page" },
      { platform: "YT", name: "Channel" },
    ]);
  });
  it("is empty when nothing is connected", () => {
    expect(workspaceChips(accounts())).toEqual([]);
  });
});
