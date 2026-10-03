import { num } from "../num";

// The newsroom's team text in Sorani. Wired into ckb.ts as `nr.team`; nr/team.ar.ts has the same keys.
// src/lib/newsroom/roles.ts takes its Sorani ROLE_LABEL from `roles` here.
export const nrTeamCkb = {
  page: {
    title: "تیم",
    seats: (used: number, total: number) => `${num(used)} / ${num(total)} شوێن`,
  },

  roles: {
    label: { OWNER: "خاوەن", ADMIN: "سەرنووسەر", MEMBER: "نووسەر" },
    help: {
      OWNER: "هەموو شتێک، لەوانە تیم و پلان.",
      ADMIN: "بڵاوکردنەوە، وەڵامی کۆمێنت و نامە، و ڕێکخستنی سەرچاوە و براند.",
      MEMBER: "هەواڵ و کارت ئامادە دەکات، بەڵام بڵاوی ناکاتەوە.",
    },
    notAllowed: "ئەم کارە تەنها بۆ خاوەن و سەرنووسەرە.",
    ownerOnly: "ئەم کارە تەنها بۆ خاوەنی مێزەکەیە.",
  },

  invite: {
    email: "ئیمەیڵ",
    role: "ڕۆڵ",
    submit: "بانگهێشت بکە",
    created: "بانگهێشتەکە دروست کرا.",
    emailed: "ئیمەیڵ نێردرا. دەتوانیت بەستەرەکەش خۆت بنێریت:",
    notEmailed: "ئیمەیڵ نەنێردرا. بەستەرەکە خۆت بنێرە، بۆ نموونە لە وەتسئەپ:",
    linkLabel: "بەستەری بانگهێشت",
    copy: "کۆپی بکە",
    copied: "کۆپی کرا.",
  },

  members: {
    title: "ئەندامەکان",
    roleOf: (name: string) => `ڕۆڵی ${name}`,
    roleChanged: "ڕۆڵەکە گۆڕدرا.",
    remove: "لابردن",
    confirmRemove: (name: string) => `${name} لە تیمەکە لاببرێت؟`,
    removed: "لابرا.",
  },

  invites: {
    title: "بانگهێشتە چاوەڕوانەکان",
    expired: "بەسەرچووە",
    resend: "دووبارە بنێرە",
    resent: "دووبارە نێردرا.",
    revoke: "هەڵوەشاندنەوە",
    revoked: "هەڵوەشێنرایەوە.",
  },

  /** What the team's server actions answer when they refuse. */
  errors: {
    badEmail: "ئیمەیڵەکە دروست نییە.",
    badRole: "ڕۆڵەکە دروست نییە.",
    alreadyMember: "ئەم کەسە پێشتر لە تیمەکەدایە.",
    tooMany: "ئەمڕۆ بانگهێشتی زۆرت ناردووە. سبەی هەوڵ بدەرەوە.",
    seatsFull: "هەموو شوێنەکانی پلانەکەت پڕن.",
    inviteNotFound: "بانگهێشتەکە نەدۆزرایەوە.",
    memberNotFound: "ئەندامەکە نەدۆزرایەوە.",
    ownerRoleFixed: "ڕۆڵی خاوەن ناگۆڕدرێت.",
    ownerStays: "خاوەنی مێزەکە لا نابرێت.",
  },
};
