import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pawanOneAtATime } from "@/lib/voice/tts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("pawanOneAtATime", () => {
  it("runs the calls of an instance one after the other", async () => {
    const order: string[] = [];
    let running = 0;
    let most = 0;
    const call = (name: string) => async () => {
      running++;
      most = Math.max(most, running);
      order.push(`start ${name}`);
      await new Promise((r) => setTimeout(r, 100));
      order.push(`end ${name}`);
      running--;
      return name;
    };
    const all = Promise.all([pawanOneAtATime(call("a")), pawanOneAtATime(call("b")), pawanOneAtATime(call("c"))]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await all).toEqual(["a", "b", "c"]);
    expect(most).toBe(1);
    expect(order).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
  });

  it("waits out a 'too many concurrent requests' answer and tries again", async () => {
    let n = 0;
    const call = async () => {
      n++;
      if (n < 3) throw new Error('pawan 429: {"message":"Too many concurrent requests"}');
      return "ok";
    };
    const run = pawanOneAtATime(call);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await run).toBe("ok");
    expect(n).toBe(3);
  });

  it("does not wait on a quota answer, which waiting cannot fix, and a failed call does not block the next", async () => {
    let n = 0;
    const bad = pawanOneAtATime(async () => {
      n++;
      throw new Error("pawan 429: {\"error\":\"quota\"}");
    });
    const next = pawanOneAtATime(async () => "fine");
    const rejected = expect(bad).rejects.toThrow("pawan 429");
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(await next).toBe("fine");
    expect(n).toBe(1);
  });

  it("gives up after a few waits when Pawan stays busy", async () => {
    let n = 0;
    const run = pawanOneAtATime(async () => {
      n++;
      throw new Error("pawan 429: Too many concurrent requests");
    });
    const settled = run.catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await settled).toContain("pawan 429");
    expect(n).toBe(5);
  });
});
