import { DomainError, exclusionNameKey, exclusionRowKey, legalNameParts, matchExclusion, parseExclusionFile, type ExclusionResult, type ExclusionRow, type ExclusionSource } from "@cm/core";
import { prisma, type Prisma } from "@cm/db";
import { exclusionListFetcher, storageProvider } from "@cm/integrations";
import { fileText } from "./boardcheck";
import { audit, clock, getSettings, requireAdmin, SYSTEM, type Actor } from "./context";
import { notifyAdmins } from "./notify";

/**
 * Federal exclusion lists (core exclusions.ts). The OIG list is downloaded automatically every
 * exclusions.refreshDays; a SAM.gov extract can be uploaded on Admin → Verification → Exclusion
 * check. Each source is stored whole in ExclusionRecord (replaced on refresh), so a new provider
 * is checked right away, and everyone is re-checked after each refresh.
 *  - NPI on a list → EXCLUDED at once: no new shifts (F16) and booked ones are released through
 *    the usual credential re-check; admins alerted.
 *  - same name in their state/profession → POSSIBLE_MATCH: nothing blocked; an admin compares.
 *  - an EXCLUDED provider who drops off the list is never cleared automatically (admin task).
 */

type ListInfo = { loadedAt: string; rows: number; skipped: number; fileName?: string };
const listKey = (source: ExclusionSource) => `exclusions.list.${source}`;

export async function exclusionLists(): Promise<Partial<Record<ExclusionSource, ListInfo>>> {
  const rows = await prisma.setting.findMany({ where: { key: { in: [listKey("LEIE"), listKey("SAM")] } } });
  return Object.fromEntries(rows.map((r) => [r.key.split(".").pop(), r.value as ListInfo]));
}

/** Replaces one source's rows (one transaction, batched inserts). */
async function storeList(source: ExclusionSource, rows: ExclusionRow[], skipped: number, fileName?: string) {
  await prisma.$transaction(
    async (db) => {
      await db.exclusionRecord.deleteMany({ where: { source } });
      for (let i = 0; i < rows.length; i += 2000) {
        await db.exclusionRecord.createMany({
          data: rows.slice(i, i + 2000).map((r) => ({ ...r, nameKey: exclusionNameKey(r.firstName, r.lastName) })),
        });
      }
      const info: ListInfo = { loadedAt: clock.now().toISOString(), rows: rows.length, skipped, ...(fileName ? { fileName } : {}) };
      await db.setting.upsert({ where: { key: listKey(source) }, create: { key: listKey(source), value: info }, update: { value: info } });
    },
    { timeout: 600_000, maxWait: 60_000 },
  );
}

/** Downloads the OIG list when it's due (or `force`), stores it and re-checks everyone. */
export async function refreshLeie(opts: { force?: boolean } = {}) {
  const s = await getSettings();
  if (!s["exclusions.enabled"]) return { skipped: "off" as const };
  const last = (await exclusionLists()).LEIE;
  if (!opts.force && last && +clock.now() - +new Date(last.loadedAt) < s["exclusions.refreshDays"] * 86_400_000) return { skipped: "fresh" as const };
  const text = await exclusionListFetcher()(s["exclusions.leieUrl"]);
  const parsed = parseExclusionFile(text, clock.now());
  if (parsed.source !== "LEIE" || parsed.rows.length < 1000) throw new Error(`The OIG download didn't look right (${parsed.rows.length} listings).`);
  await storeList("LEIE", parsed.rows, parsed.skipped);
  return { loaded: parsed.rows.length };
}

// ---------------- background loading (the lists are too big to load inside a page request) ----------------

type Pending = { kind: "file"; key: string; fileName: string; at: string } | { kind: "leie"; at: string };
type Running = { kind: string; fileName?: string; startedAt: string };
type LastImport = { at: string; kind: string; fileName?: string; ok: boolean; message: string };

async function putSetting(key: string, value: unknown) {
  await prisma.setting.upsert({ where: { key }, create: { key, value: value as Prisma.InputJsonValue }, update: { value: value as Prisma.InputJsonValue } });
}

/** Admin upload: saves the file and queues it; job exclusionImports loads it within a minute or so. */
export async function queueExclusionFile(actor: Actor, file: Buffer, fileName: string) {
  requireAdmin(actor);
  if (!file.length) throw new DomainError("VALIDATION", "That file is empty.");
  if (!/\.(zip|csv|txt)$/i.test(fileName)) throw new DomainError("VALIDATION", "Upload the .zip or .csv exactly as downloaded.");
  const key = await storageProvider().put("exclusion-imports", file, "application/octet-stream");
  await putSetting("exclusions.pending", { kind: "file", key, fileName, at: clock.now().toISOString() } satisfies Pending);
  await audit(prisma, actor, "exclusions.queued", "Setting", "exclusions.pending", null, { fileName, bytes: file.length });
}

/** "Download now": queues a fresh OIG download for the background job. */
export async function queueLeieRefresh(actor: Actor) {
  requireAdmin(actor);
  await putSetting("exclusions.pending", { kind: "leie", at: clock.now().toISOString() } satisfies Pending);
}

/** Every minute: runs a queued upload or download, then re-checks everyone. One at a time (job lease). */
export async function exclusionImportSweep() {
  const row = await prisma.setting.findUnique({ where: { key: "exclusions.pending" } });
  if (!row) return { idle: true };
  const job = row.value as Pending;
  await prisma.setting.delete({ where: { key: "exclusions.pending" } }).catch(() => undefined);
  const fileName = job.kind === "file" ? job.fileName : undefined;
  await putSetting("exclusions.running", { kind: job.kind, fileName, startedAt: clock.now().toISOString() } satisfies Running);
  let last: LastImport;
  try {
    if (job.kind === "leie") {
      const r = await refreshLeie({ force: true });
      const c = await checkProviders({ all: true });
      last = { at: clock.now().toISOString(), kind: "leie", ok: true, message: `Downloaded ${"loaded" in r && r.loaded ? r.loaded.toLocaleString() : "the"} OIG listings and checked ${c.checked} provider${c.checked === 1 ? "" : "s"}: ${c.excluded} excluded, ${c.possible} to review.` };
      await prisma.setting.deleteMany({ where: { key: "exclusions.lastError" } });
    } else {
      const stored = await storageProvider().read(job.key);
      if (!stored) throw new Error("The uploaded file wasn't found. Upload it again.");
      const r = await importExclusionFile(SYSTEM, stored.data, job.fileName);
      await storageProvider().remove(job.key).catch(() => undefined);
      last = { at: clock.now().toISOString(), kind: "file", fileName, ok: true, message: `Loaded ${r.rows.toLocaleString()} ${r.source === "LEIE" ? "OIG" : "SAM.gov"} listings from ${job.fileName} and checked ${r.checked} provider${r.checked === 1 ? "" : "s"}: ${r.excluded} excluded, ${r.possible} to review.` };
    }
  } catch (e) {
    last = { at: clock.now().toISOString(), kind: job.kind, fileName, ok: false, message: e instanceof DomainError ? e.message : `It didn't load: ${(e as Error).message}` };
    if (job.kind === "file") await storageProvider().remove(job.key).catch(() => undefined);
  }
  await putSetting("exclusions.lastImport", last);
  await prisma.setting.deleteMany({ where: { key: "exclusions.running" } });
  return last;
}

/** Admin upload: an OIG UPDATED.csv or a SAM.gov public exclusions extract (.csv or .zip). */
export async function importExclusionFile(actor: Actor, file: Buffer, fileName: string) {
  if (actor.role !== "SYSTEM") requireAdmin(actor);
  let parsed;
  try {
    parsed = parseExclusionFile(fileText(file), clock.now());
  } catch (e) {
    throw new DomainError("VALIDATION", (e as Error).message);
  }
  if (!parsed.rows.length) throw new DomainError("VALIDATION", "No listings in force were found in that file.");
  await storeList(parsed.source, parsed.rows, parsed.skipped, fileName);
  await audit(prisma, actor, "exclusions.import", "Setting", listKey(parsed.source), null, { rows: parsed.rows.length, fileName });
  const checked = await checkProviders({ all: true });
  return { source: parsed.source, rows: parsed.rows.length, skipped: parsed.skipped, ...checked };
}

const providerSelect = {
  id: true, userId: true, displayName: true, legalName: true, npi: true, homeState: true, exclusionStatus: true, exclusionClearedKeys: true, exclusionMatchKey: true,
  licenses: { select: { state: true } },
  professions: { select: { professionCode: true } },
} satisfies Prisma.ProviderSelect;
type Subject = Prisma.ProviderGetPayload<{ select: typeof providerSelect }>;

async function checkOne(p: Subject, words: Record<string, string[]>) {
  const parts = legalNameParts(p.legalName);
  const or: Prisma.ExclusionRecordWhereInput[] = [];
  if (p.npi) or.push({ npi: p.npi.replace(/\D/g, "") });
  if (parts) or.push({ nameKey: exclusionNameKey(parts.first, parts.last) });
  const candidates = or.length ? await prisma.exclusionRecord.findMany({ where: { OR: or }, take: 50 }) : [];
  const m = matchExclusion(
    {
      npi: p.npi,
      legalName: p.legalName,
      states: [...p.licenses.map((l) => l.state), ...(p.homeState ? [p.homeState] : [])],
      professionWords: p.professions.flatMap((x) => words[x.professionCode] ?? []),
      clearedKeys: p.exclusionClearedKeys,
    },
    candidates.map((c) => ({ ...c, source: c.source as ExclusionSource })),
  );
  return apply(p, m.result, m.row ? exclusionRowKey(m.row) : null, m.reason);
}

async function apply(p: Subject, result: ExclusionResult, key: string | null, reason: string | null) {
  const now = clock.now();
  const prev = p.exclusionStatus;
  // Never cleared automatically once excluded: a person decides.
  if (prev === "EXCLUDED" && result !== "EXCLUDED") {
    await prisma.provider.update({ where: { id: p.id }, data: { exclusionCheckedAt: now } });
    const title = `${p.displayName}: no longer on an exclusion list. Review and clear if right.`;
    const open = await prisma.adminTask.findFirst({ where: { kind: "EXCLUSION", entityId: p.id, resolvedAt: null, title } });
    if (!open) await prisma.adminTask.create({ data: { kind: "EXCLUSION", title, entityType: "Provider", entityId: p.id } });
    return prev;
  }
  const changed = result !== prev || key !== p.exclusionMatchKey;
  await prisma.provider.update({ where: { id: p.id }, data: { exclusionStatus: result, exclusionCheckedAt: now, exclusionNote: reason, exclusionMatchKey: key } });
  if (!changed) return result;
  await audit(prisma, SYSTEM, "provider.exclusion_check", "Provider", p.id, { exclusionStatus: prev }, { exclusionStatus: result, reason });
  if (result === "EXCLUDED") {
    await prisma.adminTask.create({ data: { kind: "EXCLUSION", title: `${p.displayName}: on a federal exclusion list`, entityType: "Provider", entityId: p.id } });
    await notifyAdmins(prisma, { template: "exclusion_match", title: `Excluded provider: ${p.displayName}`, body: `${reason} They can't take new shifts and their booked shifts are being released.`, link: `/admin/providers/${p.id}#exclusion`, email: true, sms: true });
    const { recheckProviderAssignments } = await import("./lifecycle");
    await recheckProviderAssignments(p.id, "Federal exclusion list").catch((e) => console.error("exclusion recheck failed", e));
  } else if (result === "POSSIBLE_MATCH") {
    await prisma.adminTask.create({ data: { kind: "EXCLUSION", title: `${p.displayName}: possible exclusion list match`, entityType: "Provider", entityId: p.id } });
    await notifyAdmins(prisma, { template: "exclusion_possible", title: `Check an exclusion listing: ${p.displayName}`, body: reason ?? "A same-name listing needs a look.", link: `/admin/providers/${p.id}#exclusion`, email: true });
  }
  return result;
}

/**
 * Checks providers against the stored lists: those never checked or checked before the newest
 * list (default), or everyone (`all`). Nothing happens until a list is loaded.
 */
export async function checkProviders(opts: { all?: boolean; providerId?: string; limit?: number } = {}) {
  const s = await getSettings();
  if (!s["exclusions.enabled"]) return { checked: 0, excluded: 0, possible: 0 };
  const lists = Object.values(await exclusionLists());
  if (!lists.length) return { checked: 0, excluded: 0, possible: 0 };
  const newest = new Date(Math.max(...lists.map((l) => +new Date(l!.loadedAt))));
  const where: Prisma.ProviderWhereInput = opts.providerId
    ? { id: opts.providerId }
    : opts.all
      ? {}
      : { OR: [{ exclusionCheckedAt: null }, { exclusionCheckedAt: { lt: newest } }] };
  const rows = await prisma.provider.findMany({ where, select: providerSelect, take: opts.limit ?? 5000, orderBy: { createdAt: "asc" } });
  const words = s["exclusions.professionWords"];
  const out = { checked: 0, excluded: 0, possible: 0 };
  for (const p of rows) {
    const r = await checkOne(p, words);
    out.checked++;
    if (r === "EXCLUDED") out.excluded++;
    if (r === "POSSIBLE_MATCH") out.possible++;
  }
  return out;
}

/** Hourly: refresh the OIG list when due, then check new and not-yet-rechecked providers. */
export async function exclusionSweep() {
  const s = await getSettings();
  if (!s["exclusions.enabled"]) return { off: true };
  const refreshed = await refreshLeie().catch(async (e) => {
    const msg = (e as Error).message;
    const prev = (await prisma.setting.findUnique({ where: { key: "exclusions.lastError" } }))?.value as { message?: string } | null;
    await prisma.setting.upsert({ where: { key: "exclusions.lastError" }, create: { key: "exclusions.lastError", value: { message: msg, at: clock.now().toISOString() } }, update: { value: { message: msg, at: clock.now().toISOString() } } });
    if (prev?.message !== msg) await notifyAdmins(prisma, { template: "exclusion_download_failed", title: "The OIG exclusion list didn't download", body: `${msg} You can upload it by hand on Admin → Verification → Exclusion check.`, link: "/admin/verification/exclusions", email: true });
    return { error: msg };
  });
  if (refreshed && "loaded" in refreshed) await prisma.setting.deleteMany({ where: { key: "exclusions.lastError" } });
  const checked = await checkProviders({ limit: 500 });
  return { refreshed, ...checked };
}

/** Admin decisions on the provider page. */
export async function adminExclusionDecision(actor: Actor, providerId: string, decision: "not_same_person" | "confirm_excluded" | "clear", note: string) {
  requireAdmin(actor);
  const clean = note.trim();
  if (clean.length < 3) throw new DomainError("VALIDATION", "Add a short note on what you checked.");
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: providerId }, select: providerSelect });
  const now = clock.now();
  if (decision === "not_same_person") {
    if (!p.exclusionMatchKey) throw new DomainError("CONFLICT", "There's no listing to dismiss.");
    await prisma.provider.update({ where: { id: providerId }, data: { exclusionStatus: "CLEAR", exclusionClearedKeys: { push: p.exclusionMatchKey }, exclusionMatchKey: null, exclusionNote: `Not the same person (admin): ${clean}`, exclusionCheckedAt: now } });
  } else if (decision === "clear") {
    await prisma.provider.update({ where: { id: providerId }, data: { exclusionStatus: "CLEAR", exclusionMatchKey: null, exclusionNote: `Cleared by an admin: ${clean}`, exclusionCheckedAt: now } });
  } else {
    await prisma.provider.update({ where: { id: providerId }, data: { exclusionStatus: "EXCLUDED", exclusionNote: `Confirmed by an admin: ${clean}`, exclusionCheckedAt: now } });
    const { recheckProviderAssignments } = await import("./lifecycle");
    await recheckProviderAssignments(providerId, "Federal exclusion list").catch((e) => console.error("exclusion recheck failed", e));
  }
  await prisma.adminTask.updateMany({ where: { kind: "EXCLUSION", entityId: providerId, resolvedAt: null }, data: { resolvedAt: now, resolvedById: actor.userId } });
  await audit(prisma, actor, `provider.exclusion_${decision}`, "Provider", providerId, { exclusionStatus: p.exclusionStatus }, { note: clean });
}

/** Admin → Verification → Exclusion check. */
export async function exclusionOverview(actor: Actor) {
  requireAdmin(actor);
  const [lists, flagged, counts, lastError, pending, running, lastImport] = await Promise.all([
    exclusionLists(),
    prisma.provider.findMany({ where: { exclusionStatus: { in: ["EXCLUDED", "POSSIBLE_MATCH"] } }, select: { id: true, displayName: true, exclusionStatus: true, exclusionNote: true, exclusionCheckedAt: true }, orderBy: { exclusionCheckedAt: "desc" } }),
    prisma.provider.groupBy({ by: ["exclusionStatus"], _count: true }),
    prisma.setting.findUnique({ where: { key: "exclusions.lastError" } }),
    prisma.setting.findUnique({ where: { key: "exclusions.pending" } }),
    prisma.setting.findUnique({ where: { key: "exclusions.running" } }),
    prisma.setting.findUnique({ where: { key: "exclusions.lastImport" } }),
  ]);
  return { lists, flagged, counts: Object.fromEntries(counts.map((c) => [c.exclusionStatus, c._count])), lastError: (lastError?.value as { message: string; at: string } | null) ?? null,
    pending: (pending?.value as Pending | null) ?? null,
    running: (running?.value as Running | null) ?? null,
    lastImport: (lastImport?.value as LastImport | null) ?? null,
  };
}
