import { beforeEach, describe, expect, it, vi } from "vitest";

const ws = vi.hoisted(() => ({ current: { id: "t1", role: "OWNER", kind: "MERCHANT" } as { id: string; role: string; kind: string } | null }));
const db = vi.hoisted(() => ({
  store: { findMany: vi.fn(), findUnique: vi.fn() },
  product: { findMany: vi.fn() },
  newsFrame: { findUnique: vi.fn() },
  brandKit: { findUnique: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/app/app/data", () => ({
  currentWorkspace: vi.fn(async () => ws.current),
  loadAccountLists: vi.fn(async () => ({ META_FACEBOOK: [{}], META_INSTAGRAM: [], TIKTOK: [], YOUTUBE: [] })),
  loadConnections: vi.fn(async () => ({
    META_FACEBOOK: { connected: true, accountId: "fb1", name: "Page" },
    META_INSTAGRAM: { connected: false },
    TIKTOK: { connected: false },
    YOUTUBE: { connected: false },
  })),
}));
vi.mock("@/lib/i18n", async () => {
  const { en } = await import("@/lib/i18n/en");
  return { dict: () => en, getLang: async () => "en" };
});
vi.mock("@/lib/shop/tenant-plans", () => ({ limitsOf: vi.fn(async () => ({ aiUsd: 2, videos: { LITE: 16, PRO: 0 } })) }));
vi.mock("@/lib/ai/slots", () => ({ claimSlot: vi.fn(), refundSlot: vi.fn(), takeDaily: vi.fn(async () => 1) }));
vi.mock("@/lib/ai/image", () => ({ imageEnabled: vi.fn(() => true) }));
vi.mock("@/lib/advideo/enabled", () => ({ adVideoEnabled: vi.fn(() => true) }));
vi.mock("@/app/app/actions", () => ({ publishAction: vi.fn(), saveWhatsAppAction: vi.fn() }));
vi.mock("@/app/app/automation/actions", () => ({ saveStoreSettingsAction: vi.fn(), saveProductAction: vi.fn(), archiveProductAction: vi.fn() }));
vi.mock("@/app/app/publish/ai-image-action", () => ({ generateAiImageAction: vi.fn() }));
vi.mock("@/app/app/publish/schedule-actions", () => ({ schedulePublishAction: vi.fn() }));
vi.mock("@/app/app/video/actions", () => ({ createVideoAction: vi.fn(), saveVideoAutoAction: vi.fn() }));
vi.mock("@/app/newsroom/(desk)/news/actions", () => ({
  designSectionFrameAction: vi.fn(),
  saveDesignPromptAction: vi.fn(),
  saveSectionFrameTextAction: vi.fn(),
  removeSectionFrameAction: vi.fn(),
}));

import { takeDaily } from "@/lib/ai/slots";
import { publishAction, saveWhatsAppAction } from "@/app/app/actions";
import { archiveProductAction, saveProductAction, saveStoreSettingsAction } from "@/app/app/automation/actions";
import { generateAiImageAction } from "@/app/app/publish/ai-image-action";
import { schedulePublishAction } from "@/app/app/publish/schedule-actions";
import { createVideoAction, saveVideoAutoAction } from "@/app/app/video/actions";
import { designSectionFrameAction, removeSectionFrameAction, saveDesignPromptAction, saveSectionFrameTextAction } from "@/app/newsroom/(desk)/news/actions";
import { runToolAction } from "@/app/app/assistant/actions";
import { en } from "@/lib/i18n/en";

const OWN = "https://abc.public.blob.vercel-storage.com/merchant/t1/chat/1.jpg";
const seen = new Set<string>();
let n = 0;
const nonce = () => `${(++n).toString(16).padStart(16, "0")}`;
const att = { id: "a1", url: OWN, pathname: "merchant/t1/chat/1.jpg", kind: "image" as const, name: "bag.jpg" };

beforeEach(() => {
  vi.clearAllMocks();
  ws.current = { id: "t1", role: "OWNER", kind: "MERCHANT" };
  vi.mocked(takeDaily).mockResolvedValue(1);
  db.store.findUnique.mockResolvedValue({ videoAutoHour: 21, videoAutoTier: "LITE" });
  db.store.findMany.mockResolvedValue([
    { id: "s1", name: "Shop one", igUsername: null, fbPageId: "other", igUserId: null },
    { id: "s2", name: "Shop two", igUsername: null, fbPageId: "fb1", igUserId: null },
  ]);
  db.newsFrame.findUnique.mockResolvedValue(null);
  db.brandKit.findUnique.mockResolvedValue({ frameText: "top" });
  db.product.findMany.mockResolvedValue([
    { id: "p1", name: "Gold ring", storeId: "s1" },
    { id: "p2", name: "Silver ring", storeId: "s2" },
  ]);
});

describe("runToolAction", () => {
  it("runs one card once: the same nonce again does nothing, and another workspace's screen is refused", async () => {
    vi.mocked(saveStoreSettingsAction).mockResolvedValue({ ok: true });
    const same = nonce();
    // The first claim of a nonce passes; its second does not (the counter says one is the most).
    vi.mocked(takeDaily).mockImplementation(async (_w, metric) => (String(metric).startsWith("chatrun_") && seen.has(String(metric)) ? 0 : (seen.add(String(metric)), 1)));
    const first = await runToolAction({ workspaceId: "t1", nonce: same, tool: "set_auto_replies", args: { on: true } });
    const again = await runToolAction({ workspaceId: "t1", nonce: same, tool: "set_auto_replies", args: { on: true } });
    expect(first.ok).toBe(true);
    expect(again).toMatchObject({ ok: false });
    expect(saveStoreSettingsAction).toHaveBeenCalledTimes(1);
    expect(await runToolAction({ workspaceId: "t2", nonce: nonce(), tool: "set_auto_replies", args: { on: true } })).toMatchObject({ ok: false });
    expect(await runToolAction({ workspaceId: "t1", nonce: "not-a-nonce", tool: "set_auto_replies", args: { on: true } })).toMatchObject({ ok: false });
  });

  it("runs a post through the app's own publish action, with the shop's own picture, for a connected platform", async () => {
    vi.mocked(publishAction).mockResolvedValue({ ok: true, results: [{ target: "FB", ok: true }] });
    const r = await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "post_now", args: { caption: "Hello", targets: ["FB"], media: "a1", product: "silver ring" }, attachments: [att] });
    expect(r.ok).toBe(true);
    expect(vi.mocked(publishAction).mock.calls[0][0]).toEqual({
      caption: "Hello",
      targets: ["FB"],
      media: { url: OWN, pathname: att.pathname, type: "IMAGE" },
      productId: "p2",
    });
  });

  it("refuses a platform that is not connected, without publishing", async () => {
    const r = await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "post_now", args: { caption: "x", targets: ["IG"], media: "a1" }, attachments: [att] });
    expect(r).toMatchObject({ ok: false });
    expect(publishAction).not.toHaveBeenCalled();
  });

  it("does not trust an attachment address from the screen: only this workspace's own uploads count", async () => {
    const foreign = { ...att, url: "https://abc.public.blob.vercel-storage.com/merchant/t2/chat/1.jpg", pathname: "merchant/t2/chat/1.jpg" };
    const evil = { ...att, id: "a2", url: "https://evil.example/x.jpg", pathname: "merchant/t1/chat/x.jpg" };
    const r = await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "post_now", args: { caption: "x", targets: ["FB"], media: "a1" }, attachments: [foreign, evil] });
    expect(r).toMatchObject({ ok: false });
    expect(publishAction).not.toHaveBeenCalled();
  });

  it("refuses a tool that is not on the list and arguments that do not fit", async () => {
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_plan", args: { plan: "MAX" } })).toMatchObject({ ok: false });
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_autopilot", args: { mode: "ALWAYS" } })).toMatchObject({ ok: false });
    expect(saveStoreSettingsAction).not.toHaveBeenCalled();
  });

  it("stops when the day's actions are used up, and when the product is not found exactly", async () => {
    vi.mocked(takeDaily).mockResolvedValueOnce(0);
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_auto_replies", args: { on: true } })).toMatchObject({ ok: false });
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea: "a short ad", product: "ring" } })).toMatchObject({ ok: false });
    expect(createVideoAction).not.toHaveBeenCalled();
  });

  it("turns the automatic replies, the autopilot and the daily video on through the app's own actions, for the connected shop", async () => {
    vi.mocked(saveStoreSettingsAction).mockResolvedValue({ ok: true });
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_auto_replies", args: { on: true } });
    expect(saveStoreSettingsAction).toHaveBeenCalledWith("s2", { automationEnabled: true });
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_autopilot", args: { mode: "PUBLISH", perDay: 2 } });
    expect(saveStoreSettingsAction).toHaveBeenLastCalledWith("s2", { autoMode: "PUBLISH", autoPerDay: 2 });
    vi.mocked(saveVideoAutoAction).mockResolvedValue({ ok: true });
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_daily_video", args: { mode: "DRAFT", hour: 20 } });
    expect(saveVideoAutoAction).toHaveBeenCalledWith("s2", { mode: "DRAFT", tier: "LITE", hour: 20 });
    // No hour on the card: the one already chosen stays.
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_daily_video", args: { mode: "PUBLISH" } });
    expect(saveVideoAutoAction).toHaveBeenLastCalledWith("s2", { mode: "PUBLISH", tier: "LITE", hour: 21 });
  });

  it("passes the video's language and kind on only when the model gave them, and the daily video's language only when it was given", async () => {
    vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1" });
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea: "a short ad" } });
    const plain = vi.mocked(createVideoAction).mock.calls[0][1];
    expect(plain).toEqual({ tier: "LITE", topic: "a short ad", productId: null, voice: "shilan", publish: false, targets: [], review: true });
    expect("lang" in plain || "kind" in plain).toBe(false);
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea: "a mystery about a letter", language: "en", kind: "story" } });
    expect(vi.mocked(createVideoAction).mock.calls[1][1]).toMatchObject({ topic: "a mystery about a letter", lang: "en", kind: "story", voice: "shilan" });
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea: "a short ad", language: "ar" } });
    const arabic = vi.mocked(createVideoAction).mock.calls[2][1];
    expect(arabic).toMatchObject({ lang: "ar" });
    expect("kind" in arabic).toBe(false);
    // A language the schema does not know never reaches the action.
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea: "a short ad", language: "fr" } })).toMatchObject({ ok: false });
    expect(createVideoAction).toHaveBeenCalledTimes(3);

    vi.mocked(saveVideoAutoAction).mockResolvedValue({ ok: true });
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_daily_video", args: { mode: "OFF", language: "en" } });
    expect(saveVideoAutoAction).toHaveBeenLastCalledWith("s2", { mode: "OFF", tier: "LITE", hour: 21, lang: "en" });
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_daily_video", args: { mode: "DRAFT", hour: 20 } });
    expect(saveVideoAutoAction).toHaveBeenLastCalledWith("s2", { mode: "DRAFT", tier: "LITE", hour: 20 });
  });

  it("changes only the daily video's language or hour when no mode is given: the action gets no mode, so it stays on or off as it was", async () => {
    vi.mocked(saveVideoAutoAction).mockResolvedValue({ ok: true });
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_daily_video", args: { language: "en" } });
    const onlyLanguage = vi.mocked(saveVideoAutoAction).mock.calls.at(-1)![1];
    expect(onlyLanguage).toEqual({ tier: "LITE", hour: 21, lang: "en" });
    expect("mode" in onlyLanguage).toBe(false);
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_daily_video", args: { hour: 8 } });
    expect(vi.mocked(saveVideoAutoAction).mock.calls.at(-1)![1]).toEqual({ tier: "LITE", hour: 8 });
    // Nothing to change at all is no proposal.
    const calls = vi.mocked(saveVideoAutoAction).mock.calls.length;
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_daily_video", args: {} })).toMatchObject({ ok: false });
    expect(saveVideoAutoAction).toHaveBeenCalledTimes(calls);
  });

  it("passes the Wikimedia Commons photo switch of a story on only when it is a true or false, and never confuses it with a product's photos", async () => {
    vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1" });
    const idea = "Hinterkaifeck murders 1922";
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea, language: "en", kind: "story", photos: false } })).toMatchObject({ ok: true, jobId: "job1" });
    expect(vi.mocked(createVideoAction).mock.calls.at(-1)![1]).toMatchObject({ topic: idea, lang: "en", kind: "story", photos: false });
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea, language: "ar", kind: "story", photos: true } });
    expect(vi.mocked(createVideoAction).mock.calls.at(-1)![1]).toMatchObject({ lang: "ar", photos: true });
    // Left out, the action is told nothing about photographs (its default applies): an ad and a story with no word on it send none.
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea, language: "en", kind: "story" } });
    expect("photos" in vi.mocked(createVideoAction).mock.calls.at(-1)![1]).toBe(false);
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea: "a short ad" } });
    expect("photos" in vi.mocked(createVideoAction).mock.calls.at(-1)![1]).toBe(false);
    // Anything that is not a true or false never reaches the action.
    const calls = vi.mocked(createVideoAction).mock.calls.length;
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea, photos: "off" } })).toMatchObject({ ok: false });
    expect(createVideoAction).toHaveBeenCalledTimes(calls);
  });

  it("passes a story's shape on only when it is vertical or wide; left out nothing is sent, and anything else never reaches the action", async () => {
    vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1" });
    const idea = "one of the historical mystery stories, crime";
    const last = () => vi.mocked(createVideoAction).mock.calls.at(-1)![1];
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea, kind: "story", format: "wide" } });
    expect(last()).toMatchObject({ kind: "story", format: "wide" });
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea, kind: "story", format: "vertical" } });
    expect(last()).toMatchObject({ format: "vertical" });
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea, kind: "story" } });
    expect("format" in last()).toBe(false);
    const calls = vi.mocked(createVideoAction).mock.calls.length;
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea, kind: "story", format: "16:9" } })).toMatchObject({ ok: false });
    expect(createVideoAction).toHaveBeenCalledTimes(calls);
  });

  describe("what the chat is told after a video was started: the facts of the job, and what was not used", () => {
    const idea = "one of the historical mystery stories, crime";
    const start = async (args: Record<string, unknown>, attachments?: unknown[]) => {
      const r = await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea, ...args }, ...(attachments ? { attachments } : {}) } as never);
      expect(r.ok).toBe(true);
      return (r as { text: string }).text.split("\n");
    };
    const vid = { id: "a2", url: "https://abc.public.blob.vercel-storage.com/merchant/t1/chat/2.mp4", pathname: "merchant/t1/chat/2.mp4", kind: "video" as const, name: "Video Project 1.mp4" };

    it("says the format, the language, the photographs and the credits of a wide story as the job really is, and that nothing went to YouTube", async () => {
      vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1", facts: { lang: "ckb", kind: "story", format: "wide", photos: "on" } });
      const lines = await start({ kind: "story", format: "wide" });
      expect(lines[0]).toBe(en.assistant.done.videoStarted);
      expect(lines).toContain("Format: wide 16:9.");
      expect(lines).toContain("Language: Sorani Kurdish.");
      // The owner who asked for 30 seconds is told what the writer really does: it aims for about 30 seconds and cannot promise it.
      expect(lines).toContain("Length: about 60 to 70 seconds. If your idea asks for a short video, Gituas aims for about 30 seconds but cannot promise it.");
      expect(lines.join(" ")).not.toMatch(/cannot be chosen/);
      expect(lines).toContain("Photos: free ones from Wikimedia Commons where they are found.");
      expect(lines).toContain("Credits go in the caption and on the last scene.");
      expect(lines).toContain(en.assistant.done.videoNotYouTube);
      expect(en.assistant.done.videoNotYouTube).toMatch(/not sent to YouTube from here: download it and add it in Publish or in YouTube Studio\. YouTube keeps every upload Private until Google finishes reviewing Gituas/);
      // No review ran (the mocked action reports none): the result says the idea was used exactly as written.
      expect(lines.at(-1)).toBe(en.assistant.done.videoUsedAsWritten);
      expect(lines.join(" ")).not.toMatch(/vertical/);
    });

    it("says vertical when the job is vertical, whatever was asked: the facts are the job's, not the request's", async () => {
      vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1", facts: { lang: "en", kind: "story", format: "vertical", photos: "on" } });
      const lines = await start({ kind: "story", format: "wide", language: "en" });
      expect(lines).toContain("Format: vertical 9:16.");
      expect(lines).toContain("Language: English.");
      expect(lines).not.toContain("Format: wide 16:9.");
    });

    it("says no photographs when they are off, and that a fiction is invented and has none, with no credits line for either", async () => {
      vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1", facts: { lang: "ar", kind: "story", format: "vertical", photos: "off" } });
      const off = await start({ kind: "story", photos: false });
      expect(off).toContain("Photos: none (switched off).");
      expect(off).not.toContain("Credits go in the caption and on the last scene.");
      vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1", facts: { lang: "en", kind: "story", format: "vertical", photos: "fiction" } });
      const fiction = await start({ kind: "story" });
      expect(fiction).toContain("Told as an invented story (fiction), with no real photographs.");
      expect(fiction.join(" ")).not.toMatch(/Wikimedia|Credits|Case:/);
    });

    it("gives an ad its format and language only: always vertical, no photographs, no case, no YouTube line", async () => {
      vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1", facts: { lang: "en", kind: "ad", format: "vertical" } });
      const lines = await start({ kind: "ad" });
      expect(lines).toEqual([en.assistant.done.videoStarted, "Format: vertical 9:16.", "Language: English.", "Length: about 35 seconds; an ad's length is fixed."]);
    });

    it("says nothing about the format or language when the job could not be read back (never a guess)", async () => {
      vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1" });
      expect(await start({ kind: "story", format: "wide" })).toEqual([en.assistant.done.videoStarted, en.assistant.done.videoUsedAsWritten]);
    });

    it("says FIRST that an attached video was NOT used, and that an attached picture was not either; a picture the chat made itself is not the owner's", async () => {
      vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1", facts: { lang: "ckb", kind: "story", format: "wide", photos: "on" } });
      const lines = await start({ kind: "story", format: "wide" }, [vid, att]);
      expect(lines[0]).toBe("The attached video was NOT used: Gituas cannot learn from a video yet.");
      expect(lines[1]).toBe("The attached picture was NOT used: Gituas cannot use your pictures in a story yet.");
      expect(lines[2]).toBe(en.assistant.done.videoStarted);
      const made = { ...att, id: "a3", name: en.assistant.done.pictureName };
      const only = await start({ kind: "story" }, [made]);
      expect(only[0]).toBe(en.assistant.done.videoStarted);
      // An ad does not use chat attachments either, but it is not a story: its result stays as it was.
      vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1", facts: { lang: "en", kind: "ad", format: "vertical" } });
      expect((await start({ kind: "ad" }, [vid]))[0]).toBe(en.assistant.done.videoStarted);
    });

    it("says what the review did: 'Reviewed' only when the idea was rewritten, and the neutral sentence when there was nothing to read", async () => {
      vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1", reviewed: { text: "a brief", summary: "added the angle" } });
      const reviewed = await start({ kind: "story", review: true });
      expect(reviewed.at(-1)).toBe("Reviewed: added the angle");
      const said = "Nothing to read yet: your words were used as written.";
      vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1", reviewSkipped: { summary: said } });
      const skipped = await start({ kind: "story", review: true });
      expect(skipped.at(-1)).toBe(said);
      expect(skipped.join(" ")).not.toMatch(/Reviewed/);
    });
  });

  it("a story's review is what the owner said (review true or false), else the screen's switch; an ad keeps the screen's switch", async () => {
    vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1" });
    const idea = "one of the historical mystery stories, crime";
    const last = () => vi.mocked(createVideoAction).mock.calls.at(-1)![1];
    // The screen's switch is OFF and nothing was said: the story goes straight to the video maker (literal).
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea, language: "en", kind: "story" }, review: false });
    expect(last()).toMatchObject({ topic: idea, kind: "story", review: false });
    // The switch is ON (the default) and nothing was said: the switch decides.
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea, language: "en", kind: "story" } });
    expect(last()).toMatchObject({ topic: idea, kind: "story", review: true });
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea, language: "en", kind: "story", review: false } });
    expect(last()).toMatchObject({ review: false });
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea, language: "ckb", kind: "story", review: true }, review: false });
    expect(last()).toMatchObject({ kind: "story", lang: "ckb", review: true });
    // An ad is reviewed as the switch says, exactly as before, and an ad's own review flag is not read.
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea: "a short ad", kind: "ad" } });
    expect(last()).toMatchObject({ kind: "ad", review: true });
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea: "a short ad", kind: "ad", review: true }, review: false });
    expect(last()).toMatchObject({ review: false });
    // Anything that is not a true or false never reaches the action.
    const calls = vi.mocked(createVideoAction).mock.calls.length;
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea, review: "yes" } })).toMatchObject({ ok: false });
    expect(createVideoAction).toHaveBeenCalledTimes(calls);
  });

  it("hands a named product to the video action with no kind: the action makes it an ad, whatever the page is for", async () => {
    vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1" });
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea: "a short ad", product: "silver ring" } });
    const sent = vi.mocked(createVideoAction).mock.calls.at(-1)![1];
    expect(sent).toMatchObject({ productId: "p2", topic: "a short ad" });
    expect("kind" in sent).toBe(false);
  });

  it("makes a picture with the reviewed idea and the attached references, and a video through the video action", async () => {
    vi.mocked(generateAiImageAction).mockResolvedValue({ ok: true, media: { url: OWN, pathname: att.pathname, type: "IMAGE" }, prompt: "p", reviewed: true, summary: "" });
    const r = await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_picture", args: { idea: "ring on marble", references: ["a1"], shape: "portrait" }, attachments: [att] });
    expect(r).toMatchObject({ ok: true, media: { url: OWN, kind: "image" } });
    expect(vi.mocked(generateAiImageAction).mock.calls[0][0]).toMatchObject({ idea: "ring on marble", refUrls: [OWN], shape: "portrait", review: true });
    // The owner's switch is passed on: off means the words go through as typed.
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_picture", args: { idea: "ring on marble" }, review: false });
    expect(vi.mocked(generateAiImageAction).mock.calls[1][0]).toMatchObject({ review: false });
    vi.mocked(createVideoAction).mockResolvedValue({ ok: true, id: "job1" });
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_video", args: { idea: "a short ad" } })).toMatchObject({ ok: true, jobId: "job1" });
    expect(vi.mocked(createVideoAction).mock.calls[0][1]).toMatchObject({ topic: "a short ad", review: true, publish: false });
  });

  it("changes only the shop options that were given, adds a product with the attached photo, hides one by its exact name, and saves the number", async () => {
    vi.mocked(saveStoreSettingsAction).mockResolvedValue({ ok: true });
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_shop_options", args: { likeComments: true, expiryDays: 14 } });
    expect(saveStoreSettingsAction).toHaveBeenLastCalledWith("s2", { likeComments: true, expiryDays: 14 });
    vi.mocked(saveProductAction).mockResolvedValue({ ok: true, id: "p9" });
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "add_product", args: { name: "Ring", price: "25000", photos: ["a1"] }, attachments: [att] });
    expect(vi.mocked(saveProductAction).mock.calls[0]).toEqual([
      "s2",
      null,
      { name: "Ring", description: "", photos: [OWN], variants: [{ label: "", price: "25000", currency: "IQD", inStock: true }] },
    ]);
    vi.mocked(archiveProductAction).mockResolvedValue({ ok: true });
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "archive_product", args: { product: "silver ring" } })).toMatchObject({ ok: true });
    expect(archiveProductAction).toHaveBeenCalledWith("s2", "p2");
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "archive_product", args: { product: "ring" } })).toMatchObject({ ok: false });
    vi.mocked(saveWhatsAppAction).mockResolvedValue({ ok: true, digits: "9647701234567" });
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_whatsapp_number", args: { number: "07701234567" } })).toMatchObject({ ok: true });
    expect(saveWhatsAppAction).toHaveBeenCalledWith("07701234567");
  });

  it("schedules through the schedule action with the Baghdad time as given", async () => {
    vi.mocked(schedulePublishAction).mockResolvedValue({ ok: true, id: "x", runAt: "2026-10-20T16:30:00.000Z" });
    const r = await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "schedule_post", args: { caption: "Later", targets: ["FB"], when: "2026-10-20T19:30" } });
    expect(r.ok).toBe(true);
    expect(vi.mocked(schedulePublishAction).mock.calls[0][1]).toBe("2026-10-20T19:30");
  });

  it("is for people who can configure the shop, in a shop, signed in", async () => {
    ws.current = { id: "t1", role: "MEMBER", kind: "MERCHANT" };
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_auto_replies", args: { on: true } })).toMatchObject({ ok: false });
    ws.current = { id: "t1", role: "OWNER", kind: "NEWS" };
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_auto_replies", args: { on: true } })).toMatchObject({ ok: false });
    ws.current = null;
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_auto_replies", args: { on: true } })).toMatchObject({ ok: false });
    expect(saveStoreSettingsAction).not.toHaveBeenCalled();
  });
});

describe("runToolAction in a news desk", () => {
  beforeEach(() => {
    ws.current = { id: "t1", role: "OWNER", kind: "NEWS" };
  });

  it("designs a section's frame through the desk's own action, with the attached picture as the reference", async () => {
    vi.mocked(designSectionFrameAction).mockResolvedValue({ ok: true, framePath: "merchant/t1/frame-sports-1.png" });
    const r = await runToolAction({
      workspaceId: "t1",
      nonce: nonce(),
      tool: "design_section_frame",
      args: { section: "sports", note: "green", reference: "a1" },
      attachments: [att],
    });
    expect(r.ok).toBe(true);
    expect(designSectionFrameAction).toHaveBeenCalledWith({ section: "sports", referencePath: att.pathname, note: "green", frameText: "top" });
  });

  it("keeps the headline place a section's frame already has", async () => {
    db.newsFrame.findUnique.mockResolvedValue({ frameText: "middle" });
    vi.mocked(designSectionFrameAction).mockResolvedValue({ ok: true, framePath: "merchant/t1/f.png" });
    await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "design_section_frame", args: { section: "economy" } });
    expect(vi.mocked(designSectionFrameAction).mock.calls[0][0]).toMatchObject({ section: "economy", referencePath: null, frameText: "middle" });
  });

  it("takes only a picture the desk attached as a reference", async () => {
    // not attached at all: the card is not even a proposal
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "design_section_frame", args: { section: "sports", reference: "a1" } })).toMatchObject({ ok: false });
    // a video is not a reference
    const video = { ...att, kind: "video" as const, pathname: "merchant/t1/chat/1.mp4", url: OWN.replace(".jpg", ".mp4") };
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "design_section_frame", args: { section: "sports", reference: "a1" }, attachments: [video] })).toMatchObject({ ok: false });
    expect(designSectionFrameAction).not.toHaveBeenCalled();
  });

  it("knows only the sections of the news, and none of the shop's tools", async () => {
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "design_section_frame", args: { section: "../../x" } })).toMatchObject({ ok: false });
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "make_picture", args: { idea: "a ring" } })).toMatchObject({ ok: false });
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "post_now", args: { caption: "x", targets: ["FB"] } })).toMatchObject({ ok: false });
    expect(designSectionFrameAction).not.toHaveBeenCalled();
  });

  it("saves the desk's words, moves a headline only on a frame the section has, and removes a frame", async () => {
    vi.mocked(saveDesignPromptAction).mockResolvedValue({ ok: true, designPrompt: "deep blue" });
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_design_prompt", args: { text: "deep blue" } })).toMatchObject({ ok: true });
    expect(saveDesignPromptAction).toHaveBeenCalledWith("deep blue");

    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_frame_text", args: { section: "sports", position: "top" } })).toMatchObject({ ok: false });
    expect(saveSectionFrameTextAction).not.toHaveBeenCalled();
    db.newsFrame.findUnique.mockResolvedValue({ id: "f1" });
    vi.mocked(saveSectionFrameTextAction).mockResolvedValue({ ok: true });
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_frame_text", args: { section: "sports", position: "top" } })).toMatchObject({ ok: true });
    expect(saveSectionFrameTextAction).toHaveBeenCalledWith("sports", "top");

    vi.mocked(removeSectionFrameAction).mockResolvedValue({ ok: true });
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "remove_section_frame", args: { section: "breaking" } })).toMatchObject({ ok: true });
    expect(removeSectionFrameAction).toHaveBeenCalledWith("breaking");
  });

  it("is for people who can configure, and a shop cannot run the desk's tools", async () => {
    ws.current = { id: "t1", role: "MEMBER", kind: "NEWS" };
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "remove_section_frame", args: { section: "sports" } })).toMatchObject({ ok: false });
    ws.current = { id: "t1", role: "OWNER", kind: "MERCHANT" };
    expect(await runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "remove_section_frame", args: { section: "sports" } })).toMatchObject({ ok: false });
    expect(removeSectionFrameAction).not.toHaveBeenCalled();
  });
});

describe("runToolAction: the owner's daily plan on the classic screen", () => {
  const SORANI_IDEA = "یەکێک لە چیرۆکە نهێنییە مێژووییەکان، ژانری تاوان";
  const run = (args: Record<string, unknown>) => runToolAction({ workspaceId: "t1", nonce: nonce(), tool: "set_daily_video", args });

  it("saves the plan in the owner's words with the usual checks, and reports what runs every day", async () => {
    vi.mocked(saveVideoAutoAction).mockResolvedValue({ ok: true });
    const r = await run({ mode: "PUBLISH", idea: `  ${SORANI_IDEA}  `, kind: "story", publishTo: ["FB"] });
    expect(r).toMatchObject({ ok: true });
    const sent = vi.mocked(saveVideoAutoAction).mock.calls.at(-1)!;
    expect(sent[0]).toBe("s2");
    expect(sent[1]).toMatchObject({ mode: "PUBLISH", tier: "LITE", hour: 21, plan: { brief: SORANI_IDEA, kind: "story", review: false, photos: true, targets: ["FB"] } });
    const text = (r as { text: string }).text;
    expect(text).toContain(en.assistant.done.dailyPlan);
    expect(text).toContain(en.assistant.done.dailyCase);
    expect(text).toContain(en.assistant.done.dailyWaits);
  });

  it("builds on the plan already saved and refuses what cannot work, saving nothing", async () => {
    vi.mocked(saveVideoAutoAction).mockResolvedValue({ ok: true });
    db.store.findUnique.mockResolvedValue({ videoAutoHour: 9, videoAutoTier: "PRO", videoAutoMode: "DRAFT", videoAutoPlan: { brief: "old", kind: "story", format: "wide", review: true, photos: false, targets: ["FB"] } });
    await run({ hour: 7, idea: "new words" });
    expect(vi.mocked(saveVideoAutoAction).mock.calls.at(-1)![1]).toEqual({ tier: "PRO", hour: 7, plan: { brief: "new words", kind: "story", format: "wide", review: true, photos: false, targets: ["FB"] } });
    vi.mocked(saveVideoAutoAction).mockClear();
    // YouTube without the owner's two answers, an unconnected YouTube, an Instagram the shop does not have, an idea over 600 characters.
    db.store.findUnique.mockResolvedValue({ videoAutoHour: 9, videoAutoTier: "LITE", videoAutoMode: "OFF", videoAutoPlan: null });
    expect(await run({ idea: "x words", kind: "story", publishTo: ["YT"] })).toEqual({ ok: false, error: en.assistant.errors.youtubeNeeds });
    expect(await run({ idea: "x words", kind: "story", publishTo: ["YT"], youtubePrivacy: "public", youtubeMadeForKids: true })).toEqual({ ok: false, error: en.assistant.errors.notConnected("YouTube") });
    expect(await run({ idea: "x words", kind: "story", publishTo: ["IG"] })).toEqual({ ok: false, error: en.assistant.errors.notConnected("Instagram") });
    expect(await run({ idea: "w".repeat(601), kind: "story" })).toEqual({ ok: false, error: en.assistant.errors.planIdeaLong });
    expect(await run({ mode: "PUBLISH", idea: "x words", kind: "story" })).toEqual({ ok: false, error: en.assistant.errors.planTargets });
    expect(saveVideoAutoAction).not.toHaveBeenCalled();
  });

  it("shows the plan on the card in the owner's words, with the idea exactly as given", async () => {
    const { proposalLines } = await import("@/lib/assistant/tools");
    const f = en.assistant.fields;
    const lines = proposalLines(
      { tool: "set_daily_video", args: { mode: "PUBLISH", hour: 18, idea: SORANI_IDEA, kind: "story", format: "wide", review: false, photos: true, publishTo: ["FB", "YT"], youtubePrivacy: "private", youtubeMadeForKids: false } },
      f,
      { shop: "My shop" },
    );
    expect(lines).toEqual([
      { label: f.mode, value: f.modePublish },
      { label: f.hour, value: "18:00" },
      { label: f.idea, value: SORANI_IDEA },
      { label: f.kind, value: f.kindStory },
      { label: f.format, value: f.formatWide },
      { label: f.words, value: f.wordsExact },
      { label: f.storyPhotos, value: f.storyPhotosFrom },
      { label: f.postTo, value: "Facebook + YouTube" },
      { label: f.ytWho, value: f.ytWhoOptions.private },
      { label: f.ytKids, value: f.no },
      { label: f.shop, value: "My shop" },
    ]);
    // Nothing of the plan on a card that carries none, and no YouTube answers when YouTube is not in the plan.
    expect(proposalLines({ tool: "set_daily_video", args: { mode: "OFF" } }, f, {}).map((l) => l.label)).toEqual([f.mode]);
    expect(proposalLines({ tool: "set_daily_video", args: { publishTo: ["FB"], youtubePrivacy: "private" } }, f, {}).map((l) => l.label)).toEqual([f.postTo]);
    expect(proposalLines({ tool: "set_daily_video", args: { idea: "" } }, f, {})).toEqual([{ label: f.idea, value: f.ideaUsual }]);
  });
});
