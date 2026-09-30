// Numbers are shown in Arabic-Indic digits, the way Kurdish and Iraqi merchants write them.
// Kept apart from format.ts so the dictionaries can use it without an import cycle.

const nf = new Intl.NumberFormat("ar-IQ");

export function num(n: number | null | undefined): string {
  return n == null || Number.isNaN(n) ? "—" : nf.format(n);
}
