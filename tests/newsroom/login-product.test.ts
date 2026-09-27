import { describe, it, expect } from "vitest";
import { loginTitle, productFor } from "@/app/login/product";

describe("productFor", () => {
  it("maps newsroom paths to the newsroom", () => {
    expect(productFor("/newsroom")).toBe("newsroom");
    expect(productFor("/newsroom/news?tab=ready")).toBe("newsroom");
  });
  it("maps app paths to the shop", () => {
    expect(productFor("/app")).toBe("shop");
    expect(productFor("/app/publish")).toBe("shop");
  });
  it("maps anything else to the operator dashboard", () => {
    expect(productFor("/dashboard")).toBe("operator");
    expect(productFor("/")).toBe("operator");
  });
});

describe("loginTitle", () => {
  it("names the newsroom and the shop in Kurdish", () => {
    expect(loginTitle("newsroom")).toBe("چوونەژوورەوە — گیتواس نیوزڕووم");
    expect(loginTitle("shop")).toBe("چوونەژوورەوە — گیتواس");
  });
  it("leaves the operator title to the root layout", () => {
    expect(loginTitle("operator")).toBeUndefined();
  });
});
