"use client";

import { usePathname } from "next/navigation";

/** The product the current URL belongs to — from the path, not the workspace. */
export function useBase(): "/app" | "/newsroom" {
  const pathname = usePathname();
  return pathname.startsWith("/newsroom") ? "/newsroom" : "/app";
}
