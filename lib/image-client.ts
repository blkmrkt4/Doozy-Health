// Client-side image normalisation for scan uploads.
//
// Vision providers (OpenAI / Anthropic / Google via OpenRouter) reject HEIC/HEIF
// — the DEFAULT iPhone photo format — with an "image_parse_error" ("Could not
// process image"). So before upload we re-encode any picked photo to a
// downscaled JPEG in the browser (iOS decodes HEIC natively when we draw it to a
// canvas), which also keeps us under provider per-image size limits. If anything
// goes wrong we return the original file untouched, so JPEG/PNG always still
// work and nothing is ever blocked by this step.

const MAX_DIM = 1600; // longest side, px — plenty for label OCR, well under limits
const JPEG_QUALITY = 0.85;

async function decode(
  file: File
): Promise<{ source: CanvasImageSource; w: number; h: number } | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      return { source: bmp, w: bmp.width, h: bmp.height };
    } catch {
      // HEIC can fail here on non-Safari browsers — fall through to <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
    return { source: img, w: img.naturalWidth, h: img.naturalHeight };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Re-encode a picked photo to a downscaled JPEG suitable for the vision LLM.
 * Returns the original file unchanged if decoding/encoding isn't possible.
 */
export async function toUploadJpeg(file: File): Promise<File> {
  try {
    const decoded = await decode(file);
    if (!decoded || !decoded.w || !decoded.h) return file;

    const scale = Math.min(1, MAX_DIM / Math.max(decoded.w, decoded.h));
    const w = Math.max(1, Math.round(decoded.w * scale));
    const h = Math.max(1, Math.round(decoded.h * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(decoded.source, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
    );
    if (!blob || blob.size === 0) return file;

    const name = `${file.name.replace(/\.[^.]*$/, "")}.jpg`;
    return new File([blob], name, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}
