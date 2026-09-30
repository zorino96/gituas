/** Western 0-9, Arabic-Indic ٠-٩ and Extended Arabic-Indic (Persian) ۰-۹. */
const DIGIT = /[0-9٠-٩۰-۹]/;

/** The guard that keeps AI-written text free of prices, sizes and phone numbers. */
export function hasDigit(text: string): boolean {
  return DIGIT.test(text);
}
