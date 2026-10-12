/** Only Meta's own CDNs are fetched from a url Meta gave us (webhook attachments, post media). */
export function metaMediaUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && /(^|\.)(fbcdn\.net|fbsbx\.com|cdninstagram\.com|facebook\.com|whatsapp\.net)$/.test(u.hostname);
  } catch {
    return false;
  }
}
