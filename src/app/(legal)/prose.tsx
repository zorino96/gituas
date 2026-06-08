import Link from "next/link";
import type { ReactNode } from "react";

export function Updated({ date }: { date: string }) {
  return (
    <p className="font-mono text-[11px] tracking-[0.28em] uppercase text-fg-dim mb-10">
      Last updated · {date}
    </p>
  );
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="text-lg leading-8 text-fg/90 mb-6">{children}</p>;
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="font-display text-2xl text-fg mt-12 mb-4">{children}</h2>;
}

export function P({ children }: { children: ReactNode }) {
  return <p className="text-[15px] leading-7 text-fg-dim mb-4">{children}</p>;
}

export function UL({ children }: { children: ReactNode }) {
  return (
    <ul className="list-disc pl-5 space-y-2 text-[15px] leading-7 text-fg-dim mb-4 marker:text-money">
      {children}
    </ul>
  );
}

export function LI({ children }: { children: ReactNode }) {
  return <li>{children}</li>;
}

export function Strong({ children }: { children: ReactNode }) {
  return <strong className="text-fg font-medium">{children}</strong>;
}

export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-money underline underline-offset-2 hover:text-fg transition-colors"
    >
      {children}
    </a>
  );
}

export function InLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-money underline underline-offset-2 hover:text-fg transition-colors">
      {children}
    </Link>
  );
}
