import { execFileSync, execSync } from "node:child_process";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { openBackup, parseBackup, prisma } from "@cm/db";
import { restoreBackupInto } from "../../packages/db/src/backup-restore";
import { FakeNeon, setNeonApi, storageProvider } from "@cm/integrations";
import { backups } from "@cm/services";
import { makeClinic, makeProvider } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };
const testUrl = new URL(process.env.TEST_DATABASE_URL ?? "postgresql://cm:cm@localhost:5432/coverage_test");
const restoreUrl = new URL(testUrl);
restoreUrl.pathname = "/coverage_restore_test";
const adminUrl = new URL(testUrl);
adminUrl.pathname = "/postgres";
const psql = (sql: string) => execSync(`psql "${adminUrl}" -v ON_ERROR_STOP=1 -q -c "${sql}"`, { stdio: "pipe" });

afterEach(() => setNeonApi(undefined));
afterAll(() => {
  try {
    psql("DROP DATABASE IF EXISTS coverage_restore_test WITH (FORCE)");
  } catch {
    /* ignore */
  }
});

describe("database export and restore", () => {
  it("exports every table encrypted, and restores it into an empty migrated database", async () => {
    await makeProvider();
    await makeClinic();
    const run = await backups.exportBackup(admin, { label: "test" });
    expect(run).toMatchObject({ status: "DONE", tier: "manual" });
    expect(run.rowCount).toBeGreaterThan(10);

    const file = (await storageProvider().read(run.storageKey!))!.data;
    expect(file.subarray(0, 5).toString()).toBe("CMBK1");
    expect(file.includes(Buffer.from("PLATFORM_ADMIN"))).toBe(false); // encrypted
    const { meta, tables } = parseBackup(openBackup(file, backups.backupKeyBuffer()));
    expect(meta!.migrations).toContain("0020_backups");
    expect(tables.get("Provider")!.length).toBe(await prisma.provider.count());
    expect(() => openBackup(file, Buffer.alloc(32, 1))).toThrow(/decrypt/);

    psql("DROP DATABASE IF EXISTS coverage_restore_test WITH (FORCE)");
    psql("CREATE DATABASE coverage_restore_test");
    execSync("npx prisma migrate deploy", { cwd: path.resolve(__dirname, "../../packages/db"), env: { ...process.env, DATABASE_URL: restoreUrl.toString() }, stdio: "pipe" });
    const r = await restoreBackupInto(restoreUrl.toString(), file, backups.backupKeyBuffer());
    expect(r.rows).toBeGreaterThan(10);

    const count = (sql: string) => Number(execFileSync("psql", [restoreUrl.toString(), "-tAc", sql]).toString().trim());
    for (const t of ["Provider", "ClinicOrg", "License", "Setting", "Assignment", "PromoCode"]) {
      expect(count(`SELECT count(*) FROM "${t}"`), t).toBe((tables.get(t) ?? []).length);
    }
    // Triggers are back on after the load.
    expect(count("SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'D'")).toBe(0);
    // A second load is refused (not empty) and changes nothing.
    await expect(restoreBackupInto(restoreUrl.toString(), file, backups.backupKeyBuffer())).rejects.toThrow(/isn't empty/);
  }, 120_000);

  it("keeps the newest exports per tier and deletes older files", async () => {
    await prisma.backupRun.deleteMany({ where: { kind: "EXPORT" } });
    for (let i = 0; i < 5; i++) await backups.exportBackup(admin);
    expect(await backups.pruneExports()).toBe(2); // keeps the newest 3 manual (default)
    const kept = await prisma.backupRun.findMany({ where: { kind: "EXPORT", status: "DONE" } });
    expect(kept).toHaveLength(3);
    const gone = await prisma.backupRun.findFirstOrThrow({ where: { kind: "EXPORT", status: "DELETED" } });
    expect(gone.storageKey).toBeNull();
  }, 120_000);
});

describe("Neon restore points and restore", () => {
  it("makes restore points, prunes old ones, and restores with the current state kept", async () => {
    const neon = new FakeNeon();
    setNeonApi(neon);
    await prisma.backupRun.deleteMany({ where: { kind: { in: ["SNAPSHOT", "RESTORE"] } } });
    for (let i = 0; i < 7; i++) await backups.createRestorePoint(admin, i === 0 ? "before install" : undefined);
    expect(await backups.pruneRestorePoints()).toBe(2);
    expect(neon.list.filter((b) => b.name.startsWith("restore-point-"))).toHaveLength(5);

    await expect(backups.restoreDatabase(admin, { at: new Date(Date.now() - 3_600_000), confirm: "yes" })).rejects.toThrow(/Type RESTORE/);
    await expect(backups.restoreDatabase(admin, { at: new Date(Date.now() + 3_600_000), confirm: "RESTORE" })).rejects.toThrow(/past/);
    await expect(backups.restoreDatabase(admin, { at: new Date(Date.now() - 200 * 3_600_000), confirm: "RESTORE" })).rejects.toThrow(/168 hours/);

    const r = await backups.restoreDatabase(admin, { at: new Date(Date.now() - 3_600_000), confirm: "restore" });
    expect(neon.restores.at(-1)).toMatchObject({ sourceBranchId: "br-main", preserveAs: r.preserveAs });
    expect(neon.list.some((b) => b.name === r.preserveAs)).toBe(true);

    const point = await prisma.backupRun.findFirstOrThrow({ where: { kind: "SNAPSHOT", status: "DONE" }, orderBy: { startedAt: "desc" } });
    await backups.restoreDatabase(admin, { restorePointId: point.id, confirm: "RESTORE" });
    expect(neon.restores.at(-1)).toMatchObject({ sourceBranchId: point.neonBranchId, at: null });
  });

  it("explains how to connect Neon when it isn't configured", async () => {
    setNeonApi(null);
    await expect(backups.createRestorePoint(admin)).rejects.toThrow(/NEON_API_KEY/);
    expect((await backups.backupsOverview(admin)).neon.connected).toBe(false);
  });
});

describe("nightly backup that never finished", () => {
  it("marks a stuck run as failed and the morning retry makes a new backup", async () => {
    await prisma.backupRun.deleteMany({ where: { kind: "EXPORT" } });
    const stuck = await prisma.backupRun.create({ data: { kind: "EXPORT", tier: "daily", startedAt: new Date(Date.now() - 2 * 3_600_000) } });
    const r = (await backups.retryNightlyBackup()) as { interrupted: number; retried: boolean };
    expect(r).toMatchObject({ interrupted: 1, retried: true });
    expect(await prisma.backupRun.findUniqueOrThrow({ where: { id: stuck.id } })).toMatchObject({ status: "FAILED", error: expect.stringContaining("Didn't finish") });
    expect(await prisma.backupRun.count({ where: { kind: "EXPORT", status: "DONE" } })).toBe(1);
    // A backup finished recently: the second retry of the morning does nothing.
    expect(await backups.retryNightlyBackup()).toMatchObject({ retried: false });
  });

  it("runs the retry at 4:40 and 6:40 AM Eastern only", async () => {
    const { jobsDueAt } = await import("@cm/services");
    const at = (iso: string) => jobsDueAt(new Date(iso)).some((j) => j.name === "dbBackupRetry");
    expect(at("2026-10-13T08:40:00Z")).toBe(true); // 4:40 EDT
    expect(at("2026-10-13T10:40:00Z")).toBe(true); // 6:40 EDT
    expect(at("2026-10-13T09:40:00Z")).toBe(false);
    expect(jobsDueAt(new Date("2026-10-13T07:10:00Z")).some((j) => j.name === "dbBackup")).toBe(true); // 3:10 EDT still works
  });
});
