import { describe, it, expect } from "vitest";
import { can, INVITABLE_ROLES, ROLE_LABEL, type Permission, type Role } from "@/lib/newsroom/roles";

const ROLES: Role[] = ["OWNER", "ADMIN", "MEMBER"];

describe("can", () => {
  it("lets everyone read and draft", () => {
    for (const r of ROLES) {
      expect(can(r, "read")).toBe(true);
      expect(can(r, "draft")).toBe(true);
    }
  });
  it("keeps publishing, engaging and configuring to owners and editors", () => {
    for (const p of ["publish", "engage", "configure"] as Permission[]) {
      expect(can("OWNER", p)).toBe(true);
      expect(can("ADMIN", p)).toBe(true);
      expect(can("MEMBER", p)).toBe(false);
    }
  });
  it("keeps the team to the owner", () => {
    expect(can("OWNER", "team")).toBe(true);
    expect(can("ADMIN", "team")).toBe(false);
    expect(can("MEMBER", "team")).toBe(false);
  });
});

describe("labels and invitable roles", () => {
  it("names every role in Kurdish", () => {
    expect(ROLE_LABEL).toEqual({ OWNER: "خاوەن", ADMIN: "سەرنووسەر", MEMBER: "نووسەر" });
  });
  it("never offers ownership in an invite", () => {
    expect(INVITABLE_ROLES).toEqual(["ADMIN", "MEMBER"]);
  });
});
