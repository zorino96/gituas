"use client";

import { useRef, useState } from "react";

import { NewsCard, CARD_H, CARD_W } from "@/lib/cards/templates";
import { brandFrom } from "@/lib/cards/brand";
import { renderCardPng } from "@/lib/cards/render";
import type { CardKind } from "@/lib/news/types";

const W = 260;
const brand = brandFrom(null, "هەواڵی هەولێر");
const SAMPLES: Array<{ kind: CardKind; headline: string; stat?: string; quote?: string; speaker?: string }> = [
  { kind: "STANDARD", headline: "حکومەتی هەرێم پڕۆژەی بودجەی ساڵی داهاتووی پەسەند کرد" },
  { kind: "BREAKING", headline: "بوومەلەرزەیەکی ٤.٢ پلەیی سنووری دهۆکی هەژاند" },
  { kind: "STAT", headline: "بەرزبوونەوەی نرخی ئاڵتوون لە بازاڕەکانی هەولێر لە مانگێکدا", stat: "٪١٢" },
  { kind: "QUOTE", headline: "کارەبا", quote: "کارەبای نیشتمانی لە مانگی داهاتووەوە ٢٠ کاتژمێر دەبێت", speaker: "وەزارەتی کارەبا" },
];

export function CardsPreview() {
  const first = useRef<HTMLDivElement>(null);
  const [png, setPng] = useState<string | null>(null);
  return (
    <div dir="rtl">
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {SAMPLES.map((s, i) => (
          <div key={s.kind} dir="ltr" style={{ width: W, height: (CARD_H * W) / CARD_W, overflow: "hidden", borderRadius: 10 }}>
            <div style={{ transform: `scale(${W / CARD_W})`, transformOrigin: "top left", width: CARD_W, height: CARD_H }}>
              <NewsCard
                ref={i === 1 ? first : undefined}
                kind={s.kind}
                brand={brand}
                content={{ headline: s.headline, stat: s.stat ?? null, quote: s.quote ?? null, speaker: s.speaker ?? null, sourceName: "ڕاگەیەندراوی فەرمی", stamp: "٢٦/٩ ١٠:٤٢", photoSrc: null }}
              />
            </div>
          </div>
        ))}
      </div>
      <button type="button" style={{ marginTop: 12 }} onClick={async () => setPng(URL.createObjectURL(await renderCardPng(first.current!)))}>
        PNG of the breaking card
      </button>
      {png && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={png} alt="rendered card" style={{ display: "block", width: W, marginTop: 12 }} />
      )}
    </div>
  );
}
