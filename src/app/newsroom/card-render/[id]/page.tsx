// The card of one draft, alone on the page at 1080×1350, for the headless browser in
// src/lib/cards/server-render.ts to screenshot. It is the editor's own card: the same
// component, fonts, stylesheets and brand kit. Outside the (desk) group on purpose: no
// shell and no session. The signed, five-minute token in ?t= is what lets a request in.
import "@/app/app/app.css";
import "../../newsroom.css";

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { gmFontVars } from "@/app/app/fonts";
import { mediaSrc } from "@/lib/cards/brand";
import { brandForStory, categoryOfStory, loadFrames } from "@/lib/news/frames";
import { verifyRenderToken } from "@/lib/cards/render-token";
import { CARD_H, CARD_W } from "@/lib/cards/size";
import { stampOf } from "@/lib/cards/stamp";
import { NewsCard } from "@/lib/cards/templates";
import { db } from "@/lib/db";
import { isAiImage } from "@/lib/news/ai-picture";
import { isSourceImage } from "@/lib/news/source-image";
import { CARD_KINDS, type CardKind } from "@/lib/news/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "card", robots: { index: false, follow: false } };

// The page is the card and nothing else. The last rule hides Next's development badge.
const PAGE_CSS = "html, body { margin: 0; padding: 0; background: #fff; } nextjs-portal { display: none !important; }";

export default async function CardRenderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const [{ id }, { t }] = await Promise.all([params, searchParams]);
  if (!verifyRenderToken(id, t)) notFound();

  // Only the columns the card draws.
  const draft = await db.newsDraft.findUnique({
    where: { id },
    select: {
      tenantId: true,
      headline: true,
      cardKind: true,
      stat: true,
      quote: true,
      speaker: true,
      photoPath: true,
      category: true,
      item: { select: { publishedAt: true, category: true, sourceName: true } },
    },
  });
  if (!draft) notFound();
  const [frames, kit, tenant] = await Promise.all([
    loadFrames(draft.tenantId),
    db.brandKit.findUnique({
      where: { tenantId: draft.tenantId },
      select: { logoPath: true, primary: true, accent: true, text: true, headingFont: true, framePath: true, frameText: true },
    }),
    db.tenant.findUnique({ where: { id: draft.tenantId }, select: { name: true } }),
  ]);
  if (!tenant) notFound();

  return (
    <div className={`gm nr ${gmFontVars}`} dir="rtl" lang="ckb">
      <style>{PAGE_CSS}</style>
      <div id="card" dir="ltr" style={{ position: "fixed", top: 0, left: 0, width: CARD_W, height: CARD_H, margin: 0, overflow: "hidden" }}>
        <NewsCard
          kind={(CARD_KINDS.includes(draft.cardKind as CardKind) ? draft.cardKind : "STANDARD") as CardKind}
          brand={brandForStory(kit, tenant.name, frames, draft.cardKind, categoryOfStory(draft.item.category, draft.category))}
          content={{
            headline: draft.headline,
            stat: draft.stat,
            quote: draft.quote,
            speaker: draft.speaker,
            stamp: stampOf(draft.item.publishedAt),
            credit: isSourceImage(draft.photoPath) ? `وێنە: ${draft.item.sourceName}` : isAiImage(draft.photoPath) ? "وێنەی ڕوونکەرەوە (AI)" : null,
            photoSrc: mediaSrc(draft.photoPath),
          }}
        />
      </div>
    </div>
  );
}
