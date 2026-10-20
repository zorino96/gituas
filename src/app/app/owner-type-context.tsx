"use client";

// Who the owner says they are (a creator who earns from content, or someone who sells), known to the layout on the server and read by the
// menu and the chat screen in the browser. "unknown" until they have answered "how does your page earn for you?": nothing changes then.

import { createContext, useContext } from "react";

import type { OwnerType } from "@/lib/shop/owner-type";

const OwnerTypeContext = createContext<OwnerType>("unknown");

export function OwnerTypeProvider({ value, children }: { value: OwnerType; children: React.ReactNode }) {
  return <OwnerTypeContext.Provider value={value}>{children}</OwnerTypeContext.Provider>;
}

export const useOwnerType = (): OwnerType => useContext(OwnerTypeContext);
