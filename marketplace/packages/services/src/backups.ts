import { env } from "@cm/config";
import { DomainError } from "@cm/core";
import { backupKey, prisma, sealBackup } from "@cm/db";
import { neonApi, storageProvider as storage } from "@cm/integrations";
import { audit, clock, getSettings, requireAdmin, SYSTEM, type Actor } from "./context";
import { notifyAdmins } from "./notify";

/**
 * Backups and restore (Admin → Backups).
 *  1. Nightly export (job dbBackup): every table, gzipped and encrypted (BACKUP_KEY or
 *     SESSION_SECRET), kept in private storage off Neon: backups.keepDaily / keepWeekly (Sundays)
 *     / keepMonthly (1st). Downloadable; restored with packages/db/scripts/restore-backup.ts.
 *  2. Neon restore points (needs NEON_API_KEY + NEON_PROJECT_ID): a branch copied from production,
 *     made nightly and on demand ("before I install a release"); oldest pruned past
 *     backups.keepRestorePoints.
 *  3. Restore: rewind production to a time inside Neon's history window, or to a restore point.
 *     Neon keeps the current state as a branch first, so every restore can itself be undone.
 */

export function backupKeyBuffer() {
  const e = env();
  return backupKey(e.BACKUP_KEY || e.SESSION_SECRET || "dev-secret");
}

const SKIP = new Set(["spatial_ref_sys"]);
const BATCH = 2000;
const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

/** Every row of every table as NDJSON (keyset-paged by id where there is one). */
async function exportRows() {
  const tables = (await prisma.$queryRaw<{ t: string }[]>`SELECT table_name::text AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`).map((r) => r.t).filter((t) => !SKIP.has(t));
  const chunks: Buffer[] = [];
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const hasId = (await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${t} AND column_name = 'id'`)[0].n > 0;
    let n = 0;
    if (hasId) {
      let after = "";
      for (;;) {
        const rows = await prisma.$queryRawUnsafe<{ j: string; k: string }[]>(`SELECT row_to_json(x)::text AS j, x."id"::text AS k FROM ${q(t)} x WHERE x."id"::text > $1 ORDER BY x."id"::text LIMIT ${BATCH}`, after);
        for (const r of rows) chunks.push(Buffer.from(`{"t":${JSON.stringify(t)},"r":${r.j}}\n`));
        n += rows.length;
        if (rows.length < BATCH) break;
        after = rows[rows.length - 1].k;
      }
    } else {
      const rows = await prisma.$queryRawUnsafe<{ j: string }[]>(`SELECT row_to_json(x)::text AS j FROM ${q(t)} x`);
      for (const r of rows) chunks.push(Buffer.from(`{"t":${JSON.stringify(t)},"r":${r.j}}\n`));
      n = rows.length;
    }
    counts[t] = n;
  }
  const migrations = (await prisma.$queryRaw<{ m: string }[]>`SELECT migration_name::text AS m FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name`.catch(() => [])).map((r) => r.m);
  chunks.push(Buffer.from(`${JSON.stringify({ t: "__meta", r: { createdAt: clock.now().toISOString(), migrations, counts } })}\n`));
  return { ndjson: Buffer.concat(chunks), counts };
}

function tierFor(now: Date): "monthly" | "weekly" | "daily" {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  return et.getDate() === 1 ? "monthly" : et.getDay() === 0 ? "weekly" : "daily";
}

/** Export the database now (nightly job or "Back up now"). */
export async function exportBackup(actor: Actor = SYSTEM, opts: { tier?: string; label?: string } = {}) {
  if (actor.role !== "SYSTEM") requireAdmin(actor);
  const now = clock.now();
  const run = await prisma.backupRun.create({ data: { kind: "EXPORT", tier: opts.tier ?? (actor.role === "SYSTEM" ? tierFor(now) : "manual"), label: opts.label ?? null, createdById: actor.userId } });
  try {
    const { ndjson, counts } = await exportRows();
    const file = sealBackup(ndjson, backupKeyBuffer());
    const key = await storage().put("backups", file, "application/octet-stream");
    const rowCount = Object.values(counts).reduce((a, b) => a + b, 0);
    const done = await prisma.backupRun.update({ where: { id: run.id }, data: { status: "DONE", storageKey: key, sizeBytes: file.length, rowCount, tables: counts, finishedAt: clock.now() } });
    if (actor.role !== "SYSTEM") await audit(prisma, actor, "backup.export", "BackupRun", run.id, null, { sizeBytes: file.length, rowCount });
    return done;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await prisma.backupRun.update({ where: { id: run.id }, data: { status: "FAILED", error: error.slice(0, 500), finishedAt: clock.now() } });
    await notifyAdmins(prisma, { template: "backup_failed", title: "Database backup failed", body: error.slice(0, 300), link: "/admin/backups" }).catch(() => undefined);
    throw e;
  }
}

/** Keep the newest N of each tier; older files are deleted from storage. */
export async function pruneExports() {
  const s = await getSettings();
  const keep: Record<string, number> = { daily: s["backups.keepDaily"], weekly: s["backups.keepWeekly"], monthly: s["backups.keepMonthly"], manual: s["backups.keepManual"] };
  let removed = 0;
  for (const [tier, n] of Object.entries(keep)) {
    const old = await prisma.backupRun.findMany({ where: { kind: "EXPORT", tier, status: "DONE" }, orderBy: { startedAt: "desc" }, skip: n });
    for (const r of old) {
      if (r.storageKey) await storage().remove(r.storageKey).catch((e) => console.error("backup delete failed", e));
      await prisma.backupRun.update({ where: { id: r.id }, data: { status: "DELETED", storageKey: null } });
      removed++;
    }
  }
  return removed;
}

// ---------------- Neon restore points ----------------

const stamp = (d: Date) => d.toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/^(\d{8})(\d{4})$/, "$1-$2");

export async function createRestorePoint(actor: Actor = SYSTEM, label?: string) {
  if (actor.role !== "SYSTEM") requireAdmin(actor);
  const neon = neonApi();
  if (!neon) throw new DomainError("CONFLICT", "Connect Neon first (NEON_API_KEY and NEON_PROJECT_ID).");
  const now = clock.now();
  const name = `restore-point-${stamp(now)}${label ? `-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}` : ""}`;
  const run = await prisma.backupRun.create({ data: { kind: "SNAPSHOT", label: label?.slice(0, 120) || null, tier: actor.role === "SYSTEM" ? "daily" : "manual", createdById: actor.userId } });
  try {
    const b = await neon.createBranch(name);
    const done = await prisma.backupRun.update({ where: { id: run.id }, data: { status: "DONE", neonBranchId: b.id, finishedAt: clock.now() } });
    if (actor.role !== "SYSTEM") await audit(prisma, actor, "backup.restore_point", "BackupRun", run.id, null, { branch: name });
    return done;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await prisma.backupRun.update({ where: { id: run.id }, data: { status: "FAILED", error: error.slice(0, 500), finishedAt: clock.now() } });
    throw new DomainError("CONFLICT", error);
  }
}

/** Delete restore points beyond backups.keepRestorePoints (oldest first). Branches made by restores are kept. */
export async function pruneRestorePoints() {
  const neon = neonApi();
  if (!neon) return 0;
  const s = await getSettings();
  const old = await prisma.backupRun.findMany({ where: { kind: "SNAPSHOT", status: "DONE" }, orderBy: { startedAt: "desc" }, skip: s["backups.keepRestorePoints"] });
  let removed = 0;
  for (const r of old) {
    if (r.neonBranchId) await neon.deleteBranch(r.neonBranchId).catch((e) => console.error("restore point delete failed", e));
    await prisma.backupRun.update({ where: { id: r.id }, data: { status: "DELETED" } });
    removed++;
  }
  return removed;
}

/**
 * Rewind production to a moment (`at`) or to a restore point. The confirmation must be typed.
 * Neon keeps today's data as a branch named before-restore-…, so this can be undone the same way.
 */
export async function restoreDatabase(actor: Actor, input: { at?: Date | null; restorePointId?: string | null; confirm: string }) {
  requireAdmin(actor);
  if (input.confirm.trim().toUpperCase() !== "RESTORE") throw new DomainError("VALIDATION", "Type RESTORE to confirm.");
  const neon = neonApi();
  if (!neon) throw new DomainError("CONFLICT", "Connect Neon first (NEON_API_KEY and NEON_PROJECT_ID), or restore from the Neon console.");
  const now = clock.now();
  let sourceBranchId: string;
  let at: Date | null = null;
  if (input.restorePointId) {
    const rp = await prisma.backupRun.findFirst({ where: { id: input.restorePointId, kind: "SNAPSHOT", status: "DONE" } });
    if (!rp?.neonBranchId) throw new DomainError("NOT_FOUND", "That restore point no longer exists.");
    sourceBranchId = rp.neonBranchId;
    at = rp.startedAt;
  } else {
    if (!input.at || Number.isNaN(+input.at)) throw new DomainError("VALIDATION", "Choose the date and time to go back to.");
    if (+input.at >= +now) throw new DomainError("VALIDATION", "Pick a time in the past.");
    const { historyHours } = await neon.project();
    if (historyHours && +now - +input.at > historyHours * 3_600_000) throw new DomainError("VALIDATION", `Neon keeps ${historyHours} hours of history on your plan; pick a later time or use a restore point.`);
    sourceBranchId = await neon.productionBranchId();
    at = input.at;
  }
  const preserveAs = `before-restore-${stamp(now)}`;
  // Recorded first: after the restore this row only exists if the restore point is older than it.
  await audit(prisma, actor, "backup.restore", "Database", "production", null, { at, restorePointId: input.restorePointId ?? null, preserveAs });
  await neon.restore({ sourceBranchId, at: input.restorePointId ? null : at, preserveAs });
  // After a successful restore the database is the old one; write the record there too (best effort).
  await prisma.backupRun
    .create({ data: { kind: "RESTORE", status: "DONE", restoredTo: at, label: `Restored to ${at?.toISOString() ?? "restore point"}; previous state kept as ${preserveAs}`, createdById: actor.userId, finishedAt: clock.now() } })
    .catch(() => undefined);
  return { preserveAs, at };
}

// ---------------- views & job ----------------

export async function backupsOverview(actor: Actor) {
  requireAdmin(actor);
  const neon = neonApi();
  const [exports, points, restores] = await Promise.all([
    prisma.backupRun.findMany({ where: { kind: "EXPORT", status: { not: "DELETED" } }, orderBy: { startedAt: "desc" }, take: 60 }),
    prisma.backupRun.findMany({ where: { kind: "SNAPSHOT", status: { not: "DELETED" } }, orderBy: { startedAt: "desc" }, take: 30 }),
    prisma.backupRun.findMany({ where: { kind: "RESTORE" }, orderBy: { startedAt: "desc" }, take: 10 }),
  ]);
  let neonInfo: { connected: boolean; historyHours: number | null; error: string | null; project: string | null } = { connected: false, historyHours: null, error: null, project: null };
  if (neon) {
    try {
      const p = await neon.project();
      neonInfo = { connected: true, historyHours: p.historyHours, error: null, project: p.name };
    } catch (e) {
      neonInfo = { connected: false, historyHours: null, error: e instanceof Error ? e.message : String(e), project: null };
    }
  }
  return { exports, points, restores, neon: neonInfo, keyFromSessionSecret: !env().BACKUP_KEY };
}

export async function backupFile(actor: Actor, id: string) {
  requireAdmin(actor);
  const r = await prisma.backupRun.findFirst({ where: { id, kind: "EXPORT", status: "DONE" } });
  if (!r?.storageKey) throw new DomainError("NOT_FOUND", "That backup file is no longer kept.");
  const f = await storage().read(r.storageKey);
  if (!f) throw new DomainError("NOT_FOUND", "The backup file is missing from storage.");
  await audit(prisma, actor, "backup.download", "BackupRun", id, null, null);
  return { data: f.data, name: `coverageoncall-backup-${stamp(r.startedAt)}.cmbk` };
}

/** Job (nightly): export, restore point, prune. A failure emails the admins (export) and never stops the rest. */
export async function nightlyBackup() {
  const s = await getSettings();
  if (!s["backups.enabled"]) return "off";
  const out: Record<string, unknown> = {};
  out.export = await exportBackup(SYSTEM).then((r) => ({ rows: r.rowCount, bytes: r.sizeBytes })).catch((e) => ({ error: String(e) }));
  if (neonApi()) out.restorePoint = await createRestorePoint(SYSTEM).then((r) => r.neonBranchId).catch((e) => ({ error: String(e) }));
  out.prunedExports = await pruneExports();
  out.prunedPoints = await pruneRestorePoints();
  // Alert if the last good export is more than two days old (e.g. the job keeps failing).
  const last = await prisma.backupRun.findFirst({ where: { kind: "EXPORT", status: "DONE" }, orderBy: { startedAt: "desc" } });
  if (!last || +clock.now() - +last.startedAt > 48 * 3_600_000) {
    await notifyAdmins(prisma, { template: "backup_stale", title: "No database backup in 2 days", body: "Check Admin → Backups.", link: "/admin/backups" }).catch(() => undefined);
  }
  return out;
}
