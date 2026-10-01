/** The date line on a card: day, month and time in Baghdad. One function, so the editor and the server render print the same. */
export const stampOf = (when: string | Date): string =>
  new Intl.DateTimeFormat("ar-IQ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Baghdad" }).format(new Date(when));
