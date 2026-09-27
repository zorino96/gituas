import { describe, it, expect } from "vitest";
import { pickWorkspace } from "@/lib/workspace/pick";

const d = (s: string) => new Date(`2026-09-${s}T00:00:00Z`);
const own = { id: "own", kindChosen: false, joinedAt: d("01") };
const desk = { id: "desk", kindChosen: true, joinedAt: d("10") };
const shop = { id: "shop", kindChosen: true, joinedAt: d("05") };

describe("pickWorkspace", () => {
  it("uses the cookie when it names one of the person's workspaces", () => {
    expect(pickWorkspace([own, desk, shop], "desk")?.id).toBe("desk");
  });
  it("ignores a cookie for a workspace the person is not in", () => {
    expect(pickWorkspace([own, desk], "someone-elses")?.id).toBe("desk");
  });
  it("prefers the earliest claimed workspace over an unclaimed one", () => {
    expect(pickWorkspace([own, desk, shop])?.id).toBe("shop");
  });
  it("falls back to the earliest workspace when none is claimed", () => {
    expect(pickWorkspace([{ ...own, joinedAt: d("09") }, { id: "b", kindChosen: false, joinedAt: d("02") }])?.id).toBe("b");
  });
  it("returns undefined for no workspaces", () => {
    expect(pickWorkspace([])).toBeUndefined();
  });
});
