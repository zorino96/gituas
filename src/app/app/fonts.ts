import { IBM_Plex_Sans_Arabic, Noto_Kufi_Arabic } from "next/font/google";

// Shared by the merchant app and its sign-in pages, which live outside /app. Latin too: digits
// and Latin names on a server-rendered card must not depend on the machine's own fonts.
const sans = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--gm-sans",
  display: "swap",
});
const kufi = Noto_Kufi_Arabic({ subsets: ["arabic", "latin"], weight: ["500", "700"], variable: "--gm-kufi", display: "swap" });

export const gmFontVars = `${sans.variable} ${kufi.variable}`;
