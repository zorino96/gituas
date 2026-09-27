/** Which product a post-login destination belongs to. Matches the prefixes the sign-in pages already use. */
export type Product = "newsroom" | "shop" | "operator";

export function productFor(next: string): Product {
  if (next.startsWith("/newsroom")) return "newsroom";
  if (next.startsWith("/app")) return "shop";
  return "operator";
}

/** The tab title for /login; undefined keeps the root layout's title (the operator's GitHub card). */
export function loginTitle(product: Product): string | undefined {
  if (product === "newsroom") return "چوونەژوورەوە — گیتواس نیوزڕووم";
  if (product === "shop") return "چوونەژوورەوە — گیتواس";
  return undefined;
}
