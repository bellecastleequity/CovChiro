import "server-only";
import { DomainError } from "@cm/core";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, storageProvider } from "@cm/integrations";

/** Validates and stores an uploaded file; returns the private storage key. */
export async function saveUpload(file: FormDataEntryValue | null, prefix: string, opts: { required?: boolean; images?: boolean } = {}): Promise<string | null> {
  if (!(file instanceof File) || file.size === 0) {
    if (opts.required) throw new DomainError("VALIDATION", "Please attach a file.");
    return null;
  }
  const allowed = opts.images ? ALLOWED_UPLOAD_TYPES.filter((t) => t.startsWith("image/")) : ALLOWED_UPLOAD_TYPES;
  if (!allowed.includes(file.type)) throw new DomainError("VALIDATION", opts.images ? "Upload a JPG, PNG or WebP image." : "Upload a PDF or an image (JPG, PNG, WebP).");
  if (file.size > MAX_UPLOAD_BYTES) throw new DomainError("VALIDATION", "Files must be under 10 MB.");
  return storageProvider().put(prefix, Buffer.from(await file.arrayBuffer()), file.type);
}
