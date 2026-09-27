// Who may do what in a workspace. Every server action checks this — hiding a
// button is never the check. Roles are the stored MembershipRole values.

export type Role = "OWNER" | "ADMIN" | "MEMBER";
export type Permission = "read" | "draft" | "publish" | "engage" | "configure" | "team";

const ALLOWED: Record<Permission, readonly Role[]> = {
  read: ["OWNER", "ADMIN", "MEMBER"],
  draft: ["OWNER", "ADMIN", "MEMBER"],
  publish: ["OWNER", "ADMIN"],
  engage: ["OWNER", "ADMIN"],
  configure: ["OWNER", "ADMIN"],
  team: ["OWNER"],
};

export function can(role: Role, permission: Permission): boolean {
  return ALLOWED[permission].includes(role);
}

export const ROLE_LABEL: Record<Role, string> = { OWNER: "خاوەن", ADMIN: "سەرنووسەر", MEMBER: "نووسەر" };

/** Roles an owner can hand out; ownership itself is not transferable yet. */
export const INVITABLE_ROLES = ["ADMIN", "MEMBER"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function isInvitableRole(role: string): role is InvitableRole {
  return (INVITABLE_ROLES as readonly string[]).includes(role);
}

export const NOT_ALLOWED = "ئەم کارە تەنها بۆ خاوەن و سەرنووسەرە.";
export const OWNER_ONLY = "ئەم کارە تەنها بۆ خاوەنی مێزەکەیە.";
