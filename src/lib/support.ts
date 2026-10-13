// How a person reaches us. One place, so the assistant, the settings and the privacy page agree.

/** The WhatsApp number of Gituas support, digits only (country code first). */
export const SUPPORT_WHATSAPP = "9647710106009";
/** The same number as people write it. */
export const SUPPORT_WHATSAPP_DISPLAY = "+964 771 010 6009";

/** A link that opens a chat with support, optionally with the first words filled in. */
export function supportWhatsAppUrl(text?: string): string {
  const base = `https://wa.me/${SUPPORT_WHATSAPP}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
