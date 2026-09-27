import { describe, it, expect } from "vitest";
import { safeNext } from "@/lib/safe-next";

describe("safeNext", () => {
  it("keeps a same-site path with a query and hash as it is", () => {
    expect(safeNext("/newsroom/news?tab=ready", "/app")).toBe("/newsroom/news?tab=ready");
  });

  it("falls back for undefined, empty, and every open-redirect trick", () => {
    expect(safeNext(undefined, "/app")).toBe("/app");
    expect(safeNext("", "/app")).toBe("/app");
    expect(safeNext("https://evil.com", "/app")).toBe("/app");
    expect(safeNext("//evil.com", "/app")).toBe("/app");
    expect(safeNext("/\\evil.com", "/app")).toBe("/app");
    expect(safeNext("/\t/evil.com", "/app")).toBe("/app");
    expect(safeNext("/a/../b", "/app")).toBe("/app");
  });

  it("falls back when percent-encoded dot-segments collapse the path into another host", () => {
    expect(safeNext("/app/%2e%2e//evil.com/x", "/app")).toBe("/app");
    expect(safeNext("/app/%2E%2E//evil.com", "/app")).toBe("/app");
    expect(safeNext("/a/.%2e//evil.com", "/app")).toBe("/app");
  });

  it("uses an array's first element", () => {
    expect(safeNext(["/newsroom", "/app"], "/dashboard")).toBe("/newsroom");
  });
});
