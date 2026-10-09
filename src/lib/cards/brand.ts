export interface Brand {
  pageName: string;
  logoSrc: string | null;
  primary: string;
  accent: string;
  text: string;
  headingFont: "kufi" | "sans";
  /** The outlet's own PNG frame; when set, every card is the story photo behind it. */
  frameSrc: string | null;
  frameText: FrameText;
}

/** Where the headline sits on an outlet's frame. */
export const FRAME_TEXT = ["top", "middle", "bottom"] as const;
export type FrameText = (typeof FRAME_TEXT)[number];
export const isFrameText = (v: unknown): v is FrameText => typeof v === "string" && (FRAME_TEXT as readonly string[]).includes(v);

export const HEADING_FONT = {
  kufi: "var(--gm-kufi), var(--gm-sans), sans-serif",
  sans: "var(--gm-sans), sans-serif",
} as const;
export const BODY_FONT = "var(--gm-sans), sans-serif";

/**
 * Uploaded files are shown through our own /m/ proxy: same origin, so the
 * browser can paint them into the PNG without cross-origin taint.
 */
export function mediaSrc(pathname: string | null | undefined): string | null {
  return pathname ? `/m/${pathname}` : null;
}

export function brandFrom(
  kit: { logoPath: string | null; primary: string; accent: string; text: string; headingFont: string; framePath?: string | null; frameText?: string | null } | null,
  pageName: string,
): Brand {
  return {
    pageName,
    logoSrc: mediaSrc(kit?.logoPath),
    primary: kit?.primary ?? "#0B2545",
    accent: kit?.accent ?? "#E0A526",
    text: kit?.text ?? "#FFFFFF",
    headingFont: kit?.headingFont === "sans" ? "sans" : "kufi",
    frameSrc: mediaSrc(kit?.framePath),
    frameText: isFrameText(kit?.frameText) ? kit.frameText : "bottom",
  };
}
