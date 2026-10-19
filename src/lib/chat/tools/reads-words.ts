// The words the read tools show the PERSON that the app's dictionary (src/lib/i18n) does not already have. Sorani, Arabic and English:
// a new key must be written in all three, and the type checker refuses an object that lacks one. Words that already exist (order
// statuses, platform names, section titles, the comment badges) come from dict(lang) in the tools, not from here.
//
// A string with a number in it takes the number already formatted for the language (t.fmt.num), so digits look right in each.

import type { Lang } from "@/lib/i18n/lang";
import { num } from "@/lib/i18n/num";
import { plural } from "@/lib/i18n/plural";

export interface Words {
  // what the person sees while a tool works
  working: Record<string, string>;
  // shared
  customer: string;
  phone: string;
  address: string;
  product: string;
  total: string;
  status: string;
  date: string;
  price: string;
  // orders
  noOrders: string;
  /** "7 days", with the number in the language's own digits and the noun in the right form. */
  days: (n: number) => string;
  /** "the last 7 days", from the text days() gave. */
  last: (days: string) => string;
  today: string;
  before: string;
  orderCount: string;
  payment: string;
  paid: string;
  byHand: string;
  source: string;
  deliveryTime: string;
  // products
  noProducts: string;
  outOfStock: string;
  // comments and messages
  noCommentsWaiting: string;
  noComments: string;
  noConversationsWaiting: string;
  noConversations: string;
  notConnectedMeta: string;
  metaTooSlow: string;
  metaFailed: string;
  repliesCount: (n: string) => string;
  someOldChatsHidden: (n: string) => string;
  // WhatsApp chats (the shop's WhatsApp screen holds them, not Meta's Messages)
  notConnectedWa: string;
  waTooSlow: string;
  waFailed: string;
  /** A badge on a WhatsApp chat whose buyer wrote STOP. */
  askedToStop: string;
  /** A badge on a WhatsApp chat the owner answered on the phone (the app stored no message for it). */
  answeredOnPhone: string;
  /** A news desk's read covered the newest Page or account of a platform only: which one, how many others are connected, and where to switch. */
  severalAccounts: (platform: string, account: string, others: string, screen: string) => string;
  /** A shop chat's read covered the account the person chose in the chat (the Accounts button): which one, how many others are connected. */
  chosenAccount: (platform: string, account: string, others: string) => string;
  /** A shop chat's read covered the newest account because the person chose none: which one, how many others, and where to choose. */
  newestAccount: (platform: string, account: string, others: string) => string;
  // scheduled posts
  noScheduled: string;
  pending: string;
  running: string;
  failed: string;
  // insights
  /** The tile labels take the length of the period as days() wrote it ("28 days"): the unit is already in it. */
  dmsLabel: (days: string) => string;
  commentsLabel: (days: string) => string;
  ordersLabel: (days: string) => string;
  asks: string;
  haggles: string;
  commentsOnPost: string;
  // videos
  videosOff: string;
  withPhoto: string;
  // settings
  /** The title of the WhatsApp card. */
  whatsappTitle: string;
  on: string;
  off: string;
  notSet: string;
  connected: string;
  notConnected: string;
  primaryShop: string;
  autopilot: string;
  perDay: (n: string) => string;
  atHour: (h: string) => string;
  whatsappNumber: string;
  whatsappCloud: string;
  noShop: string;
  // account and plan
  account: string;
  aiUsed: string;
  waitingForYou: string;
  repliesToday: string;
  videosLeft: string;
  videosToday: string;
  picturesLeft: string;
  planUsageTitle: string;
}

const ckb: Words = {
  working: {
    get_account_state: "تەماشای باری هەژمارەکەت دەکەم…",
    orders_summary: "ژمارەی داواکارییەکان دەژمێرم…",
    list_orders: "تەماشای داواکارییەکان دەکەم…",
    get_order: "داواکارییەکە دەکەمەوە…",
    list_products: "بەرهەمەکان دەپشکنم…",
    list_comments: "کۆمێنتەکان دەخوێنمەوە…",
    list_conversations: "نامەکان دەخوێنمەوە…",
    get_conversation: "گفتوگۆکە دەکەمەوە…",
    list_scheduled_posts: "پۆستە خشتەکراوەکان دەپشکنم…",
    get_insights: "ئامارەکان کۆدەکەمەوە…",
    list_videos: "ڤیدیۆکان دەپشکنم…",
    get_settings: "ڕێکخستنەکان دەخوێنمەوە…",
    get_plan_usage: "بەکارهێنانی پلانەکەت دەپشکنم…",
  },
  customer: "کڕیار",
  phone: "مۆبایل",
  address: "ناونیشان",
  product: "بەرهەم",
  total: "کۆ",
  status: "دۆخ",
  date: "بەروار",
  price: "نرخ",
  noOrders: "هیچ داواکارییەک نەدۆزرایەوە.",
  days: (n) => `${num(n)} ڕۆژ`,
  last: (days) => `${days}ی ڕابردوو`,
  today: "ئەمڕۆ",
  before: "ماوەی پێشوو",
  orderCount: "داواکاری",
  payment: "پارەدان",
  paid: "پارە دراوە",
  byHand: "خۆت تۆمارت کردووە",
  source: "سەرچاوە",
  deliveryTime: "ماوەی گەیاندن",
  noProducts: "هیچ بەرهەمێک نەدۆزرایەوە.",
  outOfStock: "نەماوە",
  noCommentsWaiting: "هیچ کۆمێنتێک چاوەڕێی وەڵام نییە.",
  noComments: "هیچ کۆمێنتێک نەدۆزرایەوە.",
  noConversationsWaiting: "هیچ نامەیەک چاوەڕێی وەڵام نییە.",
  noConversations: "هیچ گفتوگۆیەک نەدۆزرایەوە.",
  notConnectedMeta: "فەیسبووک و ئینستاگرام پەیوەست نەکراون. لە دوگمەی «ئەکاونتەکان»ی چاتەکە «پەیوەست بکە» دابگرە.",
  metaTooSlow: "مێتا درەنگ وەڵامی دایەوە و کات نەما. دووبارە هەوڵ بدەرەوە.",
  metaFailed: "نەتوانرا لە مێتاوە بخوێنرێتەوە. دووبارە هەوڵ بدەرەوە.",
  repliesCount: (n) => `${n} وەڵام`,
  someOldChatsHidden: (n) => `${n} گفتوگۆی کۆن نەخوێنرانەوە.`,
  notConnectedWa: "واتسئەپ پەیوەست نەکراوە. لە بەشی واتسئەپ پەیوەستی بکە.",
  waTooSlow: "خوێندنەوەی گفتوگۆکانی واتسئەپ درەنگی کرد و کات نەما. دووبارە هەوڵ بدەرەوە.",
  waFailed: "نەتوانرا گفتوگۆکانی واتسئەپ بخوێنرێنەوە. دووبارە هەوڵ بدەرەوە.",
  askedToStop: "STOP ی نووسیوە",
  answeredOnPhone: "لە مۆبایلەوە وەڵام دراوەتەوە",
  severalAccounts: (platform, account, others, screen) => `${platform}: تەنها نوێترین هەژمار خوێندرایەوە، «${account}». هەژماری دیکەی پەیوەست: ${others}. لە بەشی «${screen}» دەتوانیت بیانگۆڕیت.`,
  chosenAccount: (platform, account, others) => `${platform}: بەپێی هەڵبژاردنی تۆ لە چاتەکەدا، «${account}» خوێندرایەوە. ئەکاونتی دیکەی پەیوەست: ${others}. بۆ گۆڕینی دوگمەی «ئەکاونتەکان» بەکاربهێنە.`,
  newestAccount: (platform, account, others) => `${platform}: تەنها نوێترین ئەکاونت خوێندرایەوە، «${account}». ئەکاونتی دیکەی پەیوەست: ${others}. بۆ هەڵبژاردنی یەکێکی تر دوگمەی «ئەکاونتەکان»ی چاتەکە بەکاربهێنە.`,
  noScheduled: "هیچ پۆستێکی خشتەکراو نییە.",
  pending: "چاوەڕێیە",
  running: "بڵاو دەکرێتەوە",
  failed: "سەرنەکەوت",
  dmsLabel: (days) => `نامەی کڕیار · ${days}`,
  commentsLabel: (days) => `کۆمێنت · ${days}`,
  ordersLabel: (days) => `داواکاری · ${days}`,
  asks: "پرسیار",
  haggles: "چانەلێدان",
  commentsOnPost: "کۆمێنت",
  videosOff: "ڤیدیۆی AI ئێستا چالاک نییە.",
  withPhoto: "لەگەڵ وێنە یان ڤیدیۆ",
  whatsappTitle: "واتسئەپ",
  on: "کراوە",
  off: "کوژاوە",
  notSet: "دانەنراوە",
  connected: "پەیوەستە",
  notConnected: "پەیوەست نییە",
  primaryShop: "دووکانی سەرەکی",
  autopilot: "پۆستی خۆکار",
  perDay: (n) => `${n} لە ڕۆژێکدا`,
  atHour: (h) => `کاتژمێر ${h}`,
  whatsappNumber: "ژمارەی واتسئەپ (بۆ لینکی داواکاری)",
  whatsappCloud: "واتسئەپ بۆ وەڵامدانەوەی نامە",
  noShop: "هێشتا هیچ پەیجێک پەیوەست نەکراوە.",
  account: "هەژمارەکەت",
  aiUsed: "بەشی AI بەکارهاتوو",
  waitingForYou: "نامەی چاوەڕێی تۆ (٧ ڕۆژ)",
  repliesToday: "وەڵامی ئەمڕۆ",
  videosLeft: "ڤیدیۆی ماوە ئەم مانگە",
  videosToday: "ڤیدیۆی ئەمڕۆ",
  picturesLeft: "وێنەی AI ی ماوە (مانگ / ئەمڕۆ)",
  planUsageTitle: "بەکارهێنانی پلان",
};

const ar: Words = {
  working: {
    get_account_state: "أطّلع على حالة حسابك…",
    orders_summary: "أحصي الطلبات…",
    list_orders: "أطّلع على الطلبات…",
    get_order: "أفتح تفاصيل الطلب…",
    list_products: "أراجع المنتجات…",
    list_comments: "أقرأ التعليقات…",
    list_conversations: "أقرأ الرسائل…",
    get_conversation: "أفتح المحادثة…",
    list_scheduled_posts: "أراجع المنشورات المجدولة…",
    get_insights: "أجمع الإحصاءات…",
    list_videos: "أراجع الفيديوهات…",
    get_settings: "أقرأ الإعدادات…",
    get_plan_usage: "أتحقق من استخدام باقتك…",
  },
  customer: "العميل",
  phone: "الهاتف",
  address: "العنوان",
  product: "المنتج",
  total: "المجموع",
  status: "الحالة",
  date: "التاريخ",
  price: "السعر",
  noOrders: "لم أجد أي طلب.",
  days: (n) => (n === 1 ? "يوم" : n === 2 ? "يومان" : `${num(n)} ${plural(n, { one: "يوم", two: "يومان", few: "أيام", many: "يومًا" })}`),
  last: (days) => `آخر ${days}`,
  today: "اليوم",
  before: "الفترة السابقة",
  orderCount: "طلبات",
  payment: "الدفع",
  paid: "مدفوع",
  byHand: "أدخلتَه بنفسك",
  source: "المصدر",
  deliveryTime: "مدة التوصيل",
  noProducts: "لم أجد أي منتج.",
  outOfStock: "نفد",
  noCommentsWaiting: "لا توجد تعليقات بانتظار الرد.",
  noComments: "لم أجد أي تعليق.",
  noConversationsWaiting: "لا توجد رسائل بانتظار الرد.",
  noConversations: "لم أجد أي محادثة.",
  notConnectedMeta: "فيسبوك وإنستغرام غير مرتبطين. افتح زر «الحسابات» في المحادثة واضغط «اربط».",
  metaTooSlow: "تأخرت ميتا في الرد ولم يبقَ وقت. حاول مرة أخرى.",
  metaFailed: "تعذّرت القراءة من ميتا. حاول مرة أخرى.",
  repliesCount: (n) => `${n} ردود`,
  someOldChatsHidden: (n) => `تعذّرت قراءة ${n} من المحادثات القديمة.`,
  notConnectedWa: "واتساب غير مرتبط. اربطه من شاشة واتساب.",
  waTooSlow: "تأخرت قراءة محادثات واتساب ولم يبقَ وقت. حاول مرة أخرى.",
  waFailed: "تعذّرت قراءة محادثات واتساب. حاول مرة أخرى.",
  askedToStop: "كتب STOP",
  answeredOnPhone: "تم الرد من الهاتف",
  severalAccounts: (platform, account, others, screen) => `${platform}: قُرئ الحساب الأحدث فقط، «${account}». عدد الحسابات الأخرى المرتبطة: ${others}. بدّل بينها من شاشة «${screen}».`,
  chosenAccount: (platform, account, others) => `${platform}: قُرئ الحساب الذي اخترته في المحادثة، «${account}». عدد الحسابات الأخرى المرتبطة: ${others}. لتغييره استخدم زر «الحسابات».`,
  newestAccount: (platform, account, others) => `${platform}: قُرئ الحساب الأحدث فقط، «${account}». عدد الحسابات الأخرى المرتبطة: ${others}. لاختيار حساب آخر استخدم زر «الحسابات» في المحادثة.`,
  noScheduled: "لا توجد منشورات مجدولة.",
  pending: "بالانتظار",
  running: "قيد النشر",
  failed: "فشل",
  dmsLabel: (days) => `رسائل العملاء · ${days}`,
  commentsLabel: (days) => `التعليقات · ${days}`,
  ordersLabel: (days) => `الطلبات · ${days}`,
  asks: "أسئلة",
  haggles: "مساومة",
  commentsOnPost: "تعليقات",
  videosOff: "فيديو الذكاء الاصطناعي غير مفعّل حاليًا.",
  withPhoto: "مع صورة أو فيديو",
  whatsappTitle: "واتساب",
  on: "مفعّل",
  off: "متوقف",
  notSet: "غير محدد",
  connected: "مرتبط",
  notConnected: "غير مرتبط",
  primaryShop: "المتجر الرئيسي",
  autopilot: "النشر التلقائي",
  perDay: (n) => `${n} في اليوم`,
  atHour: (h) => `الساعة ${h}`,
  whatsappNumber: "رقم واتساب (لروابط الطلب)",
  whatsappCloud: "واتساب للرد على الرسائل",
  noShop: "لم تربط أي صفحة بعد.",
  account: "حسابك",
  aiUsed: "حصة الذكاء الاصطناعي المستخدمة",
  waitingForYou: "رسائل بانتظارك (7 أيام)",
  repliesToday: "ردود اليوم",
  videosLeft: "فيديوهات متبقية هذا الشهر",
  videosToday: "فيديوهات اليوم",
  picturesLeft: "صور الذكاء الاصطناعي المتبقية (الشهر / اليوم)",
  planUsageTitle: "استخدام الباقة",
};

const en: Words = {
  working: {
    get_account_state: "Looking at your account…",
    orders_summary: "Counting the orders…",
    list_orders: "Looking at the orders…",
    get_order: "Opening the order…",
    list_products: "Checking the products…",
    list_comments: "Reading the comments…",
    list_conversations: "Reading the messages…",
    get_conversation: "Opening the conversation…",
    list_scheduled_posts: "Checking the scheduled posts…",
    get_insights: "Gathering the insights…",
    list_videos: "Checking the videos…",
    get_settings: "Reading the settings…",
    get_plan_usage: "Checking your plan usage…",
  },
  customer: "Customer",
  phone: "Phone",
  address: "Address",
  product: "Product",
  total: "Total",
  status: "Status",
  date: "Date",
  price: "Price",
  noOrders: "No orders found.",
  days: (n) => (n === 1 ? "1 day" : `${n} days`),
  last: (days) => `Last ${days}`,
  today: "Today",
  before: "previous period",
  orderCount: "orders",
  payment: "Payment",
  paid: "Paid",
  byHand: "Entered by you",
  source: "Source",
  deliveryTime: "Delivery time",
  noProducts: "No products found.",
  outOfStock: "Out of stock",
  noCommentsWaiting: "No comments are waiting for a reply.",
  noComments: "No comments found.",
  noConversationsWaiting: "No messages are waiting for a reply.",
  noConversations: "No conversations found.",
  notConnectedMeta: "Facebook and Instagram are not connected. Press Connect in the Accounts button of the chat.",
  metaTooSlow: "Meta was slow to answer and there was no time left. Try again.",
  metaFailed: "Could not read from Meta. Try again.",
  repliesCount: (n) => `${n} replies`,
  someOldChatsHidden: (n) => `${n} older conversations could not be read.`,
  notConnectedWa: "WhatsApp is not connected. Connect it on the WhatsApp screen.",
  waTooSlow: "Reading the WhatsApp chats took too long and there was no time left. Try again.",
  waFailed: "Could not read the WhatsApp chats. Try again.",
  askedToStop: "Wrote STOP",
  answeredOnPhone: "Answered on the phone",
  severalAccounts: (platform, account, others, screen) => `${platform}: only the newest account was read, “${account}”. Other connected accounts: ${others}. Switch between them in the ${screen} screen.`,
  chosenAccount: (platform, account, others) => `${platform}: read the account you chose in the chat, “${account}”. Other connected accounts: ${others}. The Accounts button changes it.`,
  newestAccount: (platform, account, others) => `${platform}: only the newest account was read, “${account}”. Other connected accounts: ${others}. The Accounts button in the chat chooses another.`,
  noScheduled: "Nothing is scheduled.",
  pending: "Waiting",
  running: "Publishing",
  failed: "Failed",
  dmsLabel: (days) => `Buyer messages · ${days}`,
  commentsLabel: (days) => `Comments · ${days}`,
  ordersLabel: (days) => `Orders · ${days}`,
  asks: "Questions",
  haggles: "Haggling",
  commentsOnPost: "comments",
  videosOff: "AI video is not switched on right now.",
  withPhoto: "With a picture or video",
  whatsappTitle: "WhatsApp",
  on: "On",
  off: "Off",
  notSet: "Not set",
  connected: "Connected",
  notConnected: "Not connected",
  primaryShop: "Main shop",
  autopilot: "Automatic posts",
  perDay: (n) => `${n} a day`,
  atHour: (h) => `at ${h}`,
  whatsappNumber: "WhatsApp number (for order links)",
  whatsappCloud: "WhatsApp for answering messages",
  noShop: "No page is connected yet.",
  account: "Your account",
  aiUsed: "AI allowance used",
  waitingForYou: "Messages waiting for you (7 days)",
  repliesToday: "Replies today",
  videosLeft: "Videos left this month",
  videosToday: "Videos today",
  picturesLeft: "AI pictures left (month / today)",
  planUsageTitle: "Plan usage",
};

/** The words for a language. */
export function words(lang: Lang): Words {
  return lang === "ar" ? ar : lang === "en" ? en : ckb;
}
