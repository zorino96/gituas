import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/provider", () => ({ completeJson: vi.fn() }));

import { completeJson } from "@/lib/ai/provider";
import { askAssistant } from "@/lib/assistant/ask";
import { buildKnowledge } from "@/lib/assistant/knowledge";
import { systemPrompt } from "@/lib/chat/system";
import { TOOL_HELP } from "@/lib/assistant/tools";

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
    expect(sheet).toMatch(/always left as a draft/);
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
    expect(TOOL_HELP).toMatch(/make_video \{idea, product\?, language\?: "ckb"\|"ar"\|"en", kind\?: "ad"\|"story"\}/);
    expect(TOOL_HELP).toMatch(/set_daily_video \{mode\?: "OFF"\|"DRAFT"\|"PUBLISH", hour\?: 0-23, language\?: "ckb"\|"ar"\|"en"\}/);
    expect(TOOL_HELP).toMatch(/cut to 300 characters/);
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
