"use client";

import { forwardRef, useLayoutEffect, useRef, type CSSProperties } from "react";

import type { CardKind } from "@/lib/news/types";
import { BODY_FONT, HEADING_FONT, type Brand } from "./brand";

export const CARD_W = 1080;
export const CARD_H = 1350;

export interface CardContent {
  headline: string;
  stat: string | null;
  quote: string | null;
  speaker: string | null;
  sourceName: string;
  stamp: string;
  photoSrc: string | null;
}

/**
 * Shrinks the element's font from `max` px until its text fits its box, down
 * to `min`. Marks `data-overflow="1"` when even `min` does not fit, so the
 * editor can ask for a shorter headline. Fits again once the real font has
 * loaded (`document.fonts.ready`, and any later `loadingdone`), so a
 * late-loading font can't leave a clipped headline still marked as fitting.
 */
function useFit(text: string, max: number, min: number, font: string) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      let size = max;
      el.style.fontSize = `${size}px`;
      while (size > min && el.scrollHeight > el.clientHeight) {
        size -= 2;
        el.style.fontSize = `${size}px`;
      }
      el.dataset.overflow = el.scrollHeight > el.clientHeight ? "1" : "0";
    };
    fit();
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (!cancelled) fit();
    });
    document.fonts.addEventListener("loadingdone", fit);
    return () => {
      cancelled = true;
      document.fonts.removeEventListener("loadingdone", fit);
    };
  }, [text, max, min, font]);
  return ref;
}

const abs = (s: CSSProperties): CSSProperties => ({ position: "absolute", ...s });

function Header({ brand, dark }: { brand: Brand; dark: boolean }) {
  const color = dark ? brand.primary : brand.text;
  return (
    <div style={abs({ top: 48, right: 56, left: 56, display: "flex", alignItems: "center", gap: 18, color })}>
      {brand.logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoSrc} alt="" style={{ height: 72, width: "auto", maxWidth: 260, objectFit: "contain" }} />
      ) : (
        <span style={{ width: 64, height: 64, borderRadius: 32, background: dark ? brand.primary : brand.accent, color: dark ? brand.accent : brand.primary, display: "grid", placeItems: "center", font: `700 34px ${HEADING_FONT[brand.headingFont]}` }}>
          {[...brand.pageName][0] ?? "ه"}
        </span>
      )}
      <span style={{ font: `700 34px ${HEADING_FONT[brand.headingFont]}` }}>{brand.pageName}</span>
    </div>
  );
}

function Footer({ brand, content, dark }: { brand: Brand; content: CardContent; dark: boolean }) {
  return (
    <div style={abs({ bottom: 44, right: 56, left: 56, display: "flex", justifyContent: "space-between", font: `500 32px ${BODY_FONT}`, color: dark ? brand.primary : brand.text, opacity: 0.85 })}>
      <span>سەرچاوە: {content.sourceName}</span>
      <span>{content.stamp}</span>
    </div>
  );
}

function Standard({ brand, content }: { brand: Brand; content: CardContent }) {
  const font = `700 64px/1.55 ${HEADING_FONT[brand.headingFont]}`;
  const head = useFit(content.headline, 64, 36, font);
  return (
    <>
      <div style={abs({ top: 0, right: 0, left: 0, height: 780, background: `linear-gradient(135deg, ${brand.primary}, ${brand.accent})` })}>
        {content.photoSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={content.photoSrc} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        )}
      </div>
      <div style={abs({ top: 0, right: 0, left: 0, height: 180, background: "linear-gradient(rgba(0,0,0,.55), transparent)" })} />
      <Header brand={brand} dark={false} />
      <div style={abs({ top: 780, right: 0, left: 0, bottom: 0, background: brand.primary, borderTop: `12px solid ${brand.accent}` })} />
      <div ref={head} style={abs({ top: 840, right: 56, left: 56, height: 360, overflow: "hidden", overflowWrap: "anywhere", color: brand.text, font })}>
        {content.headline}
      </div>
      <Footer brand={brand} content={content} dark={false} />
    </>
  );
}

function Breaking({ brand, content }: { brand: Brand; content: CardContent }) {
  const font = `700 84px/1.55 ${HEADING_FONT[brand.headingFont]}`;
  const head = useFit(content.headline, 84, 44, font);
  return (
    <>
      <Header brand={brand} dark={false} />
      <div style={abs({ top: 220, right: 0, background: "#C8102E", color: "#fff", padding: "18px 56px", font: `700 56px ${HEADING_FONT[brand.headingFont]}` })}>بەپەلە</div>
      <div ref={head} style={abs({ top: 400, right: 56, left: 56, height: 620, overflow: "hidden", overflowWrap: "anywhere", color: brand.text, font })}>
        {content.headline}
      </div>
      <div style={abs({ top: 1060, right: 56, width: 180, height: 12, background: brand.accent })} />
      <Footer brand={brand} content={content} dark={false} />
    </>
  );
}

function Stat({ brand, content }: { brand: Brand; content: CardContent }) {
  const font = `700 60px/1.6 ${HEADING_FONT[brand.headingFont]}`;
  const head = useFit(content.headline, 60, 34, font);
  return (
    <>
      <div style={abs({ inset: 0, background: brand.accent })} />
      <Header brand={brand} dark />
      <div style={abs({ top: 250, right: 56, left: 56, color: brand.primary, font: `700 220px/1.1 ${HEADING_FONT[brand.headingFont]}`, whiteSpace: "nowrap", overflow: "hidden" })}>
        {content.stat}
      </div>
      <div ref={head} style={abs({ top: 600, right: 56, left: 56, height: 520, overflow: "hidden", overflowWrap: "anywhere", color: brand.primary, font })}>
        {content.headline}
      </div>
      <Footer brand={brand} content={content} dark />
    </>
  );
}

function Quote({ brand, content }: { brand: Brand; content: CardContent }) {
  const text = content.quote ?? content.headline;
  const font = `700 64px/1.6 ${HEADING_FONT[brand.headingFont]}`;
  const q = useFit(text, 64, 36, font);
  return (
    <>
      <Header brand={brand} dark={false} />
      <div style={abs({ top: 200, right: 48, color: brand.accent, font: `700 260px/1 ${HEADING_FONT[brand.headingFont]}` })}>«</div>
      <div ref={q} style={abs({ top: 470, right: 64, left: 64, height: 540, overflow: "hidden", overflowWrap: "anywhere", color: brand.text, font })}>
        {text}
      </div>
      {content.speaker && (
        <div style={abs({ top: 1060, right: 64, left: 64, color: brand.accent, font: `600 40px ${BODY_FONT}` })}>— {content.speaker}</div>
      )}
      <Footer brand={brand} content={content} dark={false} />
    </>
  );
}

/** A 1080×1350 card. Render it unscaled; scale its parent for previews. */
export const NewsCard = forwardRef<HTMLDivElement, { kind: CardKind; brand: Brand; content: CardContent }>(function NewsCard(
  { kind, brand, content },
  ref,
) {
  return (
    <div
      ref={ref}
      dir="rtl"
      style={{ position: "relative", width: CARD_W, height: CARD_H, overflow: "hidden", background: brand.primary, fontFamily: BODY_FONT }}
    >
      {kind === "BREAKING" ? (
        <Breaking brand={brand} content={content} />
      ) : kind === "STAT" ? (
        <Stat brand={brand} content={content} />
      ) : kind === "QUOTE" ? (
        <Quote brand={brand} content={content} />
      ) : (
        <Standard brand={brand} content={content} />
      )}
    </div>
  );
});
