"use client";

// Writes the face cookie when a page is shown (the Today page opened with ?ui=classic remembers "classic"). Draws nothing.

import { useEffect } from "react";

import { rememberFace } from "./face";

export function RememberFace({ face }: { face: "chat" | "classic" }) {
  useEffect(() => rememberFace(face), [face]);
  return null;
}
