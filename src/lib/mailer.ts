/**
 * Transactional email through Resend's HTTP API. Switches on when
 * RESEND_API_KEY is set; until then sign-up works without a code, the same
 * way Google sign-in waits for its keys.
 */
// Local development only: print the email to the server log instead of sending.
const devLog = process.env.NODE_ENV !== "production" && process.env.EMAIL_DEV_LOG === "1";

export const emailEnabled = !!process.env.RESEND_API_KEY || devLog;

const FROM = process.env.EMAIL_FROM ?? "Gituas <no-reply@gituas.com>";

export async function sendEmail(msg: { to: string; subject: string; text: string; html: string }): Promise<{ ok: boolean }> {
  if (!emailEnabled) return { ok: false };
  if (!process.env.RESEND_API_KEY) {
    console.log(`[mailer:dev] to=${msg.to} subject=${msg.subject}`);
    return { ok: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error("[mailer] send failed", res.status, (await res.text()).slice(0, 300));
    return { ok: res.ok };
  } catch (err) {
    console.error("[mailer] send failed", err);
    return { ok: false };
  }
}

/** The sign-up code email: Kurdish, right to left, the code large enough to read at a glance. */
export function signupCodeEmail(code: string): { subject: string; text: string; html: string } {
  const minutes = "١٠";
  return {
    subject: `کۆدی گیتواس: ${code}`,
    text: `کۆدی دڵنیاکردنەوەی هەژمارەکەت لە گیتواس: ${code}\n\nئەم کۆدە بۆ ${minutes} خولەک کار دەکات. ئەگەر تۆ خۆت تۆمار نەکردووە، ئەم ئیمەیڵە پشتگوێ بخە.`,
    html: `<!doctype html><html lang="ckb" dir="rtl"><body style="margin:0;padding:24px;background:#f6f5f2;font-family:Tahoma,Arial,sans-serif;color:#1c1b19">
<div style="max-width:420px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;text-align:right">
<p style="margin:0 0 6px;font-size:20px;font-weight:700">گیتواس</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.7">کۆدی دڵنیاکردنەوەی هەژمارەکەت:</p>
<p dir="ltr" style="margin:0 0 20px;font-size:34px;font-weight:700;letter-spacing:8px;text-align:center;font-family:Consolas,monospace">${code}</p>
<p style="margin:0;font-size:13px;line-height:1.7;color:#6b6760">ئەم کۆدە بۆ ${minutes} خولەک کار دەکات. ئەگەر تۆ خۆت تۆمار نەکردووە، ئەم ئیمەیڵە پشتگوێ بخە.</p>
</div></body></html>`,
  };
}
