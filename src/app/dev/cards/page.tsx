import { notFound } from "next/navigation";

import { gmFontVars } from "@/app/app/fonts";
import { CardsPreview } from "./preview";

export default function DevCardsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className={gmFontVars} style={{ padding: 16, background: "#f6f5f2", minHeight: "100vh" }}>
      <CardsPreview />
    </div>
  );
}
