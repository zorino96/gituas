import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/provider", () => ({ completeJson: vi.fn() }));

import { completeJson } from "@/lib/ai/provider";
import { askAssistant } from "@/lib/assistant/ask";
import { buildKnowledge } from "@/lib/assistant/knowledge";
import { systemPrompt } from "@/lib/chat/system";
import { DAILY_VIDEO_RULE, STORY_VIDEO_ARGS, STORY_VIDEO_RULES, TOOL_HELP, VIDEO_HONESTY_RULE } from "@/lib/assistant/tools";

// What the assistant is told about the AI video: the language is the owner's choice and the whole video follows it, ads and
// story/content videos are both supported, and the one thing still missing is a multi-minute documentary. The old sentences
// (a Kurdish voice only, no story videos) must not be in any of the places that say it.

const FEATURES = { max: true, video: true, pictures: true };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(completeJson).mockImplementation((async (_call: unknown, validate: (d: unknown) => unknown) => ({
    data: validate({ reply: "ok", followups: [] }),
    model: "m",
  })) as never);
});

describe("the knowledge sheet's video section", () => {
  const sheet = buildKnowledge(FEATURES);

  it("says the language is the owner's choice and the whole video follows it", () => {
    expect(sheet).toMatch(/video language is the owner's choice \(Sorani Kurdish, Arabic or English\)/);
    expect(sheet).toMatch(/script, the on-screen text, the voice, the layout and the post text/);
  });

  it("says a story or content video of about 60 to 70 seconds is made, and needs no product, price or phone number", () => {
    expect(sheet).toMatch(/story or content video \(about 60 to 70 seconds\)/);
    expect(sheet).toMatch(/needs no product, price or phone number/);
    // Without a plan of its own the daily story is a draft; the owner's plan can post one that was told from a read article.
    expect(sheet).toMatch(/With no plan of its own, the daily video makes a story only for a page that grows or earns from its content[^.]*\(every other page gets an ad\), and that story is left as a draft to read first/);
  });

  it("says a story, in any video language, is told from a real documented case read from Wikipedia WHEN IT CAN BE READ, chosen by Gituas only when the owner names none", () => {
    expect(sheet).toMatch(/A story, in any video language, is told from ONE real, well-documented case, read from its English Wikipedia article when that article can be read and retold in new words/);
    expect(sheet).toMatch(/when it cannot be read, the video card says the story was told from memory and the facts must be checked/);
    expect(sheet).toMatch(/when the owner names none \(only a genre or a wish such as a historical crime mystery\), one that Gituas chooses itself and shows, with a link to its article, on the video card/);
    expect(sheet).toMatch(/Gituas chooses a case only when the owner names none/);
    expect(sheet).toMatch(/the idea must contain the word fiction/);
    expect(sheet).toMatch(/A one-off real story is never posted by itself: the owner reads it first/);
    // The round-2 promises that were more than the pipeline keeps are gone.
    expect(sheet).not.toMatch(/never invented/);
    expect(sheet).not.toMatch(/Each part of a real story gets a real free-licence photograph/);
  });

  it("promises photographs only where free ones are found, credited in the caption and on the last scene, and says the credits must travel with the video", () => {
    expect(sheet).toMatch(/Free-licence photographs from Wikimedia Commons are used where free ones are found \(not every part of a story gets one; the owner can switch the photographs off\)/);
    expect(sheet).toMatch(/credited in the post caption and on the last scene of the video, so the credits must stay with the video/);
  });

  it("tells the shapes and the YouTube facts: vertical by default, wide 16:9 for a story, an ad always vertical, no upload to YouTube, download and Copy caption, no learning from an attached video", () => {
    expect(sheet).toMatch(/a video is vertical 9:16 \(for Reels, Stories and TikTok\) by default; a story can be made wide 16:9 for YouTube/);
    expect(sheet).toMatch(/an ad is always vertical/);
    // ONE YouTube truth: a single video is downloaded and added in Publish or YouTube Studio; the daily plan can post to YouTube by itself once the
    // owner has said who may watch and whether it is made for kids; YouTube keeps every upload Private until Google's review ends.
    expect(sheet).toMatch(/A single AI video is not uploaded to YouTube from the Video section or the chat: the owner downloads the finished video in the Video section \(the Download and Copy caption buttons give the file and its caption with the photo credits\) and adds it in Publish \(YouTube needs a video\) or in YouTube Studio/);
    expect(sheet).toMatch(/YouTube keeps every upload Private until Google finishes reviewing Gituas/);
    expect(sheet).toMatch(/The daily video plan below can post to YouTube by itself, once the owner has said who may watch and whether the videos are made for kids/);
    expect(sheet).not.toMatch(/Gituas does not upload to YouTube/);
    expect(sheet).toMatch(/It cannot learn from a video the owner attaches in the chat/);
    // The length: what the writer really does, no "cannot be chosen".
    expect(sheet).toMatch(/a story is about 60 to 70 seconds, and when the owner's idea asks for a short video Gituas aims for about 30 seconds but cannot promise it/);
    expect(sheet).not.toMatch(/The length cannot be chosen/);
    expect(sheet).not.toMatch(/short vertical video/);
  });

  it("says what the review switch does for a story, and which switch applies where: the Video section's starts off, the chat's decides unless the owner says otherwise", () => {
    expect(sheet).toMatch(/"Let Gituas review and improve my idea first" makes Gituas read the page and its earlier videos and rewrite the idea before the video is made; switched off, the owner's words go straight to the video maker exactly as written/);
    expect(sheet).toMatch(/In the Video section the switch for a story starts off; in the chat the switch under the message box decides, unless the owner says otherwise in words, and the result says whether the idea was reviewed or used exactly as written/);
  });

  it("describes the owner's daily plan: their words, a different real case each day, the platforms, and what waits as a draft", () => {
    expect(sheet).toMatch(/every day make me a video like this and post it/);
    expect(sheet).toMatch(/that saves a daily plan with the owner's own words \(the same idea every day; when it names no case, a different real case each day\)/);
    expect(sheet).toMatch(/Only a story told from a read article, about a case that is not very recent, is posted by itself; a story told from memory or about a very recent case waits as a draft/);
    expect(sheet).toMatch(/The Video section shows the plan in one line, and can switch the daily video off or remove the plan/);
  });

  it("still says there are no videos of several minutes, and keeps the per-day limit text", () => {
    expect(sheet).toMatch(/does not make long videos of several minutes or documentaries/);
    expect(sheet).toMatch(/At most \d+ video a day for each paid shop/);
  });

  it("no longer says the voice is Kurdish only or that stories are not made", () => {
    expect(sheet).not.toMatch(/Kurdish voice/);
    expect(sheet).not.toMatch(/story videos for YouTube monetization/);
  });
});

describe("the assistant's prompts", () => {
  it("tell the classic assistant to pass the language, and that a story needs no product", async () => {
    await askAssistant({ tenantId: "t1", lang: "en", uiNames: {}, state: { shops: [] }, features: FEATURES, turns: [{ role: "user", text: "make a story video" }] });
    const system = vi.mocked(completeJson).mock.calls[0][0].system;
    // The language is the owner's explicit word, never the language the message is written in.
    expect(system).toMatch(/pass language only when the owner explicitly names the video language/);
    expect(system).toMatch(/the language they write their message or story in says nothing about it/);
    expect(system).not.toMatch(/writes the story in another/);
    expect(system).toMatch(/story of about 60 to 70 seconds/);
    expect(system).not.toMatch(/video of about 35 seconds\)/);
  });

  it("tell the chat the same, and never to write the language into the idea", () => {
    const system = systemPrompt({
      lang: "en",
      uiNames: {},
      state: {},
      features: FEATURES,
      attachments: [],
      buttons: { confirm: "Confirm", cancel: "Cancel" },
      nowBaghdad: "2026-10-25 10:00",
    });
    expect(system).toMatch(/pass language to make_video or set_daily_video only when the owner explicitly names the video language/);
    expect(system).toMatch(/the language of their chat message says nothing about it/);
    expect(system).not.toMatch(/writes the story in another/);
    expect(system).toMatch(/never write the language into the idea/);
    expect(system).toMatch(/story of about 60 to 70 seconds/);
  });

  it("list the tool's new arguments for the classic assistant", () => {
    expect(TOOL_HELP).toMatch(/make_video \{idea, product\?, language\?: "ckb"\|"ar"\|"en", kind\?: "ad"\|"story", photos\?: boolean, review\?: boolean, format\?: "vertical"\|"wide"\}/);
    expect(TOOL_HELP).toContain(STORY_VIDEO_ARGS);
    expect(TOOL_HELP).toMatch(/set_daily_video \{mode\?: "OFF"\|"DRAFT"\|"PUBLISH", hour\?: 0-23, language\?: "ckb"\|"ar"\|"en", idea\?: "<the owner's words, verbatim>", kind\?: "ad"\|"story", format\?: "vertical"\|"wide", review\?: boolean, photos\?: boolean, publishTo\?: \["FB"\|"IG"\|"YT"\], youtubePrivacy\?: "public"\|"unlisted"\|"private", youtubeMadeForKids\?: boolean\}/);
    expect(TOOL_HELP).toMatch(/YouTube \(YT\) needs youtubePrivacy and youtubeMadeForKids, which are the owner's own declarations: when YT is wanted and the owner has not said them, ask ONE short question for both/);
    expect(TOOL_HELP).toMatch(/cut to 300 characters/);
  });

  // A story, in every video language, is told from ONE real documented case that Gituas finds (the owner's) or chooses (none named): the
  // prompts that can propose a video say the same words ONCE each, name no tool and no option in them, and none asks the owner to name a case.
  const STORY_RULE = [
    /A story video \(any video language\) is told from ONE real, well-documented case: the one the owner names/,
    /one that Gituas chooses itself and shows on the video card/,
    /NEVER ask the owner to name a case: propose the video right away/,
    /The case is retold from its Wikipedia article when that article can be read \(when it cannot, the video card says the story was told from memory and the owner must check the facts\)/,
    /with free-licence photographs from Wikimedia Commons where free ones are found, credited in the post and on the last scene \(not every part of a story gets a photograph: never promise that\)/,
    /Gituas chooses a case only when the owner names none/,
    /The idea is the owner's own words, exactly as they said them: never add a country, an era, a year, a genre, a name or any fact they did not say/,
    /then the idea must contain the word fiction; never add that word yourself/,
    /never tell the owner it cannot be done or that it is not a real case, and never offer fiction instead/,
    /A one-off real story is never posted by itself/,
    /Only the owner's daily plan can post a story by itself, and only when the story was told from a read article/,
  ];
  const countOf = (text: string, part: string) => text.split(part).length - 1;

  it("tell the classic assistant, the chat and the creator block the same story rule, ONCE each: a real case Gituas finds or chooses, never a question", async () => {
    await askAssistant({ tenantId: "t1", lang: "en", uiNames: {}, state: { shops: [] }, features: FEATURES, turns: [{ role: "user", text: "make a story video" }] });
    const classic = vi.mocked(completeJson).mock.calls[0][0].system;
    const chat = systemPrompt({ lang: "en", uiNames: {}, state: {}, features: FEATURES, attachments: [], buttons: { confirm: "Confirm", cancel: "Cancel" }, nowBaghdad: "2026-10-25 10:00" });
    const creator = systemPrompt({ lang: "en", uiNames: {}, state: { ownerType: "creator" }, features: FEATURES, attachments: [], buttons: { confirm: "Confirm", cancel: "Cancel" }, nowBaghdad: "2026-10-25 10:00" });
    for (const [name, text] of [["classic", classic], ["chat", chat], ["creator chat", creator]] as const) {
      for (const rule of STORY_RULE) expect(text, name).toMatch(rule);
      // The whole paragraph is there exactly once (it used to be pasted two or three times into one prompt).
      expect(countOf(text, STORY_VIDEO_RULES), name).toBe(1);
      // The round-1 rule that asked the owner for one specific subject is gone from every place.
      // (The only question a prompt may ask the owner is for YouTube's two answers, "ask ONE short question for both".)
      expect(text, name).not.toMatch(/ask ONE short question(?! for both)/);
      expect(text, name).not.toMatch(/offer three real documented cases/);
      expect(text, name).not.toMatch(/ONE specific subject the owner names/);
      expect(text, name).not.toMatch(/Non-Sorani videos/);
    }
    // The tool list (the classic assistant's) carries the arguments, not the story rule again.
    expect(countOf(classic, STORY_VIDEO_RULES)).toBe(1);
    expect(TOOL_HELP).not.toContain(STORY_VIDEO_RULES);
    expect(creator).not.toMatch(/made exactly from the idea they give/);
    // The rule uses no tool name and no option name: it can sit in the text the model reads about the owner.
    expect(STORY_VIDEO_RULES).not.toMatch(/make_video|review: true|photos: false|format:|kind story|"wide"/);
    // The old promises that were more than the pipeline keeps are gone.
    expect(STORY_VIDEO_RULES).not.toMatch(/Say that Gituas will choose/);
    expect(STORY_VIDEO_RULES).not.toMatch(/never invented/);
  });

  it("put the options (review, photos, shape) where the model reads the tool, with the YouTube wording rule: wide whenever the owner mentions YouTube, 16:9 or wide", () => {
    expect(STORY_VIDEO_ARGS).toMatch(/review: true only when the owner asks Gituas to improve or rewrite the idea first/);
    // Left out, the chat's own switch decides: switched off, the words go straight to the video maker.
    expect(STORY_VIDEO_ARGS).toMatch(/left out, the owner's own "review my idea" switch in the chat decides \(switched off: the words go straight to the video maker exactly as written\)/);
    expect(STORY_VIDEO_ARGS).toMatch(/photos: false removes the photographs/);
    expect(STORY_VIDEO_ARGS).toMatch(/format: "vertical" \(the default, 9:16, for Reels\) or "wide" \(16:9, for YouTube\)/);
    expect(STORY_VIDEO_ARGS).toMatch(/pass "wide" whenever the owner mentions YouTube, 16:9, wide, landscape, horizontal, a documentary/);
    expect(STORY_VIDEO_ARGS).toMatch(/only a story can be wide, an ad is always vertical/);
    // The length: the truth about the short aim, never "cannot be chosen".
    expect(STORY_VIDEO_ARGS).toMatch(/Length: a story is about 60 to 70 seconds; if the idea asks for a short video Gituas aims for about 30 seconds but cannot promise it/);
    expect(STORY_VIDEO_ARGS).not.toMatch(/cannot be chosen/);
  });

  it("give the chat and the classic assistant ONE honesty rule about what a video request did, once each", async () => {
    await askAssistant({ tenantId: "t1", lang: "en", uiNames: {}, state: { shops: [] }, features: FEATURES, turns: [{ role: "user", text: "make a story video" }] });
    const classic = vi.mocked(completeJson).mock.calls[0][0].system;
    const chat = systemPrompt({ lang: "en", uiNames: {}, state: {}, features: FEATURES, attachments: [], buttons: { confirm: "Confirm", cancel: "Cancel" }, nowBaghdad: "2026-10-25 10:00" });
    for (const [name, text] of [["classic", classic], ["chat", chat]] as const) {
      expect(countOf(text, VIDEO_HONESTY_RULE), name).toBe(1);
    }
    expect(VIDEO_HONESTY_RULE).toMatch(/SAY ONLY WHAT THE TOOL RESULT SAYS/);
    expect(VIDEO_HONESTY_RULE).toMatch(/Never claim a shape, a length, a language, a platform or the use of an attachment that the result did not confirm/);
    expect(VIDEO_HONESTY_RULE).toMatch(/learn from a video they attached, a video of several minutes, an exact length/);
    expect(VIDEO_HONESTY_RULE).toMatch(/you say in your FIRST lines, in plain words, before or instead of anything else/);
    // Length: the truth about the short aim, no "cannot be chosen".
    expect(VIDEO_HONESTY_RULE).toMatch(/an ad is about 35 seconds and a story about 60 to 70 seconds; when the idea of a story asks for a short video Gituas aims for about 30 seconds but cannot promise it/);
    expect(VIDEO_HONESTY_RULE).not.toMatch(/cannot be chosen/);
    // A story can be wide, an ad is always vertical: the prompt and the tool's refusal agree, and an ad is never swapped for a story in silence.
    expect(VIDEO_HONESTY_RULE).toMatch(/A story can be made wide \(16:9, for YouTube\); an ad is always vertical: when the owner wants an ad for YouTube, say so first and offer a vertical ad or a wide story, and never swap one for the other without telling them/);
    expect(VIDEO_HONESTY_RULE).not.toMatch(/make a story in the wide shape/);
    // ONE YouTube truth, the same as the knowledge sheet and the dictionaries.
    expect(VIDEO_HONESTY_RULE).toMatch(/one AI video made now is not uploaded to YouTube from here \(the owner downloads it and adds it in Publish or in YouTube Studio\)/);
    expect(VIDEO_HONESTY_RULE).toMatch(/the DAILY video can post to YouTube by itself once the owner has said who may watch and whether the videos are made for kids \(never choose those two for them: ask one short question for both\)/);
    expect(VIDEO_HONESTY_RULE).toMatch(/YouTube keeps every upload Private until Google finishes reviewing Gituas/);
    expect(VIDEO_HONESTY_RULE).not.toMatch(/Gituas never uploads to YouTube/);
    expect(VIDEO_HONESTY_RULE).toMatch(/Never add a word to the owner's idea \(a country, an era, a genre, a name\)/);
    expect(VIDEO_HONESTY_RULE).toMatch(/Never write a tool name or an option name to the owner/);
  });

  it("give the chat and the classic assistant the daily plan rule ONCE each, act-first with the one YouTube question, and never say YouTube is impossible from the chat", async () => {
    await askAssistant({ tenantId: "t1", lang: "en", uiNames: {}, state: { shops: [] }, features: FEATURES, turns: [{ role: "user", text: "make a video every day" }] });
    const classic = vi.mocked(completeJson).mock.calls[0][0].system;
    const chat = systemPrompt({ lang: "en", uiNames: {}, state: {}, features: FEATURES, attachments: [], buttons: { confirm: "Confirm", cancel: "Cancel" }, nowBaghdad: "2026-10-25 10:00" });
    for (const [name, text] of [["classic", classic], ["chat", chat]] as const) expect(countOf(text, DAILY_VIDEO_RULE), name).toBe(1);
    expect(DAILY_VIDEO_RULE).toMatch(/call set_daily_video ONCE with idea = their prompt copied word for word/);
    expect(DAILY_VIDEO_RULE).toMatch(/Decide everything else yourself and say it in one short line: no questions/);
    expect(DAILY_VIDEO_RULE).toMatch(/The one question you may ask is for YouTube/);
    expect(DAILY_VIDEO_RULE).toMatch(/a different real case every day/);
    expect(DAILY_VIDEO_RULE).toMatch(/waits as a draft/);
    // The chat's prompt used to say that YouTube is not possible from the chat at all: now it names the one way (the daily plan) and the Publish route.
    expect(chat).not.toMatch(/TikTok and YouTube are not possible from the chat/);
    expect(chat).toMatch(/The one exception is the daily video plan, which can post to YouTube by itself once the owner has said who may watch and whether it is made for kids/);
    expect(chat).not.toMatch(/for example a video of several minutes or an upload to YouTube/);
  });

  it("tell the model to pass the video language only when the owner names it, and never that OFF with a language only saves the language", () => {
    expect(TOOL_HELP).toMatch(/pass language only when the owner explicitly names the video language/);
    expect(TOOL_HELP).toMatch(/mode left out keeps the daily video as it is/);
    expect(TOOL_HELP).not.toMatch(/mode OFF with a language/);
    expect(TOOL_HELP).not.toMatch(/writes the idea in another language/);
  });

  it("say the daily video makes a story only for a page that earns from its content and has described its channel", () => {
    expect(buildKnowledge(FEATURES)).toMatch(/only for a page that grows or earns from its content and has described its channel \(every other page gets an ad\)/);
    expect(buildKnowledge(FEATURES)).toMatch(/the language they write their message in does not decide it/);
  });
});
