/// <reference path="./pg-shim.d.ts" />
import pg from "pg";
import { openBackup, parseBackup } from "./backup-codec";

/**
 * Load a nightly export into an EMPTY database that already has the same migrations applied
 * (e.g. a new Neon branch: create it, run the update SQL files, then this). Rows are inserted
 * parent tables first; self-references are filled in afterwards; the platform's own triggers
 * (eligibility checks etc.) are paused during the load because the data already passed them.
 * Everything happens in one transaction: it either all loads or nothing changes.
 */
export async function restoreBackupInto(databaseUrl: string, file: Buffer, key: Buffer, opts: { force?: boolean; log?: (s: string) => void } = {}) {
  const log = opts.log ?? (() => undefined);
  const { meta, tables } = parseBackup(openBackup(file, key));
  if (!meta) throw new Error("The backup has no summary line; it may be incomplete.");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
  try {
    const applied = new Set((await client.query<{ m: string }>(`SELECT migration_name AS m FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`)).rows.map((r) => r.m));
    const missing = meta.migrations.filter((m) => !applied.has(m));
    if (missing.length) throw new Error(`The target database is missing migrations: ${missing.join(", ")}. Run the update SQL files first.`);

    const existing = (await client.query<{ t: string }>(`SELECT table_name::text AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`)).rows.map((r) => r.t);
    const names = [...tables.keys()].filter((t) => t !== "_prisma_migrations" && existing.includes(t));
    // Refuse to load over real data. A freshly migrated database only has the starter rows the
    // migrations insert (professions, settings…); those are cleared below and replaced by the backup's.
    if (!opts.force) {
      for (const t of ["User", "Provider", "ClinicOrg", "Shift"].filter((x) => existing.includes(x))) {
        const n = (await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${q(t)}`)).rows[0].n;
        if (n > 0) throw new Error(`The target database isn't empty (${t} has ${n} rows). Restore into a fresh database or branch.`);
      }
    }

    // Foreign keys → load order (parents first); self-references are deferred to a second pass.
    const fks = (
      await client.query<{ t: string; col: string; ref: string }>(`
        SELECT tc.table_name::text AS t, kcu.column_name::text AS col, ccu.table_name::text AS ref
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
        JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`)
    ).rows;
    const selfCols = new Map<string, string[]>();
    const deps = new Map<string, Set<string>>(names.map((t) => [t, new Set<string>()]));
    for (const f of fks) {
      if (!deps.has(f.t)) continue;
      if (f.ref === f.t) selfCols.set(f.t, [...(selfCols.get(f.t) ?? []), f.col]);
      else if (deps.has(f.ref)) deps.get(f.t)!.add(f.ref);
    }
    const order: string[] = [];
    const seen = new Set<string>();
    const visit = (t: string, stack: Set<string>) => {
      if (seen.has(t)) return;
      if (stack.has(t)) throw new Error(`Circular foreign keys around ${t}`);
      stack.add(t);
      for (const d of deps.get(t) ?? []) visit(d, stack);
      stack.delete(t);
      seen.add(t);
      order.push(t);
    };
    for (const t of names) visit(t, new Set());

    await client.query("BEGIN");
    if (order.length) await client.query(`TRUNCATE ${order.map(q).join(", ")} CASCADE`);
    for (const t of order) await client.query(`ALTER TABLE ${q(t)} DISABLE TRIGGER USER`);
    let total = 0;
    for (const t of order) {
      const rows = tables.get(t) as Record<string, unknown>[];
      const self = selfCols.get(t) ?? [];
      const later: { id: unknown; vals: Record<string, unknown> }[] = [];
      const prepared = rows.map((r) => {
        if (!self.length) return r;
        const vals: Record<string, unknown> = {};
        const copy = { ...r };
        for (const c of self) if (copy[c] != null) (vals[c] = copy[c]), (copy[c] = null);
        if (Object.keys(vals).length) later.push({ id: r.id, vals });
        return copy;
      });
      for (let i = 0; i < prepared.length; i += 500) {
        await client.query(`INSERT INTO ${q(t)} SELECT * FROM json_populate_recordset(NULL::${q(t)}, $1::json)`, [JSON.stringify(prepared.slice(i, i + 500))]);
      }
      for (const u of later) {
        const cols = Object.keys(u.vals);
        await client.query(`UPDATE ${q(t)} SET ${cols.map((c, i) => `${q(c)} = $${i + 2}`).join(", ")} WHERE "id" = $1`, [u.id, ...cols.map((c) => u.vals[c])]);
      }
      total += rows.length;
      log(`${t}: ${rows.length}`);
    }
    for (const t of order) await client.query(`ALTER TABLE ${q(t)} ENABLE TRIGGER USER`);
    await client.query("COMMIT");
    return { tables: order.length, rows: total, createdAt: meta.createdAt };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    await client.end();
  }
}
