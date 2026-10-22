/**
 * Shrinks a photo in the browser before it's uploaded (owner, Oct 2026: phone photos of 3-10 MB made
 * the small headshots take over a minute to load). The server has no image library, so the browser
 * does the work: a display copy (longest side `max` px) and a small thumbnail for lists and headers.
 * Transparent PNG logos stay PNG; everything else becomes JPEG.
 */
export async function resizeImage(file: Blob, max: number, keepPng = false): Promise<Blob> {
  const bitmap = await loadImage(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const png = keepPng && file.type === "image/png";
  if (!png) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't shrink the photo"))), png ? "image/png" : "image/jpeg", 0.85));
}

async function loadImage(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap applies the phone's EXIF rotation, so portraits stay upright.
  if ("createImageBitmap" in window) {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions); } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const PHOTO_MAX = 1024;
export const THUMB_MAX = 256;
/** Photos of documents (licenses, certificates, receipts): large enough to read every line. */
export const DOC_MAX = 2000;
export const LOCATION_MAX = 1600;
