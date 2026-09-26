// Instagram and TikTok photo posts accept only JPEG (TikTok also accepts
// WebP). PNG/WebP uploads are converted here, client-side, before upload.

/**
 * Redraw an image file as JPEG, painting transparent pixels white first
 * (JPEG has no alpha channel). Keeps the original pixel dimensions.
 */
export async function imageToJpeg(file: File, quality = 0.92): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("کانڤاس بەردەست نییە.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error("گۆڕینی وێنە بۆ JPEG سەرکەوتوو نەبوو.");
    const name = file.name.replace(/\.[^./\\]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}
