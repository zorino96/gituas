import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { usage: { findMany: vi.fn(async () => []) } } }));
vi.mock("@/lib/shop/tenant-plans", () => ({ limitsOf: vi.fn(async () => ({ aiUsd: 7.5, aiOpusUsd: 5 })) }));

import { chooseTier } from "@/lib/ai/meter";
import { DEFAULT_MODEL, modelFor, opusAvailable } from "@/lib/ai/models";
import { maxPlanOpen } from "@/lib/billing/prices";

beforeEach(() => {
  vi.stubEnv("MAX_PLAN_ENABLED", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Opus switched on (the default)", () => {
  it("names the Opus model for the Opus tier, and the plan's Opus part is used", async () => {
    expect(opusAvailable()).toBe(true);
    expect(modelFor("opus")).toBe(DEFAULT_MODEL.opus);
    expect(modelFor("haiku")).toBe(DEFAULT_MODEL.haiku);
    expect(await chooseTier({ scope: "t1" }, "opus")).toBe("opus");
    expect(maxPlanOpen()).toBe(true);
  });
});

describe("AI_OPUS_ENABLED=0 (Haiku only)", () => {
  beforeEach(() => {
    vi.stubEnv("AI_OPUS_ENABLED", "0");
  });

  it("makes the Opus tier Haiku all the way down, so no call can reach an Opus model", () => {
    expect(opusAvailable()).toBe(false);
    expect(modelFor("opus")).toBe(DEFAULT_MODEL.haiku);
    vi.stubEnv("KURDGG_MODEL", "my/haiku");
    vi.stubEnv("KURDGG_MODEL_OPUS", "my/opus");
    expect(modelFor("opus")).toBe("my/haiku");
    expect(modelFor("haiku")).toBe("my/haiku");
  });

  it("never grants Opus from a plan's Opus part", async () => {
    expect(await chooseTier({ scope: "t1" }, "opus")).toBe("haiku");
  });

  it("does not sell the Max plan, whatever MAX_PLAN_ENABLED says", () => {
    expect(maxPlanOpen()).toBe(false);
  });

  it("only the exact value 0 switches Opus off", () => {
    vi.stubEnv("AI_OPUS_ENABLED", "");
    expect(opusAvailable()).toBe(true);
    vi.stubEnv("AI_OPUS_ENABLED", "false");
    expect(opusAvailable()).toBe(true);
  });
});
