import { twMerge } from "tailwind-merge";

type ClassValue = string | number | boolean | null | undefined | ClassValue[] | { [k: string]: unknown };

export function cn(...inputs: ClassValue[]): string {
  return twMerge(flatten(inputs).filter(Boolean).join(" "));
}

function flatten(v: ClassValue): string[] {
  if (!v) return [];
  if (typeof v === "string") return [v];
  if (typeof v === "number" || typeof v === "boolean") return [String(v)];
  if (Array.isArray(v)) return v.flatMap(flatten);
  if (typeof v === "object") {
    return Object.entries(v).filter(([, val]) => Boolean(val)).map(([k]) => k);
  }
  return [];
}
