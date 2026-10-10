"use client";

// A Studio ad: the picture Higgsfield made, with the shop's own brand drawn on top in Kurdish —
// logo and name, a headline, the price and the delivery line. Rendered by the headless browser
// (src/app/studio-render) and shown as the preview, so what the merchant sees is what is posted.

import { useLayoutEffect, useRef, type CSSProperties } from "react";

import { BODY_FONT, HEADING_FONT, type Brand } from "@/lib/cards/brand";

export interface AdBrand extends Brand {
  tagline: string | null;
  deliveryNote: string | null;
  whatsapp: string | null;
}

export interface AdContent {
  photoSrc: string;
  headline: string;
  price: string | null;
}

const abs = (s: CSSProperties): CSSProperties => ({ position: "absolute", ...s });

/**
 * Shrinks the headline from `max` px until it is no taller than `room`, down to `min`, and marks
 * `data-overflow` ("1" when even `min` is too tall) for the renderer. The box grows with its text
 * and sits on the price, so it is measured against `room` rather than its own height: Kufi's
 * marks reach a little past the line box, which a fixed box would read as overflow.
 */
function useFitInto(text: string, max: number, min: number, room: number, font: string) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      let size = max;
      el.style.fontSize = `${size}px`;
      while (size > min && el.scrollHeight > room) {
        size -= 2;
        el.style.fontSize = `${size}px`;
      }
      el.dataset.overflow = el.scrollHeight > room ? "1" : "0";
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
  }, [text, max, min, room, font]);
  return ref;
}

export function StudioAd({ brand, content, width, height }: { brand: AdBrand; content: AdContent; width: number; height: number }) {
  const tall = height / width > 1.5;
  const headSize = tall ? 84 : 72;
  const font = `800 ${headSize}px/1.45 ${HEADING_FONT[brand.headingFont]}`;
  // Room for about two lines at full size; longer text shrinks into it.
  const room = Math.round(height * (tall ? 0.2 : 0.21));
  const head = useFitInto(content.headline, headSize, 40, room, font);
  const bottomBox = Math.round(height * (tall ? 0.34 : 0.4));
  const contact = [brand.deliveryNote?.trim(), brand.whatsapp?.trim()].filter(Boolean).join("  ·  ");

  return (
    <div style={{ position: "relative", width, height, overflow: "hidden", background: brand.primary }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={content.photoSrc} alt="" style={abs({ inset: 0, width: "100%", height: "100%", objectFit: "cover" })} />

      {/* the shop, top */}
      <div style={abs({ top: 0, right: 0, left: 0, height: 240, background: "linear-gradient(rgba(0,0,0,.5), transparent)" })} />
      <div dir="rtl" style={abs({ top: 48, right: 56, left: 56, display: "flex", alignItems: "center", gap: 20, color: "#fff" })}>
        {brand.logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logoSrc} alt="" style={{ height: 88, width: "auto", maxWidth: 280, objectFit: "contain" }} />
        ) : (
          <span style={{ width: 80, height: 80, borderRadius: 40, background: brand.accent, color: brand.primary, display: "grid", placeItems: "center", font: `800 40px ${HEADING_FONT[brand.headingFont]}` }}>
            {[...brand.pageName][0] ?? "G"}
          </span>
        )}
        <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <span style={{ font: `800 40px ${HEADING_FONT[brand.headingFont]}`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{brand.pageName}</span>
          {brand.tagline && <span style={{ font: `500 28px ${BODY_FONT}`, opacity: 0.9, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{brand.tagline}</span>}
        </span>
      </div>

      {/* the offer, bottom */}
      <div style={abs({ right: 0, left: 0, bottom: 0, height: bottomBox + 180, background: `linear-gradient(transparent, ${brand.primary}e6 42%, ${brand.primary})` })} />
      <div dir="rtl" style={abs({ right: 56, left: 56, bottom: contact ? 132 : 64, display: "flex", flexDirection: "column", gap: 24 })}>
        <div ref={head} style={{ overflowWrap: "anywhere", color: brand.text, font }}>
          {content.headline}
        </div>
        {content.price && (
          <div style={{ alignSelf: "flex-start", background: brand.accent, color: brand.primary, borderRadius: 18, padding: "14px 34px", font: `800 56px ${HEADING_FONT[brand.headingFont]}` }}>
            {content.price}
          </div>
        )}
      </div>
      {contact && (
        <div dir="rtl" style={abs({ right: 0, left: 0, bottom: 0, height: 100, background: brand.accent, color: brand.primary, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 48px", font: `700 34px ${BODY_FONT}`, whiteSpace: "nowrap", overflow: "hidden" })}>
          {contact}
        </div>
      )}
    </div>
  );
}
