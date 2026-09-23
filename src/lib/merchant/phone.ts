export type PhoneResult = { ok: true; digits: string } | { ok: false; error: string };

const DIGIT_MAP: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

/**
 * Normalise what a merchant types into the digits wa.me expects.
 *
 * Iraqi mobiles are the common case and are accepted in every form people
 * write them — `0750…`, `750…`, `+964…`, `00964…`, in Arabic-Indic or Persian
 * digits. Any other country must be written with `+` or `00`, because a bare
 * local number from elsewhere is ambiguous.
 */
export function normalizePhone(raw: string): PhoneResult {
  const ascii = raw.replace(/[٠-٩۰-۹]/g, (d) => DIGIT_MAP[d] ?? d).trim();
  if (!ascii) return { ok: false, error: "empty" };
  if (/[^\d\s\-+().]/.test(ascii)) return { ok: false, error: "invalid characters" };

  const international = ascii.startsWith("+") || ascii.startsWith("00");
  let d = ascii.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (!international) {
    if (d.startsWith("0")) d = "964" + d.slice(1);
    else if (d.length === 10 && d.startsWith("7")) d = "964" + d;
  }

  if (d.startsWith("964")) {
    return /^9647\d{9}$/.test(d) ? { ok: true, digits: d } : { ok: false, error: "not an Iraqi mobile" };
  }
  if (!international) return { ok: false, error: "not an Iraqi mobile" };
  return d.length >= 8 && d.length <= 15 ? { ok: true, digits: d } : { ok: false, error: "wrong length" };
}

export function waLink(digits: string, text?: string): string {
  const base = `https://wa.me/${digits}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
