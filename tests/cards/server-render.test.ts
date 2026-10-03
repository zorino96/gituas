import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("puppeteer-core", () => ({ default: { launch: vi.fn() } }));
vi.mock("@vercel/blob", () => ({ put: vi.fn(), del: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { newsDraft: { findFirst: vi.fn(), updateMany: vi.fn() } } }));
vi.mock("@/lib/cards/render-token", () => ({ signRenderToken: () => "token" }));

import { put } from "@vercel/blob";
import puppeteer from "puppeteer-core";

import { renderAndStoreCard, renderCardServer } from "@/lib/cards/server-render";
import { CARD_H, CARD_W } from "@/lib/cards/size";
import { db } from "@/lib/db";

const m = db as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const launch = vi.mocked(puppeteer.launch);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How many browsers are open now, and the most that ever were at once. */
let open = 0;
let most = 0;
let visited: string[] = [];

/** A browser that renders any card after a short while, and counts itself. */
function browser(): unknown {
  const page = {
    on: () => undefined,
    setDefaultTimeout: () => undefined,
    setViewport: async () => undefined,
    goto: async (url: string) => {
      visited.push(url);
      await pause(15);
      return { ok: () => true, status: () => 200 };
    },
    waitForSelector: async () => undefined,
    evaluate: async () => ({ found: true, faces: 1, imagesOk: true, overflow: false, box: [0, 0, CARD_W, CARD_H] }),
    $: async () => ({ screenshot: async () => new Uint8Array([1, 2, 3]) }),
  };
  return {
    newPage: async () => page,
    close: async () => {
      open--;
    },
    process: () => null,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  // Any file that exists will do: the browser itself is the stub above.
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("CHROME_PATH", process.execPath);
  open = 0;
  most = 0;
  visited = [];
  launch.mockImplementation(async () => {
    open++;
    most = Math.max(most, open);
    await pause(5);
    return browser() as never;
  });
});

describe("renderCardServer", () => {
  it("runs one browser at a time, in the order the renders were asked for", async () => {
    const cards = await Promise.all(["a", "b", "c"].map((id) => renderCardServer(id, "http://localhost:3001")));
    expect(cards.map((c) => c.length)).toEqual([3, 3, 3]);
    expect(launch).toHaveBeenCalledTimes(3);
    expect(most).toBe(1);
    expect(open).toBe(0);
    expect(visited.map((u) => new URL(u).pathname)).toEqual(["a", "b", "c"].map((id) => `/newsroom/card-render/${id}`));
  });

  it("a render that fails does not hold up the next one", async () => {
    launch.mockImplementationOnce(async () => {
      throw new Error("no browser");
    });
    const [first, second] = await Promise.allSettled([renderCardServer("a", "http://localhost:3001"), renderCardServer("b", "http://localhost:3001")]);
    expect(first).toMatchObject({ status: "rejected", reason: expect.objectContaining({ message: "no browser" }) });
    expect(second.status).toBe("fulfilled");
    expect(most).toBe(1);
  });
});

describe("renderAndStoreCard", () => {
  it("returns the headline and body the card was rendered from", async () => {
    const updatedAt = new Date();
    m.newsDraft.findFirst.mockResolvedValue({
      headline: "سەردێڕی نوێ",
      body: "دەقی نوێی هەواڵەکە.",
      updatedAt,
      item: { title: "A different source title", snippet: "A different source snippet." },
    });
    m.newsDraft.updateMany.mockResolvedValue({ count: 1 });
    vi.mocked(put).mockResolvedValue({ url: "https://blob.example/card.jpg", pathname: "merchant/t1/news-card-1.jpg" } as Awaited<ReturnType<typeof put>>);

    expect(await renderAndStoreCard("d1", "t1", "http://localhost:3001")).toEqual({
      url: "https://blob.example/card.jpg",
      pathname: "merchant/t1/news-card-1.jpg",
      headline: "سەردێڕی نوێ",
      body: "دەقی نوێی هەواڵەکە.",
    });
    // The card is attached only to the very text that was read: a draft edited meanwhile is refused.
    expect(m.newsDraft.updateMany.mock.calls[0][0].where).toEqual({ id: "d1", tenantId: "t1", updatedAt });
  });
});
