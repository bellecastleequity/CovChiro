import {
  acceptBusinessEmail, acceptProviderEmail, apolloBudget, apolloOrganizationSearchBody, apolloSearchBody, CA_PROVINCES, DomainError, estimateApolloCredits,
  isDecisionMakerTitle, mapApolloOrganization, mapApolloPerson, matchesProfile, sideSplit, US_STATES, usableApolloEmail, type ApolloOrganization, type ApolloPerson, type Side,
} from "@cm/core";
import { prisma, type ClinicProspect, type Prisma, type ProviderProspect } from "@cm/db";
import { ApolloError, apolloProvider, geoProvider, nppesProvider, type ApolloRaw } from "@cm/integrations";
import { DateTime } from "luxon";
import { audit, clock, getSettings, requireAdmin, type Actor } from "../context";
import { marketForPoint } from "./analytics";
import { canadianCityCenter } from "./cities";
import { isSuppressed, logAgent, newToken } from "./engine";
import { activeTargets, registryProfile } from "./expansion";
import { priorityContext } from "./priority";
import { verifyContact } from "./providers";

/**
 * Apollo.io inside the existing Growth system (owner request Oct 2026). Apollo is one more
 * prospecting source: its people and companies become ordinary ClinicProspect / ProviderProspect
 * rows (same CRM, stages, campaigns, outreach agents and compliance gate), deduplicated by Apollo id,
 * NPI, email and website. Nothing here verifies a license: providers still go through onboarding and
 * credential verification before any shift (INV-1).
 *
 * Costs: people search is free; organization search and enrichment use credits. Every call is logged
 * in DataSourceUsage with its ESTIMATED credits (growth.apollo.creditCosts); the daily/monthly caps
 * and the large-job approval run on those estimates (core apolloBudget). 401/403/429 pause Apollo
 * (Setting growth.apollo.pause) so agents stop calling until it clears or an admin resumes.
 */
const SOURCE = "Apollo.io";
const PAUSE_KEY = "growth.apollo.pause";
const CURSOR_KEY = "growth.apollo.cursor";
const SEARCH_TTL_MS = 24 * 3_600_000;

type Settings = Awaited<ReturnType<typeof getSettings>>;
export type ApolloTask = "admin_search" | "admin_import" | "admin_test" | "apolloDiscovery" | "apolloEnrichment";

// ---------------- pause, usage, budget ----------------

export async function apolloPause(): Promise<{ until: Date; reason: string; error: string } | null> {
  const row = await prisma.setting.findUnique({ where: { key: PAUSE_KEY } });
  const v = row?.value as { until?: string; reason?: string; error?: string } | null;
  if (!v?.until || new Date(v.until) <= clock.now()) return null;
  return { until: new Date(v.until), reason: v.reason ?? "paused", error: v.error ?? "" };
}

async function pauseApollo(e: ApolloError) {
  const minutes = e.kind === "rate_limit" ? Math.max(1, Math.ceil((e.retryAfterSeconds ?? 600) / 60)) : 24 * 60;
  const until = new Date(+clock.now() + minutes * 60_000);
  const value = { until: until.toISOString(), reason: e.kind, error: e.message.slice(0, 300) } as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({ where: { key: PAUSE_KEY }, create: { key: PAUSE_KEY, value }, update: { value } });
  await logAgent("clinicProspecting", "apollo_paused", { output: `Apollo paused until ${until.toISOString()} (${e.kind})`, error: e.message.slice(0, 300) });
}

export async function resumeApollo(actor: Actor) {
  requireAdmin(actor);
  await prisma.setting.deleteMany({ where: { key: PAUSE_KEY } });
}

/** Estimated Apollo credits used today and this month (Eastern time). */
export async function apolloCreditsUsed() {
  const now = DateTime.fromJSDate(clock.now(), { zone: "America/New_York" });
  const sum = async (since: Date) => (await prisma.dataSourceUsage.aggregate({ where: { source: "apollo", createdAt: { gte: since } }, _sum: { creditsEstimated: true } }))._sum.creditsEstimated ?? 0;
  return { today: await sum(now.startOf("day").toJSDate()), month: await sum(now.startOf("month").toJSDate()) };
}

type Meta = { operation: string; task: ApolloTask; side?: Side | null; region?: string | null; marketKey?: string | null; createdById?: string | null };

async function logUsage(m: Meta, records: number, credits: number, error: string | null) {
  await prisma.dataSourceUsage.create({
    data: { source: "apollo", operation: m.operation, task: m.task, side: m.side ?? null, region: m.region ?? null, marketKey: m.marketKey ?? null, createdById: m.createdById ?? null, records, creditsEstimated: credits, ok: !error, error: error?.slice(0, 300) ?? null },
  });
}

const BUDGET_TEXT: Record<string, string> = {
  paused: "Apollo is paused after an error (see Growth → Prospecting).",
  daily_cap: "That would go over today's Apollo credit cap (Growth settings).",
  monthly_cap: "That would go over this month's Apollo credit cap (Growth settings).",
  needs_approval: "This is a large job: tick the approval box to use that many credits.",
  disabled: "Apollo is switched off (Growth settings → Apollo.io).",
  not_configured: "APOLLO_API_KEY isn't set on the server.",
};

/** Can Apollo be used now for a job of this estimated size? */
export async function apolloGate(estimate: number, approved: boolean, s?: Settings): Promise<{ ok: boolean; reason: string | null }> {
  s ??= await getSettings();
  if (apolloProvider().name === "none") return { ok: false, reason: "not_configured" };
  if (!s["growth.apollo.enabled"]) return { ok: false, reason: "disabled" };
  const used = await apolloCreditsUsed();
  return apolloBudget({ estimate, usedToday: used.today, usedMonth: used.month, dailyCap: s["growth.apollo.dailyCreditCap"], monthlyCap: s["growth.apollo.monthlyCreditCap"], largeJob: s["growth.apollo.largeJobCredits"], approved, paused: !!(await apolloPause()) });
}

/** One Apollo call: logged with its estimated credits; auth / plan / rate-limit errors pause Apollo. */
async function call<T>(m: Meta, credits: number, fn: () => Promise<T>, count: (t: T) => number): Promise<T> {
  try {
    const r = await fn();
    await logUsage(m, count(r), credits, null);
    return r;
  } catch (e) {
    const err = e instanceof ApolloError ? e : new ApolloError("unavailable", (e as Error).message);
    // A refused call doesn't spend credits; an outage may have, so we count the estimate to stay safe.
    await logUsage(m, 0, err.kind === "unavailable" ? credits : 0, `${err.kind}: ${err.message}`);
    if (err.kind === "auth" || err.kind === "forbidden" || err.kind === "rate_limit") await pauseApollo(err);
    throw err;
  }
}

export async function apolloStatus() {
  const s = await getSettings();
  const [used, pause, recent, byTask] = await Promise.all([
    apolloCreditsUsed(), apolloPause(),
    prisma.dataSourceUsage.findMany({ where: { source: "apollo" }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.dataSourceUsage.groupBy({ by: ["task", "side"], where: { source: "apollo", createdAt: { gte: DateTime.fromJSDate(clock.now(), { zone: "America/New_York" }).startOf("month").toJSDate() } }, _sum: { creditsEstimated: true, records: true }, _count: { _all: true } }),
  ]);
  const [providers, clinics] = await Promise.all([
    prisma.providerProspect.count({ where: { OR: [{ source: SOURCE }, { apolloPersonId: { not: null } }] } }),
    prisma.clinicProspect.count({ where: { OR: [{ source: SOURCE }, { apolloOrganizationId: { not: null } }] } }),
  ]);
  return {
    configured: apolloProvider().name !== "none", enabled: s["growth.apollo.enabled"], autoDiscovery: s["growth.apollo.autoDiscovery"], contactEnrichment: s["growth.apollo.contactEnrichment"],
    used, caps: { daily: s["growth.apollo.dailyCreditCap"], monthly: s["growth.apollo.monthlyCreditCap"], largeJob: s["growth.apollo.largeJobCredits"] },
    pause, recent, byTask: byTask.map((b) => ({ task: b.task, side: b.side, calls: b._count._all, records: b._sum.records ?? 0, credits: b._sum.creditsEstimated ?? 0 })),
    prospects: { providers, clinics },
  };
}

export async function testApolloConnection(actor: Actor) {
  requireAdmin(actor);
  const p = apolloProvider();
  if (p.name === "none") return { ok: false, detail: BUDGET_TEXT.not_configured };
  try {
    const r = await call({ operation: "health", task: "admin_test", createdById: actor.userId }, 0, () => p.health(), () => 0);
    // People search is the call that needs a master key; a 1-row search costs nothing and proves it works.
    await call({ operation: "people_search", task: "admin_test", createdById: actor.userId }, 0, () => p.searchPeople({ person_titles: ["Chiropractor"], person_locations: ["Florida, US"], page: 1, per_page: 1 }), (x) => x.items.length);
    return { ok: r.ok, detail: `${r.detail} People search works (needs a master API key).` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}

// ---------------- dedupe + upserts into the existing CRM ----------------

const domainOf = (url: string | null | undefined) => {
  if (!url) return null;
  try {
    return new URL(url.includes("//") ? url : `https://${url}`).host.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
};

async function placeOf(city: string | null, region: string, address?: string | null, zip?: string | null, professionCode = "DC") {
  const q = [address, city, region, zip].filter(Boolean).join(", ");
  if (!city && !address) return { lat: null, lng: null, marketKey: null };
  // Address geocoding covers the U.S. and its territories; Canadian prospects use the starter city centers.
  if (CA_PROVINCES[region]) {
    const c = canadianCityCenter(region, city);
    return c ? { lat: c.lat, lng: c.lng, marketKey: (await marketForPoint(c.lat, c.lng, professionCode))?.key ?? null } : { lat: null, lng: null, marketKey: null };
  }
  try {
    const g = await geoProvider().geocode(q);
    if (!g) return { lat: null, lng: null, marketKey: null };
    return { lat: g.lat, lng: g.lng, marketKey: (await marketForPoint(g.lat, g.lng, professionCode))?.key ?? null };
  } catch {
    return { lat: null, lng: null, marketKey: null };
  }
}

/** Is this person already on the platform (provider login with the same email)? */
async function onPlatformByEmail(email: string | null) {
  if (!email) return false;
  return !!(await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" }, role: "PROVIDER" }, select: { id: true } }));
}

/** For a U.S. person with a full name: their NPI when exactly one individual of the profession matches in that state. */
async function npiFor(p: ApolloPerson, professionCode: string): Promise<string | null> {
  if (!p.firstName || !p.lastName || !p.region || !US_STATES[p.region]) return null;
  const reg = nppesProvider();
  if (!reg.findPeople) return null;
  try {
    const profile = await registryProfile(professionCode);
    const hits = (await reg.findPeople({ firstName: p.firstName, lastName: p.lastName, state: p.region })).filter((r) => r.kind === "individual" && matchesProfile(r, profile));
    return hits.length === 1 ? hits[0].npi : null;
  } catch {
    return null;
  }
}

const displayName = (p: ApolloPerson) => {
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ");
  if (p.lastName) return name;
  return `${p.firstName ?? "Provider"} (surname shown once enriched)`;
};

export type UpsertResult = "inserted" | "updated" | "on_platform" | "skipped";

/** An Apollo person as a provider prospect. Idempotent: matched by Apollo id, then NPI, then email. */
export async function upsertApolloProviderProspect(p: ApolloPerson, professionCode: string, s: Settings, source = SOURCE): Promise<UpsertResult> {
  if (!p.region) return "skipped";
  const email = usableApolloEmail(p, s["growth.apollo.allowLikelyEmails"]);
  if (await onPlatformByEmail(email)) return "on_platform";
  const npi = await npiFor(p, professionCode);
  if (npi && (await prisma.provider.findFirst({ where: { npi }, select: { id: true } }))) return "on_platform";
  let existing: ProviderProspect | null = await prisma.providerProspect.findUnique({ where: { apolloPersonId: p.apolloPersonId } });
  if (!existing && npi) existing = await prisma.providerProspect.findUnique({ where: { npi } });
  if (!existing && email) existing = await prisma.providerProspect.findFirst({ where: { email } });
  const now = clock.now();
  let id: string;
  let result: UpsertResult;
  if (existing) {
    if (existing.providerId) return "on_platform";
    const data: Prisma.ProviderProspectUpdateInput = { sourceVerifiedAt: now };
    if (!existing.apolloPersonId) data.apolloPersonId = p.apolloPersonId;
    if (!existing.apolloOrganizationId && p.apolloOrganizationId) data.apolloOrganizationId = p.apolloOrganizationId;
    if (!existing.title && p.title) data.title = p.title;
    if (!existing.npi && npi) data.npi = npi;
    if (p.lastName && !existing.lastName) Object.assign(data, { firstName: p.firstName, lastName: p.lastName, displayName: displayName(p) });
    await prisma.providerProspect.update({ where: { id: existing.id }, data });
    id = existing.id;
    result = "updated";
  } else {
    const place = await placeOf(p.city, p.region, null, null, professionCode);
    const row = await prisma.providerProspect.create({
      data: {
        npi, apolloPersonId: p.apolloPersonId, apolloOrganizationId: p.apolloOrganizationId, professionCode, firstName: p.firstName, lastName: p.lastName, title: p.title,
        displayName: displayName(p), city: p.city, state: p.region, ...place, source, sourceVerifiedAt: now, practiceRole: "UNKNOWN", providersAtPractice: 1, publicToken: newToken(),
        website: p.organizationDomain ? `https://${p.organizationDomain}` : null,
      },
    });
    id = row.id;
    result = "inserted";
  }
  if (email) await useProviderEmail(id, email);
  return result;
}

/** Keep an Apollo email only under the same rule as contact discovery, then MX-check it. */
async function useProviderEmail(id: string, email: string) {
  const p = await prisma.providerProspect.findUniqueOrThrow({ where: { id } });
  if (p.contactStatus === "VERIFIED" || (await isSuppressed("EMAIL", email))) return false;
  const ok = acceptProviderEmail({ email, firstName: p.firstName, lastName: p.lastName, website: p.website, practiceRole: p.practiceRole as "OWNER" | "ASSOCIATE" | "UNKNOWN", providersAtPractice: p.providersAtPractice });
  if (!ok.ok) return false;
  await prisma.providerProspect.update({ where: { id }, data: { email, emailOrigin: "apollo", emailSourceUrl: null, contactStatus: "FOUND", emailStatus: "VALID", researchStatus: "DONE", ...(p.stage === "DISCOVERED" ? { stage: "CONTACT_FOUND" } : {}) } });
  await verifyContact(id);
  return true;
}

/** An Apollo company (and optionally its decision-maker) as a clinic prospect. Idempotent: Apollo id, then website domain, then name + ZIP. */
export async function upsertApolloClinicProspect(o: ApolloOrganization, person: ApolloPerson | null, professionCode: string, s: Settings, source = SOURCE): Promise<UpsertResult> {
  if (!o.region) return "skipped";
  const domain = o.domain ?? domainOf(o.website);
  let existing: ClinicProspect | null = await prisma.clinicProspect.findUnique({ where: { apolloOrganizationId: o.apolloOrganizationId } });
  if (!existing && domain) existing = await prisma.clinicProspect.findFirst({ where: { website: { contains: domain, mode: "insensitive" } } });
  if (!existing && o.zip) existing = await prisma.clinicProspect.findFirst({ where: { clinicName: { equals: o.name, mode: "insensitive" }, zip: o.zip } });
  const now = clock.now();
  let row: ClinicProspect;
  let result: UpsertResult;
  if (existing) {
    if (existing.clinicOrgId) return "on_platform";
    // Never overwrite what people or research already filled in; only fill gaps.
    const data: Prisma.ClinicProspectUpdateInput = { sourceVerifiedAt: now };
    if (!existing.apolloOrganizationId) data.apolloOrganizationId = o.apolloOrganizationId;
    if (!existing.website && o.website) data.website = o.website;
    if (!existing.phone && o.phone) data.phone = o.phone;
    if (!existing.address && o.address) data.address = o.address;
    if (!existing.city && o.city) data.city = o.city;
    if (!existing.zip && o.zip) data.zip = o.zip;
    if (!existing.professionCodes.includes(professionCode)) data.professionCodes = [...existing.professionCodes, professionCode];
    row = await prisma.clinicProspect.update({ where: { id: existing.id }, data });
    result = "updated";
  } else {
    const place = await placeOf(o.city, o.region, o.address, o.zip, professionCode);
    row = await prisma.clinicProspect.create({
      data: {
        professionCodes: [professionCode], clinicName: o.name, website: o.website, phone: o.phone, address: o.address, city: o.city, state: o.region, zip: o.zip, ...place,
        apolloOrganizationId: o.apolloOrganizationId, source, collectedAt: now, sourceVerifiedAt: now, publicToken: newToken(),
      },
    });
    result = "inserted";
  }
  if (person) await useClinicContact(row, person, s);
  return result;
}

/** A decision-maker's work email at the clinic's own domain (never personal free-mail), when the clinic has none yet. */
async function useClinicContact(c: ClinicProspect, person: ApolloPerson, s: Settings) {
  const data: Prisma.ClinicProspectUpdateInput = {};
  if (!c.apolloPersonId) data.apolloPersonId = person.apolloPersonId;
  if (!c.decisionMakerTitle && person.title) data.decisionMakerTitle = person.title;
  if (!c.ownerName && person.lastName && /owner|founder|president|ceo|principal/i.test(person.title ?? "")) data.ownerName = `${person.firstName ?? ""} ${person.lastName}`.trim();
  const email = usableApolloEmail(person, s["growth.apollo.allowLikelyEmails"]);
  if (!c.email && email && acceptBusinessEmail(email, c.website) && !(await isSuppressed("EMAIL", email))) {
    data.email = email;
    if (c.stage === "PROSPECT") data.stage = "CONTACTABLE";
  }
  if (Object.keys(data).length) await prisma.clinicProspect.update({ where: { id: c.id }, data });
}

// ---------------- admin search → preview → import selected ----------------

type Row = { key: string; kind: "person" | "organization"; person?: ApolloPerson; organization?: ApolloOrganization; duplicate: string | null };

function validRegion(region: string) {
  const r = region.trim().toUpperCase();
  if (!US_STATES[r] && !CA_PROVINCES[r]) throw new DomainError("VALIDATION", "Pick a U.S. state, territory or Canadian province.");
  return r;
}

async function duplicateNote(row: Omit<Row, "duplicate">): Promise<string | null> {
  if (row.person) {
    const pp = await prisma.providerProspect.findUnique({ where: { apolloPersonId: row.person.apolloPersonId }, select: { id: true } });
    if (pp) return "Already a provider prospect";
  }
  const orgId = row.organization?.apolloOrganizationId ?? row.person?.apolloOrganizationId;
  if (orgId && (await prisma.clinicProspect.findUnique({ where: { apolloOrganizationId: orgId }, select: { id: true } }))) return row.kind === "organization" ? "Already a clinic prospect" : "Their clinic is already a prospect";
  const domain = row.organization?.domain ?? row.person?.organizationDomain;
  if (row.kind === "organization" && domain && (await prisma.clinicProspect.findFirst({ where: { website: { contains: domain, mode: "insensitive" } }, select: { id: true } }))) return "Same website as a clinic prospect";
  return null;
}

/**
 * Admin search (Growth → Prospecting → Search Apollo). SUPPLY = providers by title; DEMAND =
 * decision-makers at clinics (free people search) or the clinics themselves (organization search,
 * uses credits). Results are kept for a day so the chosen rows import without paying again.
 */
export async function searchApollo(actor: Actor, input: { side: Side; target: "people" | "organizations"; region: string; city?: string | null; professionCode?: string; page?: number }) {
  requireAdmin(actor);
  const s = await getSettings();
  const region = validRegion(input.region);
  const professionCode = input.professionCode || "DC";
  const page = Math.max(1, Math.min(500, input.page ?? 1));
  const orgSearch = input.side === "DEMAND" && input.target === "organizations";
  const credits = orgSearch ? estimateApolloCredits({ organizationSearchPages: 1 }, s["growth.apollo.creditCosts"]) : 0;
  const gate = await apolloGate(credits, true, s);
  if (!gate.ok) throw new DomainError("VALIDATION", BUDGET_TEXT[gate.reason!] ?? gate.reason!);
  const meta: Meta = { operation: orgSearch ? "organization_search" : "people_search", task: "admin_search", side: input.side, region, createdById: actor.userId };
  const p = apolloProvider();
  const titles = input.side === "SUPPLY" ? (s["growth.apollo.supplyTitles"][professionCode] ?? []) : s["growth.apollo.demandTitles"];
  if (!orgSearch && !titles.length) throw new DomainError("VALIDATION", "Add job titles for this profession in Growth settings (Apollo.io).");
  const keywords = s["growth.apollo.demandKeywords"][professionCode] ?? [];
  const params = orgSearch
    ? apolloOrganizationSearchBody({ region, city: input.city, keywords, page, perPage: 25 })
    : apolloSearchBody(input.side, { region, city: input.city, titles, keywords, page, perPage: 25 });
  const res = await call(meta, credits, () => (orgSearch ? p.searchOrganizations(params) : p.searchPeople(params)), (r) => r.items.length);
  const rows: Row[] = [];
  for (const raw of res.items) {
    let base: Omit<Row, "duplicate"> | null = null;
    if (orgSearch) {
      const o = mapApolloOrganization(raw);
      if (o) base = { key: o.apolloOrganizationId, kind: "organization", organization: o };
    } else {
      const pr = mapApolloPerson(raw);
      if (pr) base = { key: pr.apolloPersonId, kind: "person", person: pr };
    }
    if (!base) continue;
    if (base.person && input.side === "DEMAND" && !isDecisionMakerTitle(base.person.title)) continue;
    rows.push({ ...base, duplicate: await duplicateNote(base) });
  }
  const search = await prisma.prospectSearch.create({
    data: { source: "apollo", side: input.side, region, city: input.city?.trim() || null, professionCode, params: params as Prisma.InputJsonValue, results: rows as unknown as Prisma.InputJsonValue, total: res.total, creditsEstimated: credits, createdById: actor.userId, expiresAt: new Date(+clock.now() + SEARCH_TTL_MS) },
  });
  return { id: search.id, rows, total: res.total, page, credits };
}

export async function prospectSearch(actor: Actor, id: string) {
  requireAdmin(actor);
  const row = await prisma.prospectSearch.findUnique({ where: { id } });
  if (!row || row.expiresAt < clock.now()) return null;
  return { ...row, rows: row.results as unknown as Row[] };
}

/** Credits an import of these rows would use (enrichment only; the search itself is already paid). */
export async function importEstimate(rows: number, enrich: boolean) {
  const s = await getSettings();
  return enrich ? estimateApolloCredits({ personEnrich: rows }, s["growth.apollo.creditCosts"]) : 0;
}

/** Enrich up to 10 Apollo people at a time (names + verified emails). */
async function enrichPeople(people: ApolloPerson[], meta: Meta, s: Settings): Promise<Map<string, ApolloPerson>> {
  const out = new Map<string, ApolloPerson>();
  const per = s["growth.apollo.creditCosts"].personEnrich;
  for (let i = 0; i < people.length; i += 10) {
    const chunk = people.slice(i, i + 10);
    const matches = await call({ ...meta, operation: "person_enrich" }, chunk.length * per, () => apolloProvider().enrichPeople(chunk.map((p) => ({ id: p.apolloPersonId }))), (m) => m.length);
    for (const raw of matches) {
      const m = mapApolloPerson(raw as ApolloRaw);
      if (m) out.set(m.apolloPersonId, { ...m, region: m.region ?? chunk.find((c) => c.apolloPersonId === m.apolloPersonId)?.region ?? null });
    }
  }
  return out;
}

/** Import the chosen rows of a search into the CRM, optionally enriching people first (credits; large jobs need approval). */
export async function importApolloSearch(actor: Actor, searchId: string, keys: string[], opts: { enrich: boolean; approved: boolean }) {
  requireAdmin(actor);
  const search = await prospectSearch(actor, searchId);
  if (!search) throw new DomainError("VALIDATION", "That search has expired. Search again.");
  const chosen = search.rows.filter((r) => keys.includes(r.key));
  if (!chosen.length) throw new DomainError("VALIDATION", "Tick at least one row to import.");
  const s = await getSettings();
  const people = chosen.filter((r) => r.person).map((r) => r.person!);
  const credits = opts.enrich ? estimateApolloCredits({ personEnrich: people.length }, s["growth.apollo.creditCosts"]) : 0;
  if (credits) {
    const gate = await apolloGate(credits, opts.approved, s);
    if (!gate.ok) throw new DomainError("VALIDATION", BUDGET_TEXT[gate.reason!] ?? gate.reason!);
  }
  const meta: Meta = { operation: "person_enrich", task: "admin_import", side: search.side as Side, region: search.region, createdById: actor.userId };
  const enriched = credits ? await enrichPeople(people, meta, s) : new Map<string, ApolloPerson>();
  const out = { inserted: 0, updated: 0, onPlatform: 0, skipped: 0, withEmail: 0 };
  for (const r of chosen) {
    let res: UpsertResult;
    if (r.organization) res = await upsertApolloClinicProspect(r.organization, null, search.professionCode, s);
    else {
      const person = enriched.get(r.person!.apolloPersonId) ?? r.person!;
      if (enriched.has(person.apolloPersonId) && usableApolloEmail(person, s["growth.apollo.allowLikelyEmails"])) out.withEmail++;
      if (search.side === "SUPPLY") res = await upsertApolloProviderProspect(person, search.professionCode, s);
      else {
        const org: ApolloOrganization = { apolloOrganizationId: person.apolloOrganizationId ?? `person-${person.apolloPersonId}`, name: person.organizationName ?? "Clinic", website: person.organizationDomain ? `https://${person.organizationDomain}` : null, domain: person.organizationDomain, phone: null, address: null, city: person.city, region: person.region ?? search.region, zip: null };
        res = person.apolloOrganizationId ? await upsertApolloClinicProspect(org, person, search.professionCode, s) : "skipped";
      }
      if (enriched.has(person.apolloPersonId)) await markEnriched(search.side as Side, person, s);
    }
    out[res === "on_platform" ? "onPlatform" : res]++;
  }
  await logAgent("clinicProspecting", "apollo_import", { humanOverrideBy: actor.userId, output: { search: searchId, side: search.side, region: search.region, ...out, credits } });
  await audit(prisma, actor, "growth.apollo.import", "ProspectSearch", searchId, null, { ...out, credits });
  return { ...out, credits };
}

async function markEnriched(side: Side, p: ApolloPerson, s: Settings) {
  const per = s["growth.apollo.creditCosts"].personEnrich;
  if (side === "SUPPLY") await prisma.providerProspect.updateMany({ where: { apolloPersonId: p.apolloPersonId }, data: { enrichmentStatus: "DONE", enrichmentCredits: { increment: per } } });
  else if (p.apolloOrganizationId) await prisma.clinicProspect.updateMany({ where: { apolloOrganizationId: p.apolloOrganizationId }, data: { enrichmentStatus: "DONE", enrichmentCredits: { increment: per } } });
}

// ---------------- agents: scheduled discovery + enrichment ----------------

type Cursor = Record<string, number>;
async function cursor(): Promise<Cursor> {
  return ((await prisma.setting.findUnique({ where: { key: CURSOR_KEY } }))?.value as Cursor | undefined) ?? {};
}
async function saveCursor(c: Cursor) {
  const value = c as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({ where: { key: CURSOR_KEY }, create: { key: CURSOR_KEY, value }, update: { value } });
}

/**
 * Automatic discovery (job growthProspecting, when growth.apollo.autoDiscovery is on): free people
 * searches in Prelaunch/Live markets, split between providers and clinic decision-makers by each
 * market's acquisition priority (core sideSplit), next page each run. Imported without enrichment;
 * the enrichment sweep spends credits later, priority markets first.
 */
export async function apolloDiscoverySweep(opts: { states?: string[] } = {}) {
  const s = await getSettings();
  const out = { searches: 0, inserted: 0, updated: 0, skipped: 0, stopped: null as string | null };
  if (!s["growth.apollo.enabled"] || !s["growth.apollo.autoDiscovery"]) return { ...out, stopped: "off" };
  const gate = await apolloGate(0, false, s);
  if (!gate.ok) return { ...out, stopped: gate.reason };
  const targets = (await activeTargets()).filter((t) => !opts.states || opts.states.includes(t.state));
  if (!targets.length) return out;
  const ctx = await priorityContext();
  const n = s["growth.apollo.searchesPerRun"];
  const cur = await cursor();
  // Each target asks for a slot on each side; the market's primary side gets primarySideShare of them.
  // pos spreads each side's slots over the run in proportion to its share (primary side wins ties), so
  // a 70/30 split really sends about 7 of 10 searches to the primary side.
  const jobs: { professionCode: string; state: string; side: Side; city: string | null; key: string; at: number; pos: number; primary: boolean }[] = [];
  for (const t of targets) {
    const primary = ctx.resolve(t.state).primary;
    const split = sideSplit(4, primary, ctx.share);
    const cities = t.cities.length ? t.cities : [null];
    for (const side of ["SUPPLY", "DEMAND"] as Side[]) {
      for (let i = 0; i < split[side]; i++) {
        const city = cities[i % cities.length] ?? null;
        const key = `${t.professionCode}:${t.state}:${side}:${city ?? "*"}`;
        jobs.push({ professionCode: t.professionCode, state: t.state, side, city, key, at: cur[`${key}:at`] ?? 0, pos: (i + 0.5) / split[side], primary: side === primary });
      }
    }
  }
  jobs.sort((a, b) => a.at - b.at || a.pos - b.pos || Number(b.primary) - Number(a.primary));
  const seen = new Set<string>();
  for (const j of jobs) {
    if (out.searches >= n) break;
    if (seen.has(j.key)) continue;
    seen.add(j.key);
    const titles = j.side === "SUPPLY" ? (s["growth.apollo.supplyTitles"][j.professionCode] ?? []) : s["growth.apollo.demandTitles"];
    if (!titles.length) continue;
    const page = (cur[j.key] ?? 0) + 1;
    try {
      const body = apolloSearchBody(j.side, { region: j.state, city: j.city, titles, keywords: s["growth.apollo.demandKeywords"][j.professionCode] ?? [], page, perPage: 25 });
      const res = await call({ operation: "people_search", task: "apolloDiscovery", side: j.side, region: j.state }, 0, () => apolloProvider().searchPeople(body), (r) => r.items.length);
      out.searches++;
      for (const raw of res.items) {
        const p = mapApolloPerson(raw);
        if (!p) continue;
        const person = { ...p, region: p.region ?? j.state };
        let r: UpsertResult = "skipped";
        if (j.side === "SUPPLY") r = await upsertApolloProviderProspect(person, j.professionCode, s);
        else if (isDecisionMakerTitle(person.title) && person.apolloOrganizationId) {
          r = await upsertApolloClinicProspect({ apolloOrganizationId: person.apolloOrganizationId, name: person.organizationName ?? "Clinic", website: person.organizationDomain ? `https://${person.organizationDomain}` : null, domain: person.organizationDomain, phone: null, address: null, city: person.city, region: person.region, zip: null }, person, j.professionCode, s);
        }
        if (r === "inserted") out.inserted++;
        else if (r === "updated") out.updated++;
        else out.skipped++;
      }
      // Past the last page: start again from the top later (rediscovery picks up new people).
      cur[j.key] = res.items.length < 25 ? 0 : page;
      cur[`${j.key}:at`] = +clock.now();
    } catch (e) {
      out.stopped = e instanceof ApolloError ? e.kind : "error";
      break;
    }
  }
  await saveCursor(cur);
  if (out.searches) await logAgent("clinicProspecting", "apollo_discovery", { output: out });
  return out;
}

/**
 * Enrichment (credits): reveal a verified email for prospects that still have none, primary-side
 * markets first and split by growth.primarySideShare. Never enriches the same record twice
 * (enrichmentStatus), anyone on the platform, do-not-contact, or prospects outside active markets.
 */
export async function apolloEnrichmentSweep(limit = 10) {
  const s = await getSettings();
  const out = { providers: 0, clinics: 0, emails: 0, stopped: null as string | null };
  if (!s["growth.apollo.enabled"] || !s["growth.apollo.contactEnrichment"]) return { ...out, stopped: "off" };
  const per = s["growth.apollo.creditCosts"].personEnrich;
  const pairs = (await activeTargets()).map((t) => ({ professionCode: t.professionCode, state: t.state }));
  if (!pairs.length || !per) return out;
  const ctx = await priorityContext();
  const providers = await prisma.providerProspect.findMany({
    where: { apolloPersonId: { not: null }, enrichmentStatus: "NONE", providerId: null, doNotContact: false, contactStatus: { in: ["NONE", "INVALID"] }, OR: pairs },
    select: { id: true, apolloPersonId: true, state: true, marketKey: true, createdAt: true }, take: 200,
  });
  const clinics = await prisma.clinicProspect.findMany({
    where: { apolloPersonId: { not: null }, enrichmentStatus: "NONE", clinicOrgId: null, doNotContact: false, email: null, state: { in: [...new Set(pairs.map((p) => p.state))] } },
    select: { id: true, apolloPersonId: true, state: true, marketKey: true, createdAt: true }, take: 200,
  });
  // Primary-side records first, oldest first; split the run between the sides.
  const order = <T extends { state: string; marketKey: string | null; createdAt: Date }>(rows: T[], side: Side) => rows.sort((a, b) => ctx.rank(side, a.state, a.marketKey) - ctx.rank(side, b.state, b.marketKey) || +a.createdAt - +b.createdAt);
  const supplyFirst = providers.filter((p) => ctx.resolve(p.state, p.marketKey).primary === "SUPPLY").length >= clinics.filter((c) => ctx.resolve(c.state, c.marketKey).primary === "DEMAND").length;
  const split = sideSplit(limit, supplyFirst ? "SUPPLY" : "DEMAND", ctx.share);
  const pickP = order(providers, "SUPPLY").slice(0, split.SUPPLY + Math.max(0, split.DEMAND - clinics.length));
  const pickC = order(clinics, "DEMAND").slice(0, split.DEMAND + Math.max(0, split.SUPPLY - providers.length));
  const gate = await apolloGate((pickP.length + pickC.length) * per, true, s);
  if (!gate.ok) return { ...out, stopped: gate.reason };
  const go = async (side: Side, rows: { id: string; apolloPersonId: string | null; state: string; marketKey: string | null }[]) => {
    if (!rows.length) return;
    const enriched = await enrichPeople(rows.map((r) => ({ apolloPersonId: r.apolloPersonId!, region: r.state } as ApolloPerson)), { operation: "person_enrich", task: "apolloEnrichment", side, region: null }, s);
    for (const r of rows) {
      const p = enriched.get(r.apolloPersonId!);
      if (side === "SUPPLY") {
        await prisma.providerProspect.update({ where: { id: r.id }, data: { enrichmentStatus: p ? "DONE" : "NO_MATCH", enrichmentCredits: { increment: per } } });
        out.providers++;
        if (p) {
          if (p.lastName) await prisma.providerProspect.update({ where: { id: r.id }, data: { firstName: p.firstName, lastName: p.lastName, displayName: displayName(p), ...(p.title ? { title: p.title } : {}) } });
          const email = usableApolloEmail(p, s["growth.apollo.allowLikelyEmails"]);
          if (email && !(await onPlatformByEmail(email)) && (await useProviderEmail(r.id, email))) out.emails++;
        }
      } else {
        await prisma.clinicProspect.update({ where: { id: r.id }, data: { enrichmentStatus: p ? "DONE" : "NO_MATCH", enrichmentCredits: { increment: per } } });
        out.clinics++;
        if (p) {
          const c = await prisma.clinicProspect.findUniqueOrThrow({ where: { id: r.id } });
          await useClinicContact(c, p, s);
          if ((await prisma.clinicProspect.findUniqueOrThrow({ where: { id: r.id }, select: { email: true } })).email) out.emails++;
        }
      }
    }
  };
  try {
    await go("SUPPLY", pickP);
    await go("DEMAND", pickC);
  } catch (e) {
    out.stopped = e instanceof ApolloError ? e.kind : "error";
  }
  if (out.providers || out.clinics) await logAgent("contactDiscovery", "apollo_enrichment", { output: out });
  return out;
}

/** Old searches are removed after a day. */
export async function cleanupProspectSearches() {
  return (await prisma.prospectSearch.deleteMany({ where: { expiresAt: { lt: clock.now() } } })).count;
}
