"use client";

import { useEffect, useRef, useState } from "react";
import { Pipette } from "lucide-react";

import { dominantColors, readableOn, toHex } from "@/lib/cards/palette";

export type ColorSlot = "primary" | "accent" | "text";

const SLOT_LABEL: Record<ColorSlot, string> = { primary: "ڕەنگی سەرەکی", accent: "ڕەنگی دووەم", text: "ڕەنگی نووسین" };
const MAX_W = 520;

// The browser's own screen eyedropper (Chrome and Edge), where there is one.
type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };
const eyeDropper = (): EyeDropperCtor | null =>
  typeof window !== "undefined" && "EyeDropper" in window ? (window as unknown as { EyeDropper: EyeDropperCtor }).EyeDropper : null;

/**
 * Pick brand colours straight from the channel's own pictures: a reference
 * image (read in the browser only, never uploaded) or the uploaded logo.
 * Choose which colour to set, then click the image, or take one of the
 * image's main colours.
 */
export function ReferencePicker({
  logoSrc,
  values,
  onPick,
}: {
  logoSrc: string | null;
  values: Record<ColorSlot, string>;
  onPick: (slot: ColorSlot, hex: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [slot, setSlot] = useState<ColorSlot>("primary");
  const [palette, setPalette] = useState<string[]>([]);
  const [hover, setHover] = useState<{ x: number; y: number; hex: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canEyedrop, setCanEyedrop] = useState(false);
  useEffect(() => setCanEyedrop(!!eyeDropper()), []);

  // Draw the image and work out its main colours whenever it changes.
  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = canvas.current;
      if (!c) return;
      const scale = Math.min(1, MAX_W / img.naturalWidth);
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      try {
        setPalette(dominantColors(ctx.getImageData(0, 0, c.width, c.height).data));
        setError(null);
      } catch {
        setPalette([]);
        setError("ڕەنگەکانی ئەم وێنەیە ناخوێنرێنەوە. وێنەیەکی تر تاقی بکەرەوە.");
      }
    };
    img.onerror = () => setError("وێنەکە نەکرایەوە.");
    img.src = src;
  }, [src]);

  // Free a picked file's temporary address when it's replaced or the picker closes.
  useEffect(() => () => void (src?.startsWith("blob:") && URL.revokeObjectURL(src)), [src]);

  function colorAt(e: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>): { x: number; y: number; hex: string } | null {
    const c = canvas.current;
    const ctx = c?.getContext("2d", { willReadFrequently: true });
    if (!c || !ctx) return null;
    const rect = c.getBoundingClientRect();
    const px = Math.floor(((e.clientX - rect.left) / rect.width) * c.width);
    const py = Math.floor(((e.clientY - rect.top) / rect.height) * c.height);
    if (px < 0 || py < 0 || px >= c.width || py >= c.height) return null;
    try {
      const [r, g, b, a] = ctx.getImageData(px, py, 1, 1).data;
      if (a < 128) return null;
      return { x: e.clientX - rect.left, y: e.clientY - rect.top, hex: toHex(r, g, b) };
    } catch {
      return null;
    }
  }

  async function fromScreen() {
    const Ctor = eyeDropper();
    if (!Ctor) return;
    try {
      const { sRGBHex } = await new Ctor().open();
      onPick(slot, sRGBHex.toLowerCase());
    } catch {
      /* cancelled with Escape */
    }
  }

  return (
    <div className="gm-stack" style={{ gap: 10 }}>
      <div className="gm-row" style={{ gap: 8, flexWrap: "wrap" }}>
        <label className="gm-btn quiet small">
          وێنەی ڕیفرێنس
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setSrc(URL.createObjectURL(f));
              e.target.value = "";
            }}
          />
        </label>
        {logoSrc && (
          <button type="button" className="gm-btn quiet small" onClick={() => setSrc(logoSrc)}>
            لۆگۆکەم
          </button>
        )}
        {canEyedrop && (
          <button type="button" className="gm-btn quiet small" onClick={fromScreen}>
            <Pipette size={14} aria-hidden="true" /> لە شاشەوە
          </button>
        )}
      </div>

      <div className="gm-chips" role="radiogroup" aria-label="کام ڕەنگ دابنرێت">
        {(Object.keys(SLOT_LABEL) as ColorSlot[]).map((s) => (
          <button key={s} type="button" role="radio" aria-checked={slot === s} className="gm-chip" aria-pressed={slot === s} onClick={() => setSlot(s)}>
            <span
              aria-hidden="true"
              style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: values[s], border: "1px solid var(--line)", marginInlineEnd: 6, verticalAlign: "-1px" }}
            />
            {SLOT_LABEL[s]}
          </button>
        ))}
      </div>

      {src ? (
        <>
          <p className="gm-hint" style={{ margin: 0 }}>
            کلیک لەسەر هەر شوێنێکی وێنەکە بکە بۆ «{SLOT_LABEL[slot]}»، یان یەکێک لە ڕەنگە سەرەکییەکانی خوارەوە هەڵبژێرە.
          </p>
          <div style={{ position: "relative", maxWidth: MAX_W }}>
            <canvas
              ref={canvas}
              style={{ width: "100%", height: "auto", display: "block", borderRadius: 10, cursor: "crosshair", border: "1px solid var(--line)" }}
              onPointerMove={(e) => setHover(colorAt(e))}
              onPointerLeave={() => setHover(null)}
              onClick={(e) => {
                const c = colorAt(e);
                if (c) onPick(slot, c.hex);
              }}
            />
            {hover && (
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: hover.x + 14,
                  top: hover.y + 14,
                  pointerEvents: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 8px",
                  borderRadius: 8,
                  background: "var(--surface)",
                  border: "1px solid var(--line)",
                  boxShadow: "0 4px 14px rgb(0 0 0 / 0.18)",
                  direction: "ltr",
                  fontSize: 12,
                }}
              >
                <span style={{ width: 18, height: 18, borderRadius: 4, background: hover.hex, border: "1px solid var(--line)" }} />
                {hover.hex}
              </div>
            )}
          </div>
          {palette.length > 0 && (
            <div className="gm-row" style={{ gap: 8, flexWrap: "wrap" }} aria-label="ڕەنگە سەرەکییەکانی وێنەکە">
              {palette.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  title={hex}
                  aria-label={`${hex} بۆ ${SLOT_LABEL[slot]}`}
                  onClick={() => onPick(slot, hex)}
                  style={{ width: 34, height: 34, borderRadius: 8, background: hex, border: "2px solid var(--line)", cursor: "pointer" }}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="gm-hint" style={{ margin: 0 }}>
          وێنەیەکی کەناڵەکەت یان لۆگۆکەت بکەرەوە و ڕەنگەکان ڕاستەوخۆ لێیەوە هەڵبگرە. وێنەکە بار ناکرێت، تەنها لە وێبگەڕەکەتدا دەخوێنرێتەوە.
        </p>
      )}

      <button type="button" className="gm-linkbtn gm-link" style={{ alignSelf: "flex-start", fontSize: 12.5 }} onClick={() => onPick("text", readableOn(values.primary))}>
        ڕەنگی نووسینی گونجاو بۆ ڕەنگی سەرەکی
      </button>
      {error && <p className="gm-err" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
}
