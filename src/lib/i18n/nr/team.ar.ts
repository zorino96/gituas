import { num } from "../num";
import type { nrTeamCkb } from "./team.ckb";

// The newsroom's team text in Arabic: exactly the keys of team.ckb.ts.
export const nrTeamAr: typeof nrTeamCkb = {
  page: {
    title: "الفريق",
    seats: (used: number, total: number) => `المقاعد: ${num(used)} / ${num(total)}`,
  },

  roles: {
    label: { OWNER: "المالك", ADMIN: "رئيس التحرير", MEMBER: "المحرر" },
    help: {
      OWNER: "كل شيء، بما في ذلك الفريق والباقة.",
      ADMIN: "النشر، والرد على التعليقات والرسائل، وإدارة المصادر والعلامة التجارية.",
      MEMBER: "يجهّز الأخبار والبطاقات، لكنه لا ينشرها.",
    },
    notAllowed: "هذا الإجراء للمالك ورئيس التحرير فقط.",
    ownerOnly: "هذا الإجراء لمالك المكتب فقط.",
  },

  invite: {
    email: "البريد الإلكتروني",
    role: "الدور",
    submit: "دعوة",
    created: "تم إنشاء الدعوة.",
    emailed: "تم إرسال البريد. يمكنك أيضاً إرسال الرابط بنفسك:",
    notEmailed: "لم يُرسَل البريد. أرسل الرابط بنفسك، مثلاً عبر واتساب:",
    linkLabel: "رابط الدعوة",
    copy: "نسخ",
    copied: "تم النسخ.",
  },

  members: {
    title: "الأعضاء",
    roleOf: (name: string) => `دور ${name}`,
    roleChanged: "تم تغيير الدور.",
    remove: "إزالة",
    confirmRemove: (name: string) => `إزالة ${name} من الفريق؟`,
    removed: "تمت الإزالة.",
  },

  invites: {
    title: "الدعوات المعلّقة",
    expired: "منتهية",
    resend: "إعادة الإرسال",
    resent: "تمت إعادة الإرسال.",
    revoke: "إلغاء",
    revoked: "تم الإلغاء.",
  },

  errors: {
    badEmail: "البريد الإلكتروني غير صحيح.",
    badRole: "الدور غير صحيح.",
    alreadyMember: "هذا الشخص موجود في الفريق مسبقاً.",
    tooMany: "أرسلت دعوات كثيرة اليوم. حاول مجدداً غداً.",
    seatsFull: "جميع مقاعد باقتك مشغولة.",
    inviteNotFound: "لم يتم العثور على الدعوة.",
    memberNotFound: "لم يتم العثور على العضو.",
    ownerRoleFixed: "لا يمكن تغيير دور المالك.",
    ownerStays: "لا يمكن إزالة مالك المكتب.",
  },
};
