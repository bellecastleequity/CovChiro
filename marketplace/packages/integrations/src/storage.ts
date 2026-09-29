import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "@cm/config";

/**
 * Private document storage (licenses, malpractice certificates, receipts).
 * Production: a private GCS bucket, read through short-lived signed URLs.
 * Development: files under UPLOAD_DIR, served only through an authorised
 * route. Keys never contain user-supplied names.
 */

export interface Storage {
  name: "gcs" | "local";
  put(prefix: string, data: Buffer, contentType: string): Promise<string>;
  read(key: string): Promise<{ data: Buffer; contentType: string } | null>;
  /** Signed URL (GCS) or null when the caller should stream via read(). */
  signedUrl(key: string, minutes?: number): Promise<string | null>;
}

const EXT: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
export const ALLOWED_UPLOAD_TYPES = Object.keys(EXT);
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

class LocalStorage implements Storage {
  name = "local" as const;
  constructor(private root: string) {}
  async put(prefix: string, data: Buffer, contentType: string) {
    const key = `${prefix.replace(/[^a-z0-9/_-]/gi, "")}/${randomUUID()}.${EXT[contentType] ?? "bin"}`;
    const file = path.join(this.root, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
    await writeFile(file + ".type", contentType);
    return key;
  }
  async read(key: string) {
    if (key.includes("..")) return null;
    try {
      const file = path.join(this.root, key);
      return { data: await readFile(file), contentType: (await readFile(file + ".type", "utf8").catch(() => "application/octet-stream")) as string };
    } catch {
      return null;
    }
  }
  async signedUrl() {
    return null;
  }
}

class GcsStorage implements Storage {
  name = "gcs" as const;
  private bucketP: Promise<any>;
  constructor(bucket: string, credentialsJson?: string) {
    this.bucketP = (async () => {
      // Optional dependency: only loaded when GCS is configured.
      const mod = "@google-cloud/storage";
      const { Storage: GStorage } = await import(/* webpackIgnore: true */ mod);
      const client = new GStorage(credentialsJson ? { credentials: JSON.parse(credentialsJson) } : {});
      return client.bucket(bucket);
    })();
  }
  async put(prefix: string, data: Buffer, contentType: string) {
    const key = `${prefix.replace(/[^a-z0-9/_-]/gi, "")}/${randomUUID()}.${EXT[contentType] ?? "bin"}`;
    await (await this.bucketP).file(key).save(data, { contentType, resumable: false, private: true });
    return key;
  }
  async read(key: string) {
    const f = (await this.bucketP).file(key);
    const [data] = await f.download();
    const [meta] = await f.getMetadata();
    return { data, contentType: meta.contentType ?? "application/octet-stream" };
  }
  async signedUrl(key: string, minutes = 10) {
    const [url] = await (await this.bucketP).file(key).getSignedUrl({ action: "read", expires: Date.now() + minutes * 60_000 });
    return url;
  }
}

let storage: Storage | null = null;
export function storageProvider(): Storage {
  if (!storage) {
    const e = env();
    storage = e.GCS_BUCKET ? new GcsStorage(e.GCS_BUCKET, e.GCS_BUCKET_CREDENTIALS) : new LocalStorage(path.resolve(e.UPLOAD_DIR));
  }
  return storage;
}
