import type { nrTeamCkb } from "./team.ckb";

/** Whole numbers with thousands separators: 1,500. */
const n = (v: number): string => v.toLocaleString("en-US");

// The newsroom's team text in English: exactly the keys of team.ckb.ts.
export const nrTeamEn: typeof nrTeamCkb = {
  page: {
    title: "Team",
    seats: (used: number, total: number) => `${n(used)} / ${n(total)} ${total === 1 ? "seat" : "seats"}`,
  },

  roles: {
    label: { OWNER: "Owner", ADMIN: "Editor-in-chief", MEMBER: "Editor" },
    help: {
      OWNER: "Everything, including the team and the plan.",
      ADMIN: "Publishing, replying to comments and messages, and managing sources and brand.",
      MEMBER: "Prepares stories and cards, but can't publish them.",
    },
    notAllowed: "Only the owner and the editor-in-chief can do this.",
    ownerOnly: "Only the owner of the news desk can do this.",
  },

  invite: {
    email: "Email",
    role: "Role",
    submit: "Invite",
    created: "Invitation created.",
    emailed: "Email sent. You can also send the link yourself:",
    notEmailed: "The email was not sent. Send the link yourself, for example on WhatsApp:",
    linkLabel: "Invitation link",
    copy: "Copy",
    copied: "Copied.",
  },

  members: {
    title: "Members",
    roleOf: (name: string) => `${name}'s role`,
    roleChanged: "Role changed.",
    remove: "Remove",
    confirmRemove: (name: string) => `Remove ${name} from the team?`,
    removed: "Removed.",
  },

  invites: {
    title: "Pending invitations",
    expired: "Expired",
    resend: "Resend",
    resent: "Resent.",
    revoke: "Revoke",
    revoked: "Revoked.",
  },

  errors: {
    badEmail: "The email address is not valid.",
    badRole: "The role is not valid.",
    alreadyMember: "This person is already on the team.",
    tooMany: "You have sent too many invitations today. Try again tomorrow.",
    seatsFull: "All the seats on your plan are taken.",
    inviteNotFound: "Invitation not found.",
    memberNotFound: "Member not found.",
    ownerRoleFixed: "The owner's role can't be changed.",
    ownerStays: "The owner of the news desk can't be removed.",
  },
};
