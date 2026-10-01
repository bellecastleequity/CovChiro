/**
 * Restore a nightly export (Admin → Backups → download) into an EMPTY database.
 *
 *   1. In Neon: create a new branch (or database), and run the update SQL files on it
 *      (database-setup.sql, then each update-NNN), so it has the same tables.
 *   2. pnpm --filter @cm/db exec tsx scripts/restore-backup.ts <file.cmbk>
 *        with TARGET_DATABASE_URL=<the new branch's connection string>
 *        and BACKUP_KEY=<same as the site>  (or SESSION_SECRET=<same as the site> if BACKUP_KEY was never set)
 *   3. Point the site's DATABASE_URL at the new branch (or use Neon's restore to swap it in).
 */
import { readFileSync } from "node:fs";
import { backupKey } from "../src/backup-codec";
import { restoreBackupInto } from "../src/backup-restore";

const file = process.argv[2];
const url = process.env.TARGET_DATABASE_URL;
const secret = process.env.BACKUP_KEY || process.env.SESSION_SECRET;
if (!file || !url || !secret) {
  console.error("Usage: TARGET_DATABASE_URL=… BACKUP_KEY=… tsx scripts/restore-backup.ts <backup file>");
  process.exit(1);
}
restoreBackupInto(url, readFileSync(file), backupKey(secret), { force: process.argv.includes("--force"), log: (s) => console.log(s) })
  .then((r) => console.log(`Restored ${r.rows} rows into ${r.tables} tables from the backup made ${r.createdAt}.`))
  .catch((e) => {
    console.error(`Restore failed, nothing was changed: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
