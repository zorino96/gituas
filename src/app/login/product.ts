import { ckb, type Dict } from "@/lib/i18n/ckb";

/** Which product a post-login destination belongs to. Matches the prefixes the sign-in pages already use. */
export type Product = "newsroom" | "shop" | "operator";

export function productFor(next: string): Product {
  if (next.startsWith("/newsroom")) return "newsroom";
  if (next.startsWith("/app")) return "shop";
  return "operator";
}

/** The tab title for /login, in the dictionary's language (Sorani by default); undefined keeps the root layout's title (the operator's GitHub card). */
export function loginTitle(product: Product, t: Dict = ckb): string | undefined {
  if (product === "newsroom") return `${t.auth.login.pageTitle} — ${t.nr.shell.name}`;
  if (product === "shop") return `${t.auth.login.pageTitle} — ${t.brand}`;
  return undefined;
}
