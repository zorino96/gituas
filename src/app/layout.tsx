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
});

export const metadata: Metadata = {
  title: "gituas — the night shift for indie software",
  description:
    "give it to us and sleep. connect a repo, fund the wallet, close the laptop. our agents deploy, market, scale and route the earnings to your bank — and leave a note for the morning.",
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
