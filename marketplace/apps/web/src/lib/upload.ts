import "server-only";
import { DomainError } from "@cm/core";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, storageProvider, thumbKey } from "@cm/integrations";

/** Validates and stores an uploaded file; returns the private storage key. */
export async function saveUpload(file: FormDataEntryValue | null, prefix: string, opts: { required?: boolean; images?: boolean; thumb?: FormDataEntryValue | null } = {}): Promise<string | null> {
  if (!(file instanceof File) || file.size === 0) {
    if (opts.required) throw new DomainError("VALIDATION", "Please attach a file.");
    return null;
  }
  const allowed = opts.images ? ALLOWED_UPLOAD_TYPES.filter((t) => t.startsWith("image/")) : ALLOWED_UPLOAD_TYPES;
  if (!allowed.includes(file.type)) throw new DomainError("VALIDATION", opts.images ? "Upload a JPG, PNG or WebP image." : "Upload a PDF or an image (JPG, PNG, WebP).");
  if (file.size > MAX_UPLOAD_BYTES) throw new DomainError("VALIDATION", "Files must be under 10 MB.");
  const key = await storageProvider().put(prefix, Buffer.from(await file.arrayBuffer()), file.type);
  // The small copy PhotoInput made in the browser (lists and headers load this instead of the photo).
  const t = opts.thumb;
  if (t instanceof File && t.size > 0 && t.size <= 512 * 1024 && ["image/jpeg", "image/png", "image/webp"].includes(t.type)) {
    await storageProvider().putAt(thumbKey(key), Buffer.from(await t.arrayBuffer()), t.type).catch(() => undefined);
  }
  return key;
}
