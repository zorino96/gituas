// Every sentence the write tools say to the person, in Sorani, Arabic and English. The card labels of the eleven older tools come
// from the app's own dictionary (t.assistant.fields); only what is new lives here. Arabic must not use Kurdish-only letters.

import { say, words } from "./writes-common";

/** "Looking at the orders…": what the person reads while a tool works. */
export const LABEL = {
  make_picture: words("وێنەکە ئامادە دەکەم…", "أجهّز الصورة…", "Getting the picture ready…"),
  make_video: words("ڤیدیۆکە ئامادە دەکەم…", "أجهّز الفيديو…", "Getting the video ready…"),
  post_now: words("پۆستەکە ئامادە دەکەم…", "أجهّز المنشور…", "Getting the post ready…"),
  schedule_post: words("پۆستی خشتەکراو ئامادە دەکەم…", "أجهّز المنشور المجدول…", "Getting the scheduled post ready…"),
  setting: words("ڕێکخستنەکە ئامادە دەکەم…", "أجهّز الإعداد…", "Getting the setting ready…"),
  product: words("گۆڕانکارییەکەی بەرهەم ئامادە دەکەم…", "أجهّز تعديل المنتج…", "Getting the product change ready…"),
  order: words("سەیری داواکارییەکە دەکەم…", "أنظر في الطلب…", "Looking at the order…"),
  comment: words("کۆمێنتەکە دەدۆزمەوە…", "أبحث عن التعليق…", "Finding the comment…"),
  conversation: words("گفتوگۆکە دەپشکنم…", "أتحقق من المحادثة…", "Checking the conversation…"),
  scheduled: words("سەیری پۆستە خشتەکراوەکە دەکەم…", "أنظر في المنشور المجدول…", "Looking at the scheduled post…"),
};

export const NEW = {
  title: {
    setOrderStatus: words("گۆڕینی دۆخی داواکاری", "تغيير حالة الطلب", "Change an order's status"),
    hideComment: words("شاردنەوەی کۆمێنت", "إخفاء تعليق", "Hide a comment"),
    showComment: words("پیشاندانەوەی کۆمێنتی شاراوە", "إظهار تعليق مخفي", "Show a hidden comment"),
    replyToComment: words("وەڵامدانەوەی کۆمێنت", "الرد على تعليق", "Reply to a comment"),
    sendMessage: words("ناردنی نامە", "إرسال رسالة", "Send a message"),
    cancelScheduled: words("هەڵوەشاندنەوەی پۆستی خشتەکراو", "إلغاء منشور مجدول", "Cancel a scheduled post"),
    updateProduct: words("گۆڕینی بەرهەم", "تعديل منتج", "Change a product"),
  },
  field: {
    order: words("داواکاری", "الطلب", "Order"),
    status: words("دۆخ", "الحالة", "Status"),
    platform: words("پلاتفۆرم", "المنصة", "Platform"),
    comment: words("کۆمێنت", "التعليق", "Comment"),
    reply: words("وەڵام", "الرد", "Reply"),
    note: words("تێبینی", "ملاحظة", "Note"),
    to: words("بۆ", "إلى", "To"),
    lastMessage: words("دوایین نامەی ئەوان", "آخر رسالة منهم", "Their last message"),
    message: words("نامە", "الرسالة", "Message"),
  },
  /** "Sent (was New)": the new value first, so the line reads the same way in both text directions. */
  was: say(
    (now: string, was: string) => `${now} (پێشتر: ${was})`,
    (now: string, was: string) => `${now} (كان: ${was})`,
    (now: string, was: string) => `${now} (was ${was})`,
  ),
  /** The card was fine when it was made, but the shop changed before Confirm (the comment is gone, the 24 hours ended). */
  stale: words(
    "ئیتر ناکرێت: دوای دروستکردنی کارتەکە شتەکە گۆڕا. بپشکنە و دووبارە داوای بکە.",
    "لم يعد ذلك ممكناً: تغيّر الوضع بعد إنشاء البطاقة. تحقق واطلب من جديد.",
    "This can no longer be done: things changed after the card was made. Check and ask again.",
  ),
  /**
   * On the card of a WhatsApp message: the screen's send action pauses the bot in that chat once the owner has answered by hand, and
   * that pause is for good (it has no end date and nothing in the app removes it), so the card says it cannot be switched back on.
   */
  waBotPaused: words(
    "دوای ناردن، بۆتەکە بۆ هەمیشە لەم گفتوگۆیەدا بێدەنگ دەبێت و ناتوانرێت لە گفتوگۆکە یان لە ئەپەکەوە دووبارە چالاک بکرێتەوە.",
    "بعد الإرسال سيتوقف البوت عن الرد في هذه المحادثة نهائياً، ولا يمكن إعادة تشغيله من المحادثة ولا من التطبيق.",
    "After this is sent, the bot stays out of this chat for good: it cannot be switched back on from the chat or from the app.",
  ),
  alreadyAnswered: words("ئەم کۆمێنتە پێشتر وەڵامی دووکانەکەی هەیە.", "لهذا التعليق رد سابق من المتجر.", "This comment already has a reply from the shop."),
  done: {
    orderStatus: say(
      (status: string) => `دۆخی داواکارییەکە بوو بە «${status}».`,
      (status: string) => `أصبحت حالة الطلب «${status}».`,
      (status: string) => `The order is now “${status}”.`,
    ),
    hidden: words("کۆمێنتەکە شاردرایەوە.", "تم إخفاء التعليق.", "The comment is hidden."),
    shown: words("کۆمێنتەکە دووبارە دیار بوو.", "أصبح التعليق ظاهراً من جديد.", "The comment is visible again."),
    replied: words("وەڵامەکە نێردرا.", "تم إرسال الرد.", "The reply was sent."),
    sent: words("نامەکە نێردرا.", "تم إرسال الرسالة.", "The message was sent."),
    cancelled: words("پۆستی خشتەکراو هەڵوەشێنرایەوە.", "تم إلغاء المنشور المجدول.", "The scheduled post is cancelled."),
    productUpdated: words("بەرهەمەکە نوێ کرایەوە.", "تم تحديث المنتج.", "The product is updated."),
  },
};

/** What the cards of the older tools add to the app's own wording. */
export const CARD = {
  /** Said on the card of a story video: the AI invents the story from the idea, so it must be read before it is posted. */
  videoStoryNote: words(
    "AI چیرۆکەکە لە بیرۆکەکەتەوە دادەهێنێت؛ پێش بڵاوکردنەوە بیخوێنەوە.",
    "يؤلّف الذكاء الاصطناعي القصة من فكرتك؛ اقرأها قبل نشرها.",
    "The AI invents the story from your idea: read it before it is posted.",
  ),
  /** The value of a text that the change clears (an empty string): without it the card would show no line and hide the deletion. */
  cleared: words("بەتاڵ (دەسڕدرێتەوە)", "فارغ (سيتم مسحه)", "Empty (cleared)"),
  /** Said on the card of a product removal: the app has no way to bring it back. */
  archiveNote: words(
    "بەرهەمەکە لە شاشەی بەرهەمەکان نامێنێت و لە ئەپەوە ناگەڕێتەوە؛ تەنها وەک بەرهەمێکی نوێ دووبارە زیاد دەکرێتەوە.",
    "سيختفي المنتج من شاشة المنتجات ولا يمكن استرجاعه من التطبيق؛ يمكن فقط إضافته من جديد كمنتج جديد.",
    "The product leaves the Products screen and cannot be brought back from the app; it can only be added again as a new product.",
  ),
};
