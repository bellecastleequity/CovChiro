import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

/**
 * Database export file format (nightly backups):
 *   "CMBK1" | iv (12) | auth tag (16) | AES-256-GCM( gzip( NDJSON ) )
 * Each NDJSON line is {"t": "<table>", "r": <row as JSON>}; the last line is
 * {"t": "__meta", "r": {createdAt, migrations, counts}}. The key is BACKUP_KEY, or derived from
 * SESSION_SECRET. Restore with packages/db/scripts/restore-backup.ts into an empty, migrated database.
 */
const MAGIC = Buffer.from("CMBK1");

export function backupKey(secret: string): Buffer {
  return createHash("sha256").update(`cm-backup:${secret}`).digest();
}

export function sealBackup(ndjson: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(gzipSync(ndjson, { level: 9 })), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}

export function openBackup(file: Buffer, key: Buffer): Buffer {
  if (!file.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Not a CoverageOnCall backup file.");
  const iv = file.subarray(5, 17);
  const tag = file.subarray(17, 33);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  try {
    return gunzipSync(Buffer.concat([d.update(file.subarray(33)), d.final()]));
  } catch {
    throw new Error("Couldn't decrypt the backup: wrong BACKUP_KEY / SESSION_SECRET, or the file is damaged.");
  }
}

export interface BackupContents {
  meta: { createdAt: string; migrations: string[]; counts: Record<string, number> } | null;
  tables: Map<string, unknown[]>;
}

export function parseBackup(ndjson: Buffer): BackupContents {
  const tables = new Map<string, unknown[]>();
  let meta: BackupContents["meta"] = null;
  for (const line of ndjson.toString("utf8").split("\n")) {
    if (!line) continue;
    const { t, r } = JSON.parse(line) as { t: string; r: unknown };
    if (t === "__meta") meta = r as BackupContents["meta"];
    else (tables.get(t) ?? tables.set(t, []).get(t)!).push(r);
  }
  return { meta, tables };
}
