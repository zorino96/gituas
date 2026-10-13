/** Western digits to Arabic-Indic digits (Sorani and Arabic pages read ٠١٢٣٤٥٦٧٨٩). */
export function ku(s: string): string {
  return s.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
}
