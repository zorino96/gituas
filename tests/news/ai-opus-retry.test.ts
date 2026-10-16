import { beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("@/lib/ai/kurdgg", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/kurdgg")>()), kurdggConfigured: vi.fn(), kurdggJson: vi.fn() }));
vi.mock("@/lib/ai/meter", () => ({ chooseTier: vi.fn(), recordSpend: vi.fn() }));

import { completeJson } from "@/lib/ai/provider";
import * as kg from "@/lib/ai/kurdgg";
import * as meter from "@/lib/ai/meter";

const call = { system: "s", user: "u", strength: "fast" as const };
const reply = (data: unknown, model = "kurdgg/x") => ({ data, model, usage: { in: 100, out: 10 } });
const needsGood = (d: unknown) => ((d as { good?: boolean })?.good ? (d as { good: boolean }) : null);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(kg.kurdggConfigured).mockReturnValue(true);
});

describe("Opus for a system call without an allowance", () => {
  it("retry: Haiku first, Opus only when the reply does not fit", async () => {
    vi.mocked(kg.kurdggJson).mockResolvedValueOnce(reply({ good: false })).mockResolvedValueOnce(reply({ good: true }, "kurdgg/opus"));
    const r = await completeJson({ ...call, opus: "retry" }, needsGood);
    expect(r.data).toEqual({ good: true });
    expect(vi.mocked(kg.kurdggJson).mock.calls.map((c) => c[2])).toEqual(["haiku", "opus"]);
    expect(meter.chooseTier).not.toHaveBeenCalled();
    expect(meter.recordSpend).not.toHaveBeenCalled();
  });

  it("retry: a good first reply never costs Opus", async () => {
    vi.mocked(kg.kurdggJson).mockResolvedValue(reply({ good: true }));
    await completeJson({ ...call, opus: "retry" }, needsGood);
    expect(vi.mocked(kg.kurdggJson).mock.calls.map((c) => c[2])).toEqual(["haiku"]);
  });

  it("always: Opus first, and Haiku when Opus fails", async () => {
    vi.mocked(kg.kurdggJson).mockRejectedValueOnce(new Error("HTTP 503 down")).mockResolvedValueOnce(reply({ good: true }));
    const r = await completeJson({ ...call, opus: "always" }, needsGood);
    expect(r.data).toEqual({ good: true });
    expect(vi.mocked(kg.kurdggJson).mock.calls.map((c) => c[2])).toEqual(["opus", "haiku"]);
  });

  it("is ignored for a call that has an allowance: the allowance chooses the model", async () => {
    vi.mocked(meter.chooseTier).mockResolvedValue("haiku");
    vi.mocked(kg.kurdggJson).mockResolvedValue(reply({ good: true }));
    await completeJson({ ...call, opus: "always", meter: { scope: "t1" } }, needsGood);
    expect(vi.mocked(kg.kurdggJson).mock.calls[0][2]).toBe("haiku");
  });

  it("gives up cleanly when Opus does not fit either", async () => {
    vi.mocked(kg.kurdggJson).mockResolvedValue(reply({ good: false }));
    await expect(completeJson({ ...call, opus: "retry" }, needsGood)).rejects.toThrow(/shape/);
    expect(vi.mocked(kg.kurdggJson)).toHaveBeenCalledTimes(2);
  });
});
