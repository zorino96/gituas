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
  /**
   * Said on the card of a story video that is told from a real case (every story whose idea does not say fiction, in any video language): the
   * case is the one the owner named, or, when none was named, one Gituas chooses and shows on the video card, retold from its Wikipedia article
   * WHEN THAT CAN BE READ (otherwise the video card says it was told from memory); the photographs are the free ones from Wikimedia Commons
   * where they are found. Nothing here promises a photograph for every part. The owner reads it before it is posted.
   */
  videoStoryReal: words(
    "چیرۆکەکە لەسەر کەیسێکی ڕاستەقینەی باش تۆمارکراو دەگێڕدرێتەوە: ئەوەی تۆ ناوت بردووە، یان ئەگەر ناوی هیچت نەبردبێت، ئەوەی گیتواس هەڵیدەبژێرێت و لەسەر کارتی ڤیدیۆکە پیشانی دەدات. لە وتارەکەی ویکیپیدیاوە بە وشەی نوێ دەگێڕدرێتەوە کاتێک بخوێندرێتەوە، ئەگینا کارتی ڤیدیۆکە دەڵێت لە یادەوەرییەوە گێڕدراوەتەوە. وێنەی ئازاد لە ویکیمیدیا کۆمۆنز بەکاردێت لەو شوێنانەی دەدۆزرێنەوە و ناوی خاوەنەکانیان لە وەسفەکە و لە کۆتا دیمەنەکەدا دەنووسرێت. پێش بڵاوکردنەوە بیخوێنەوە.",
    "تُروى القصة عن قضية حقيقية موثّقة جيدًا: التي ذكرتها، أو، إن لم تذكر قضية، تلك التي تختارها Gituas وتعرضها على بطاقة الفيديو. تُعاد صياغتها من مقالتها في ويكيبيديا حين يمكن قراءتها، وإلا تذكر بطاقة الفيديو أنها رُويت من الذاكرة. تُستخدم صور حرة من ويكيميديا كومنز حيثما وُجدت ويُذكر أصحابها في الوصف وفي المشهد الأخير. اقرأها قبل نشرها.",
    "Told from a real, well-documented case: the one you named, or, when you named none, one Gituas chooses and shows on the video card. It is retold from its Wikipedia article when that can be read; otherwise the video card says it was told from memory. Free photographs from Wikimedia Commons are used where they are found, and credited in the caption and on the last scene. Read it before it is posted.",
  ),
  /** The same when the owner switched the photographs off. */
  videoStoryRealNoPhotos: words(
    "چیرۆکەکە لەسەر کەیسێکی ڕاستەقینەی باش تۆمارکراو دەگێڕدرێتەوە: ئەوەی تۆ ناوت بردووە، یان ئەگەر ناوی هیچت نەبردبێت، ئەوەی گیتواس هەڵیدەبژێرێت و لەسەر کارتی ڤیدیۆکە پیشانی دەدات. لە وتارەکەی ویکیپیدیاوە بە وشەی نوێ دەگێڕدرێتەوە کاتێک بخوێندرێتەوە، ئەگینا کارتی ڤیدیۆکە دەڵێت لە یادەوەرییەوە گێڕدراوەتەوە. وێنەی تێدا نابێت. پێش بڵاوکردنەوە بیخوێنەوە.",
    "تُروى القصة عن قضية حقيقية موثّقة جيدًا: التي ذكرتها، أو، إن لم تذكر قضية، تلك التي تختارها Gituas وتعرضها على بطاقة الفيديو. تُعاد صياغتها من مقالتها في ويكيبيديا حين يمكن قراءتها، وإلا تذكر بطاقة الفيديو أنها رُويت من الذاكرة. بلا صور. اقرأها قبل نشرها.",
    "Told from a real, well-documented case: the one you named, or, when you named none, one Gituas chooses and shows on the video card. It is retold from its Wikipedia article when that can be read; otherwise the video card says it was told from memory. No photographs. Read it before it is posted.",
  ),
  /** Said on the card of a story (any video language) the owner asked for as fiction (the idea says so): invented, told as fiction, no real photographs. */
  videoStoryFiction: words(
    "چیرۆکێکی خەیاڵییە و وەک خەیاڵ دەگێڕدرێتەوە (پۆستەکەش ئەوە دەڵێت). پێش بڵاوکردنەوە بیخوێنەوە.",
    "قصة خيالية تُروى كخيال (ويذكر المنشور ذلك). اقرأها قبل نشرها.",
    "A fictional story, told as fiction (the post says so). Read it before it is posted.",
  ),
  /** Said on a story's card when Gituas itself set the shape to wide, because the owner's recent words mention YouTube or 16:9 (see wantsWide in video/story-form.ts). */
  videoWideAuto: words(
    "بە پان 16:9 دانرا، چونکە باسی یوتیوبت کرد.",
    "ضُبط على العريض 16:9 لأنك ذكرت يوتيوب.",
    "Set to wide 16:9 because you mentioned YouTube or 16:9.",
  ),
  /** The label of the card line that says what the owner attached and the video does not use (the sentences are the dictionary's assistant.done.videoNotUsed*). */
  notUsedLabel: words("بەکارنەهات", "لم يُستخدم", "Not used"),
  /** The value of a text that the change clears (an empty string): without it the card would show no line and hide the deletion. */
  cleared: words("بەتاڵ (دەسڕدرێتەوە)", "فارغ (سيتم مسحه)", "Empty (cleared)"),
  /** Said on the card of a product removal: the app has no way to bring it back. */
  archiveNote: words(
    "بەرهەمەکە لە شاشەی بەرهەمەکان نامێنێت و لە ئەپەوە ناگەڕێتەوە؛ تەنها وەک بەرهەمێکی نوێ دووبارە زیاد دەکرێتەوە.",
    "سيختفي المنتج من شاشة المنتجات ولا يمكن استرجاعه من التطبيق؛ يمكن فقط إضافته من جديد كمنتج جديد.",
    "The product leaves the Products screen and cannot be brought back from the app; it can only be added again as a new product.",
  ),
};
