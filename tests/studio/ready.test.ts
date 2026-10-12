import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/studio/higgsfield", () => ({ higgsfieldConfigured: () => true }));
vi.mock("@/lib/studio/presets", () => ({ imageModel: () => "marketing-studio/image/sunburst" }));

import { studioEnabled, studioReady, studioReadyFor } from "@/lib/studio/ready";

describe("the Studio's master switch", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is off unless STUDIO_ENABLED is 1, whatever else is set", () => {
    vi.stubEnv("STUDIO_OPEN", "1");
    vi.stubEnv("STUDIO_TENANTS", "t1");
    expect(studioEnabled()).toBe(false);
    expect(studioReady()).toBe(false);
    expect(studioReadyFor("t1")).toBe(false);
  });

  it("is not switched on by anything but the exact value 1", () => {
    for (const v of ["", "0", "true", "yes"]) {
      vi.stubEnv("STUDIO_ENABLED", v);
      expect(studioEnabled()).toBe(false);
    }
  });

  it("brings the old behaviour back when switched on: listed workspaces, or everyone with STUDIO_OPEN", () => {
    vi.stubEnv("STUDIO_ENABLED", "1");
    vi.stubEnv("STUDIO_TENANTS", "t1, t2");
    expect(studioReady()).toBe(true);
    expect(studioReadyFor("t1")).toBe(true);
    expect(studioReadyFor("t2")).toBe(true);
    expect(studioReadyFor("t3")).toBe(false);
    vi.stubEnv("STUDIO_OPEN", "1");
    expect(studioReadyFor("t3")).toBe(true);
  });
});
