import Link from "next/link";
import type { ReactNode } from "react";

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen text-fg overflow-hidden">
      <div className="nightsky" aria-hidden>
        <div className="aurora" />
        <div className="stars" />
        <div className="stars-2" />
        <div className="grain" />
        <div className="vignette" />
      </div>

      <header className="relative z-10 mx-auto max-w-3xl px-6 pt-10 flex items-center justify-between">
        <Link href="/" className="inline-flex items-center gap-3 group">
          <span className="moon" style={{ width: 26, height: 26 }} />
          <span className="font-display text-xl tracking-tight">gituas</span>
        </Link>
        <Link
          href="/"
          className="font-mono text-[11px] tracking-[0.22em] uppercase text-fg-dim hover:text-fg transition-colors"
        >
          ← back to site
        </Link>
      </header>

      <main className="relative z-10 mx-auto max-w-3xl px-6 py-14">{children}</main>

      <footer className="relative z-10 mx-auto max-w-3xl px-6 pb-16 pt-8">
        <div className="border-t border-line pt-6 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] tracking-[0.18em] uppercase text-fg-dim">
          <Link href="/privacy" className="hover:text-fg transition-colors">privacy</Link>
          <Link href="/terms" className="hover:text-fg transition-colors">terms</Link>
          <Link href="/data-deletion" className="hover:text-fg transition-colors">data deletion</Link>
          <span className="ml-auto normal-case tracking-normal text-fg-dim/70">© 2026 Gituas</span>
        </div>
      </footer>
    </div>
  );
}
