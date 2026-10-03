/** Arabic counts: 1 and 2 have their own forms, 3–10 the plural, 11 and up the singular again. */
export function plural(n: number, forms: { one: string; two: string; few: string; many: string }): string {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  const r = n % 100;
  return r >= 3 && r <= 10 ? forms.few : forms.many;
}
