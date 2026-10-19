// Rules the database, hook and tool tests share. Each is built through the real parser, so a fixture that stops being a valid rule fails loudly.

import { parseRuleSpec, type RuleSpecT } from "@/lib/shop/rules/spec";

function must(input: unknown): RuleSpecT {
  const r = parseRuleSpec(input);
  if (!r.ok) throw new Error(`fixture is not a valid rule: ${r.issues.join("; ")}`);
  return r.spec;
}

/** "When someone comments info, send them the delivery details": a comment rule with a private reply in three languages. */
export function infoRule(over: Record<string, unknown> = {}): RuleSpecT {
  return must({
    v: 1,
    name: "Delivery info",
    trigger: { channel: "comment", platforms: ["META_FACEBOOK", "META_INSTAGRAM"], keywords: { any: ["info", "زانیاری", "معلومات"] } },
    actions: [
      {
        do: "reply",
        publicLine: "standard",
        texts: {
          default: "Hello. We deliver to every city for 5,000 IQD, in 1 to 3 days.",
          ckb: "سڵاو. گەیاندن بۆ هەموو شارەکان هەیە، ٥٠٠٠ دینار و ١ بۆ ٣ ڕۆژ.",
          ar: "أهلاً. التوصيل لكل المحافظات بسعر ٥٠٠٠ دينار وخلال ١-٣ أيام.",
        },
      },
    ],
    examples: [
      { text: "info", match: true },
      { text: "زانیاری؟", match: true, as: { language: "ckb" } },
      { text: "hello there", match: false },
    ],
    ...over,
  });
}

/** A chat rule: whoever writes "address" gets the shop's address. */
export function addressRule(over: Record<string, unknown> = {}): RuleSpecT {
  return must({
    v: 1,
    name: "Shop address",
    trigger: { channel: "dm", platforms: ["META_FACEBOOK", "META_INSTAGRAM", "WHATSAPP"], keywords: { any: ["address", "ناونیشان", "عنوان"] } },
    actions: [{ do: "reply", texts: { default: "We are in Erbil, Gulan Street, opposite the park." } }],
    examples: [
      { text: "what is your address", match: true },
      { text: "thank you", match: false },
    ],
    ...over,
  });
}

/** A rule that only flags the message for the owner. */
export function flagRule(over: Record<string, unknown> = {}): RuleSpecT {
  return must({
    v: 1,
    name: "Look at refunds",
    trigger: { channel: "dm", platforms: ["META_FACEBOOK", "META_INSTAGRAM"], keywords: { any: ["refund", "گەڕاندنەوە"] } },
    actions: [{ do: "flag_owner", note: "Customer talks about a refund" }],
    examples: [
      { text: "I want a refund", match: true },
      { text: "thank you", match: false },
    ],
    ...over,
  });
}
