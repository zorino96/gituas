// Who may do what in a workspace. Every server action checks this — hiding a
// button is never the check. Roles are the stored MembershipRole values.

import { nrTeamCkb } from "@/lib/i18n/nr/team.ckb";

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

// The Sorani wording; screens that follow the language cookie use t.nr.team.roles instead.
export const ROLE_LABEL: Record<Role, string> = nrTeamCkb.roles.label;

/** Roles an owner can hand out; ownership itself is not transferable yet. */
export const INVITABLE_ROLES = ["ADMIN", "MEMBER"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function isInvitableRole(role: string): role is InvitableRole {
  return (INVITABLE_ROLES as readonly string[]).includes(role);
}

