// The few sentences the SERVER says in the person's language (the screen has its own dictionary for everything else).

import type { Lang } from "@/lib/i18n/lang";
import type { ChatErrorCode } from "./types";

type Table = Record<Lang, string>;

const ERRORS: Record<ChatErrorCode, Table> = {
  signin: { ckb: "تکایە دووبارە بچۆرە ژوورەوە.", ar: "سجّل الدخول من جديد.", en: "Please sign in again." },
  forbidden: { ckb: "ئەم چاتە تەنها بۆ خاوەن و بەڕێوەبەرە.", ar: "هذه المحادثة للمالك والمدير فقط.", en: "Chat is for owners and admins." },
  workspace: { ckb: "ئەم پەڕەیە بۆ شوێنی کاری تر کراوەتەوە. نوێی بکەرەوە.", ar: "الصفحة مفتوحة لمساحة عمل أخرى. أعد التحميل.", en: "This page is open for another workspace. Reload it." },
  badrequest: { ckb: "داواکارییەکە دروست نەبوو.", ar: "الطلب غير صالح.", en: "That request was not valid." },
  limit_day: { ckb: "ژمارەی چاتی ئەمڕۆت تەواو بوو. سبەینێ دووبارە هەوڵبدەرەوە.", ar: "انتهت محادثات اليوم. حاول غداً.", en: "Today's chat turns are used up. Try again tomorrow." },
  limit_month: { ckb: "ژمارەی چاتی ئەم مانگەت تەواو بوو.", ar: "انتهت محادثات هذا الشهر.", en: "This month's chat turns are used up." },
  allowance: { ckb: "بڕی AI ی ئەم مانگە تەواو بووە.", ar: "نفدت حصة الذكاء الاصطناعي لهذا الشهر.", en: "This month's AI allowance is used up." },
  busy: { ckb: "وەڵامی پێشوو هێشتا تەواو نەبووە. کەمێک چاوەڕێ بکە.", ar: "الرد السابق لم ينتهِ بعد. انتظر قليلاً.", en: "The last answer is still running. Wait a moment." },
  unavailable: { ckb: "AI ئێستا وەڵام نادات. دووبارە هەوڵبدەرەوە.", ar: "الذكاء الاصطناعي لا يرد الآن. حاول مجدداً.", en: "The AI is not answering now. Try again." },
  not_found: { ckb: "نەدۆزرایەوە.", ar: "غير موجود.", en: "Not found." },
  expired: { ckb: "ئەم کارتە کۆن بووە. لە چات داوای نوێ بکە.", ar: "انتهت صلاحية هذه البطاقة. اطلبها من جديد.", en: "This card has expired. Ask again in the chat." },
  frozen: {
    ckb: "ماوەی تاقیکردنەوە یان پلانەکە تەواو بووە، بۆیە چات ناتوانێت کار بکات. دوگمە خێراکان هێشتا کاردەکەن.",
    ar: "انتهت فترة التجربة أو الخطة، لذا لا تعمل المحادثة الآن. الأزرار السريعة ما زالت تعمل.",
    en: "The trial or the plan has ended, so the chat cannot work now. The quick buttons still work.",
  },
  internal: { ckb: "هەڵەیەک ڕوویدا. دووبارە هەوڵبدەرەوە.", ar: "حدث خطأ. حاول مرة أخرى.", en: "Something went wrong. Try again." },
};

export const errorText = (code: ChatErrorCode, lang: Lang): string => ERRORS[code][lang];

const SAY = {
  /** The turn ran out of steps or time before the model finished. */
  turnCut: {
    ckb: "لێرەدا وەستام تا زۆر نەخایەنێت. بڵێ «بەردەوامبە» تا تەواوی بکەم.",
    ar: "توقفت هنا حتى لا يطول الأمر. اكتب «أكمل» لأكمل.",
    en: "I stopped here so it would not run long. Say “continue” and I will finish.",
  },
  /** The AI stopped answering in the middle of a turn; what was done is above. */
  aiStopped: {
    ckb: "AI وەڵامی نەدایەوە. ئەوەی تا ئێستا کراوە لە سەرەوە دیارە.",
    ar: "توقف الذكاء الاصطناعي عن الرد. ما تم حتى الآن ظاهر أعلاه.",
    en: "The AI stopped answering. What was done so far is shown above.",
  },
  /** The model finished with no words. */
  noAnswer: {
    ckb: "نەمتوانی وەڵامێک بنووسم. دووبارە هەوڵبدەرەوە.",
    ar: "لم أستطع كتابة رد. حاول مرة أخرى.",
    en: "I could not write an answer. Please try again.",
  },
  /** A change took longer than the request could wait: it may still have been made, so it must not be repeated blindly. */
  unknownOutcome: {
    ckb: "ئەمە زۆر خایاند و لەوانەیە ئەنجام درابێت. پێش ئەوەی دووبارە هەوڵبدەیتەوە، فەیسبووک و ئینستاگرام یان وێنەکانت بپشکنە.",
    ar: "استغرق الأمر وقتاً طويلاً وقد يكون قد تم. تحقق من فيسبوك وإنستغرام أو من صورك قبل أن تعيد المحاولة.",
    en: "It took too long and may still have gone through. Check Facebook, Instagram or your pictures before trying again.",
  },
  /** The day's number of changes (or posts) made from the chat is used up. */
  actionsLimit: {
    ckb: "سنووری گۆڕانکارییەکانی ئەمڕۆ لە چاتەوە تەواو بوو. سبەینێ دووبارە هەوڵبدەرەوە.",
    ar: "بلغت حد التغييرات اليوم من المحادثة. حاول غداً.",
    en: "Today's limit of changes made from the chat is reached. Try again tomorrow.",
  },
  /** Confirm was pressed after the person had changed the account the chat works as: the card is not run as another account. */
  accountChanged: {
    ckb: "دوای دروستکردنی ئەم کارتە هەژمارەکەت گۆڕی. لە چات دووبارە داوای بکە.",
    ar: "غيّرت الحساب بعد إنشاء هذه البطاقة. اطلبها من جديد في المحادثة.",
    en: "You changed the account after this card was made. Ask again.",
  },
  /** The advice named a number that is not in the owner's own data: it is cut and this is said instead. */
  adviceNumbers: {
    ckb: "نامەوێت ژمارەیەک بڵێم کە لە داتای خۆتدا نییە. بۆ ژمارەی ورد بەشی «داواکاری» یان «ئامار» بکەرەوە.",
    ar: "لا أريد ذكر رقم ليس في بياناتك. للأرقام الدقيقة افتح قسم «الطلبات» أو «الإحصائيات».",
    en: "I would rather not quote a number that is not in your own data. For exact figures open Orders or Insights.",
  },
  /** What is shown while the model is working. */
  thinking: { ckb: "بیر دەکەمەوە…", ar: "أفكر…", en: "Thinking…" },
  working: { ckb: "کار دەکەم…", ar: "أعمل على ذلك…", en: "Working on it…" },
  /** A card is waiting and the model said nothing more. */
  cardsWaiting: {
    ckb: "ئامادەم. کارتەکە بپشکنە و پشتڕاستی بکەرەوە.",
    ar: "جاهز. راجع البطاقة وأكّدها.",
    en: "Ready. Check the card and confirm it.",
  },
} satisfies Record<string, Table>;

export const say = (key: keyof typeof SAY, lang: Lang): string => SAY[key][lang];

/** The news desk's shortcut buttons: the button's name and the sentence above its answer (the shop's are in the chat dictionary). */
export const NEWS_QUICK: Record<string, { label: Table; lead: Table }> = {
  today: {
    label: { ckb: "ئەمڕۆ", ar: "اليوم", en: "Today" },
    lead: { ckb: "ئەمە دۆخی ئەمڕۆی مێزی هەواڵەکەتە.", ar: "هذا وضع مكتب الأخبار اليوم.", en: "Here is your desk today." },
  },
  stories: {
    label: { ckb: "هەواڵە نوێکان", ar: "الأخبار الجديدة", en: "New stories" },
    lead: { ckb: "ئەمانە نوێترین هەواڵەکانن.", ar: "هذه أحدث الأخبار.", en: "These are the newest stories." },
  },
  ready: {
    label: { ckb: "ئامادەکراوەکان", ar: "الجاهزة للنشر", en: "Ready to publish" },
    lead: { ckb: "ئەمانە ئامادەن بۆ بڵاوکردنەوە.", ar: "هذه جاهزة للنشر.", en: "These are ready to publish." },
  },
  comments: {
    label: { ckb: "کۆمێنتەکان", ar: "التعليقات", en: "Comments" },
    lead: { ckb: "ئەمانە کۆمێنتی بێوەڵامن.", ar: "هذه التعليقات التي لم يُرد عليها.", en: "These comments have no reply yet." },
  },
  messages: {
    label: { ckb: "نامەکان", ar: "الرسائل", en: "Messages" },
    lead: { ckb: "ئەمانە نامە بێوەڵامەکانن.", ar: "هذه الرسائل التي لم يُرد عليها.", en: "These messages have no reply yet." },
  },
  scheduled: {
    label: { ckb: "خشتەکراوەکان", ar: "المجدولة", en: "Scheduled" },
    lead: { ckb: "ئەمانە خشتەکراون بۆ بڵاوکردنەوە.", ar: "هذه منشورات مجدولة.", en: "These posts are scheduled." },
  },
  check: {
    label: { ckb: "هەموو شتێک بپشکنە", ar: "افحص كل شيء", en: "Check everything" },
    lead: { ckb: "ئەمە ئەوەیە کە لە مێزی هەواڵەکەت پشکنیم:", ar: "هذا ما فحصته في مكتب الأخبار:", en: "Here is what I checked on your desk:" },
  },
};

/** What the model is told to write in when the person's own language is unclear. */
export const LANG_NAME: Record<Lang, string> = { ckb: "Central Kurdish (Sorani, Arabic script)", ar: "Arabic", en: "English" };
