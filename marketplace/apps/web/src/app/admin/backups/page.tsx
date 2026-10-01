import { DateTime } from "luxon";
import { backups } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { Alert, PageHeader, Stat, Table, Td, Th } from "@/components/ui/misc";
import { dateTimeLabel } from "@/lib/format";
import { installedRelease } from "@/lib/release";
import { requireActor } from "@/lib/session";
import { backupNowAction, restoreAction, restorePointAction } from "../actions";

export const metadata = { title: "Backups & restore" };
export const dynamic = "force-dynamic";

const mb = (b: number | null) => (b == null ? "—" : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

export default async function Backups() {
  const { actor } = await requireActor("admin");
  const o = await backups.backupsOverview(actor);
  const rel = installedRelease();
  const lastExport = o.exports.find((e) => e.status === "DONE");
  const lastPoint = o.points.find((p) => p.status === "DONE");
  const failed = o.exports.find((e) => e.status === "FAILED" && (!lastExport || e.startedAt > lastExport.startedAt));
  const nowEt = DateTime.now().setZone("America/New_York").toFormat("yyyy-LL-dd'T'HH:mm");
  return (
    <>
      <PageHeader title="Backups & restore" description="Every night the whole database is exported (encrypted) and, with Neon connected, a restore point is made. Before you install a release, make a restore point here. If something goes wrong, rewind the database to any moment in Neon's history, and put the previous app folder back." />
      {failed ? <Alert tone="error" title="The latest backup failed" className="mb-4">{failed.error}</Alert> : null}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Last export" value={lastExport ? dateTimeLabel(lastExport.startedAt) : "None yet"} hint={lastExport ? `${mb(lastExport.sizeBytes)} · ${(lastExport.rowCount ?? 0).toLocaleString()} rows` : "Runs nightly at 3:10 am ET"} />
        <Stat label="Last restore point" value={lastPoint ? dateTimeLabel(lastPoint.startedAt) : o.neon.connected ? "None yet" : "Neon not connected"} />
        <Stat label="Neon history" value={o.neon.connected ? `${o.neon.historyHours ?? "?"} hours` : "—"} hint="How far back you can rewind" />
        <Stat label="Installed release" value={rel.version} hint={rel.builtAt ? `built ${dateTimeLabel(new Date(rel.builtAt))}` : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Before you install a release" description="Takes a few seconds. Do it every time." />
          <CardBody className="space-y-3">
            {o.neon.connected ? (
              <ActionForm action={restorePointAction} className="flex flex-wrap gap-2">
                <Input name="label" placeholder="Label, e.g. before update-018" className="w-64" />
                <SubmitButton>Create restore point</SubmitButton>
              </ActionForm>
            ) : null}
            <ActionForm action={backupNowAction} className="flex flex-wrap gap-2">
              <input type="hidden" name="label" value="manual" />
              <SubmitButton variant={o.neon.connected ? "outline" : "primary"} pendingText="Exporting…">Back up now (export)</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>

        <Card className="border-red-200">
          <CardHeader title="Restore the database" description="Rewinds the live database. Today's data is kept in Neon as a branch named before-restore-…, so a restore can be undone the same way." />
          <CardBody className="space-y-4">
            {o.neon.connected ? (
              <>
                <ActionForm action={restoreAction} className="space-y-2" confirm="Rewind the live database to that time? Anything entered after it will be set aside (kept in Neon as a branch).">
                  <label className="block text-xs font-medium text-slate-600">Go back to (Eastern time)</label>
                  <Input name="at" type="datetime-local" max={nowEt} required />
                  <Input name="confirm" placeholder="Type RESTORE" required />
                  <SubmitButton variant="danger">Restore to this time</SubmitButton>
                </ActionForm>
                {o.points.some((p) => p.status === "DONE") ? (
                  <ActionForm action={restoreAction} className="space-y-2 border-t border-slate-100 pt-4" confirm="Rewind the live database to this restore point?">
                    <Select name="restorePointId" required defaultValue="">
                      <option value="" disabled>Choose a restore point…</option>
                      {o.points.filter((p) => p.status === "DONE").map((p) => <option key={p.id} value={p.id}>{dateTimeLabel(p.startedAt)}{p.label ? ` · ${p.label}` : ""}</option>)}
                    </Select>
                    <Input name="confirm" placeholder="Type RESTORE" required />
                    <SubmitButton variant="danger">Restore to this point</SubmitButton>
                  </ActionForm>
                ) : null}
              </>
            ) : (
              <div className="space-y-2 text-sm text-slate-700">
                {o.neon.error ? <Alert tone="error" title="Neon didn't accept the connection">{o.neon.error}</Alert> : null}
                <p><b>Connect Neon for one-click restore</b> (recommended):</p>
                <ol className="list-decimal space-y-1 pl-5">
                  <li>Neon console → your account (top right) → <b>Account settings → API keys</b> → Create key.</li>
                  <li>Your project → <b>Settings → General</b> → copy the <b>Project ID</b>.</li>
                  <li>cPanel → Setup Node.js App → Environment variables: add <code>NEON_API_KEY</code> and <code>NEON_PROJECT_ID</code>, Save, Restart.</li>
                </ol>
                <p className="text-xs text-slate-500">Until then you can still restore from the Neon console: Branches → your main branch → <b>Restore</b> → pick a time.</p>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Roll back the app (code)" description={`Installed: ${rel.version}${rel.latestMigration ? ` · database schema ${rel.latestMigration}` : ""}`} />
        <CardBody className="space-y-2 text-sm text-slate-700">
          <p>When you install a release, <b>rename</b> the old <code>app</code> folder to <code>app-previous</code> instead of deleting it (and <code>node_modules</code> to <code>node_modules-previous</code> when the release includes part 2). To go back:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Setup Node.js App → <b>Stop App</b>.</li>
            <li>File Manager: rename <code>app</code> → <code>app-broken</code>, then <code>app-previous</code> → <code>app</code> (same for <code>node_modules</code> if you swapped it).</li>
            <li><b>Start App</b>. Database updates only ever add tables and columns, so the previous app runs fine on the newer database; restore the database too only if data went wrong.</li>
          </ol>
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Exports" description={`Encrypted with ${o.keyFromSessionSecret ? "a key made from SESSION_SECRET" : "BACKUP_KEY"}; keep a copy of that value somewhere safe, or the files can't be opened. Kept: 14 daily, 8 weekly, 12 monthly (Settings → Backups).`} />
        <Table>
          <thead><tr><Th>When</Th><Th>Kind</Th><Th>Size</Th><Th>Rows</Th><Th></Th></tr></thead>
          <tbody>
            {o.exports.length ? o.exports.map((e) => (
              <tr key={e.id}>
                <Td>{dateTimeLabel(e.startedAt)}{e.label && e.label !== "manual" ? <div className="text-xs text-slate-500">{e.label}</div> : null}</Td>
                <Td>{e.status === "FAILED" ? <Badge tone="red">Failed</Badge> : e.status === "RUNNING" ? <Badge tone="amber">Running</Badge> : <Badge tone="gray">{e.tier}</Badge>}</Td>
                <Td className="tabular-nums">{mb(e.sizeBytes)}</Td>
                <Td className="tabular-nums">{e.rowCount?.toLocaleString() ?? "—"}</Td>
                <Td>{e.status === "DONE" ? <a href={`/api/backups/${e.id}`} className="text-sm text-brand-700">Download</a> : <span className="text-xs text-red-700">{e.error}</span>}</Td>
              </tr>
            )) : <tr><Td className="text-slate-500">No exports yet. The first runs tonight, or click "Back up now".</Td></tr>}
          </tbody>
        </Table>
      </Card>

      {o.points.length || o.restores.length ? (
        <Card className="mt-6">
          <CardHeader title="Restore points & restores" />
          <ul className="divide-y divide-slate-100 text-sm">
            {[...o.restores, ...o.points].sort((a, b) => +b.startedAt - +a.startedAt).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
                <span>{dateTimeLabel(r.startedAt)} {r.label ? <span className="text-slate-500">· {r.label}</span> : null}</span>
                <Badge tone={r.kind === "RESTORE" ? "amber" : r.status === "FAILED" ? "red" : "gray"}>{r.kind === "RESTORE" ? "Restore" : r.status === "FAILED" ? "Failed" : `Restore point · ${r.tier}`}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
