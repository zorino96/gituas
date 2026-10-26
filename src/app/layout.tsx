import type { Metadata } from "next";
import { Fraunces, Instrument_Sans, Spline_Sans_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import { Providers } from "./providers";

// NOCTURNE type system — editorial serif + refined grotesque + characterful mono.
const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
  display: "swap",
  preload: false,
});

const instrument = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});

const splineMono = Spline_Sans_Mono({
  subsets: ["latin"],
  variable: "--font-spline-mono",
  display: "swap",
  preload: false,
});

// The defaults of every page that has none of its own (the website's pages set theirs: src/lib/site/seo.ts).
export const metadata: Metadata = {
  metadataBase: new URL("https://gituas.com"),
  title: "Gituas — AI replies, orders and video ads for shops in Kurdistan and Iraq",
  description:
    "Gituas answers your Facebook and Instagram comments and messages in Kurdish and Arabic, collects orders, and makes video ads and pictures with AI. Free to start.",
  applicationName: "Gituas",
  openGraph: { siteName: "Gituas", type: "website" },
  // The Meta app "Gituas Chat": Facebook's Sharing Debugger asks for it.
  facebook: { appId: "1602806601306973" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${instrument.variable} ${splineMono.variable}`}
    >
      <body className="antialiased">
        <Providers>{children}</Providers>
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: "#0f1525",
              color: "#efeadb",
              border: "1px solid #283150",
              fontFamily: "var(--font-spline-mono)",
              fontSize: "12.5px",
              borderRadius: "12px",
            },
          }}
        />
      </body>
    </html>
  );
}
