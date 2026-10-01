import { CHIROPRACTIC_PROFILE, DomainError, US_STATES, type RegistryProfile } from "@cm/core";
import { prisma, type GrowthTarget } from "@cm/db";
import { geoProvider } from "@cm/integrations";
import { audit, requireAdmin, type Actor } from "../context";
import { ensureSchools } from "../schools";
import { STATE_CITIES } from "./cities";
import { livePrompts } from "./engine";

/**
 * Growth expansion: which profession × state markets the growth agents work on.
 *   OFF        nothing
 *   PRELAUNCH  registry discovery + web research of practices; provider welcome,
 *              credential and activation emails. No clinic outreach.
 *   LIVE       clinic outreach too — but only while the marketplace has the profession
 *              enabled in that state (StateConfig + ProfessionStateConfig). A LIVE target
 *              with the marketplace off behaves as PRELAUNCH.
 * A profession only gets messages written for it (or written for any profession): with no
 * approved prompts of its own, its people are skipped, never sent chiropractic wording.
 */
export type TargetStatus = "OFF" | "PRELAUNCH" | "LIVE";
export const TARGET_STATUSES: TargetStatus[] = ["OFF", "PRELAUNCH", "LIVE"];

/** Message keys a profession needs before each kind of growth email can go out. */
export const PROVIDER_PROMPT_KEYS = ["PROVIDER_WELCOME", "PROVIDER_LICENSE_REMINDER", "PROVIDER_MALPRACTICE_REMINDER", "PROVIDER_COVERAGE_READY", "PROVIDER_REACTIVATION"];
export const OUTREACH_PROMPT_KEYS = ["CLINIC_FIRST_CONTACT", "CLINIC_VACATION_EDUCATION", "CLINIC_SICK_DAY_EDUCATION"];
export const RECRUITMENT_PROMPT_KEYS = ["PROVIDER_RECRUIT_FIRST_CONTACT", "PROVIDER_RECRUIT_FOLLOW_UP"];

export async function activeTargets(statuses: TargetStatus[] = ["PRELAUNCH", "LIVE"]) {
  return prisma.growthTarget.findMany({ where: { status: { in: statuses } }, orderBy: [{ createdAt: "asc" }] });
}

/** The market reports and the planning views center on: the first LIVE target (else the first prelaunch one, else FL chiropractic). */
export async function primaryTarget(): Promise<{ professionCode: string; state: string }> {
  const t = (await activeTargets(["LIVE"]))[0] ?? (await activeTargets(["PRELAUNCH"]))[0];
  return t ? { professionCode: t.professionCode, state: t.state } : { professionCode: "DC", state: "FL" };
}

/** Registry profile for a profession (DC's built-in one when there's no row). */
export async function registryProfile(professionCode: string): Promise<RegistryProfile & { registrySearch: string }> {
  const g = await prisma.growthProfession.findUnique({ where: { professionCode } });
  if (!g) return professionCode === "DC" ? { ...CHIROPRACTIC_PROFILE, registrySearch: "Chiropractor" } : { taxonomyCodes: [], nameSuffix: "", practiceNoun: "practice", registrySearch: "" };
  return { taxonomyCodes: g.taxonomyCodes, nameSuffix: g.nameSuffix, practiceNoun: g.practiceNoun, registrySearch: g.registrySearch };
}

/** The marketplace accepts shifts for this profession in this state. */
export async function marketplaceOpen(professionCode: string, state: string) {
  const [st, psc] = await Promise.all([
    prisma.stateConfig.findUnique({ where: { state } }),
    prisma.professionStateConfig.findUnique({ where: { professionCode_state: { professionCode, state } } }),
  ]);
  return !!st?.enabled && !!psc?.enabled;
}

/**
 * Safety rule for clinic outreach: a LIVE growth target AND the marketplace enabled for that
 * profession in that state. Checked for every prospect, every run.
 */
export async function outreachAllowed(professionCode: string, state: string | null) {
  if (!state) return false;
  const t = await prisma.growthTarget.findUnique({ where: { professionCode_state: { professionCode, state } } });
  return t?.status === "LIVE" && (await marketplaceOpen(professionCode, state));
}

/** Which profession an outreach email to this prospect is about (first allowed one), or null = don't contact. */
export async function outreachProfessionFor(p: { professionCodes: string[]; state: string | null }, cache = new Map<string, boolean>()) {
  for (const code of p.professionCodes.length ? p.professionCodes : ["DC"]) {
    const k = `${code}|${p.state}`;
    if (!cache.has(k)) cache.set(k, await outreachAllowed(code, p.state));
    if (cache.get(k)) return code;
  }
  return null;
}

/**
 * The growth market a provider belongs to (messaging only — never eligibility): one of their
 * professions with an active target in a state they're licensed in, live in or plan to work in;
 * else that profession's first active target.
 */
export function providerTargetFrom(
  p: { professions: string[]; licenseStates: string[]; homeState: string | null; intendedStates: string[] },
  targets: Pick<GrowthTarget, "professionCode" | "state" | "status">[],
) {
  const states = [...new Set([...p.licenseStates, ...(p.homeState ? [p.homeState] : []), ...p.intendedStates])];
  const active = targets.filter((t) => t.status === "PRELAUNCH" || t.status === "LIVE");
  for (const prof of p.professions) {
    for (const st of states) {
      const t = active.find((x) => x.professionCode === prof && x.state === st);
      if (t) return t;
    }
  }
  for (const prof of p.professions) {
    const t = active.find((x) => x.professionCode === prof);
    if (t) return t;
  }
  return null;
}

/** Keys with an approved, active version usable for this profession. */
export async function promptReadiness(professionCode: string) {
  const ready = async (keys: string[]) => {
    const missing: string[] = [];
    for (const k of keys) if (!(await livePrompts(k, professionCode)).length) missing.push(k);
    return missing;
  };
  return { providerMissing: await ready(PROVIDER_PROMPT_KEYS), outreachMissing: await ready(OUTREACH_PROMPT_KEYS), recruitmentMissing: await ready(RECRUITMENT_PROMPT_KEYS) };
}

// ---------------- admin ----------------

export async function expansionOverview(actor: Actor) {
  requireAdmin(actor);
  const [professions, targets, configs, states, gp, prospects, researched, withEmail, providers] = await Promise.all([
    prisma.profession.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.growthTarget.findMany(),
    prisma.professionStateConfig.findMany({ where: { enabled: true }, select: { professionCode: true, state: true } }),
    prisma.stateConfig.findMany({ where: { enabled: true }, select: { state: true } }),
    prisma.growthProfession.findMany(),
    prisma.$queryRaw<{ code: string; state: string; n: bigint }[]>`SELECT unnest("professionCodes") AS code, "state"::text AS state, count(*) AS n FROM "ClinicProspect" GROUP BY 1, 2`,
    prisma.$queryRaw<{ code: string; state: string; n: bigint }[]>`SELECT unnest("professionCodes") AS code, "state"::text AS state, count(*) AS n FROM "ClinicProspect" WHERE "researchStatus" IN ('DONE', 'NOT_FOUND') GROUP BY 1, 2`,
    prisma.$queryRaw<{ code: string; state: string; n: bigint }[]>`SELECT unnest("professionCodes") AS code, "state"::text AS state, count(*) AS n FROM "ClinicProspect" WHERE "email" IS NOT NULL GROUP BY 1, 2`,
    prisma.$queryRaw<{ code: string; state: string; n: bigint }[]>`SELECT pp."professionCode"::text AS code, COALESCE(p."homeState", '')::text AS state, count(*) AS n FROM "ProviderProfession" pp JOIN "Provider" p ON p.id = pp."providerId" WHERE p.status NOT IN ('SUSPENDED', 'DEACTIVATED') GROUP BY 1, 2`,
  ]);
  const count = (rows: { code: string; state: string; n: bigint }[]) => new Map(rows.map((r) => [`${r.code}|${r.state}`, Number(r.n)]));
  const [pc, rc, ec, prc] = [count(prospects), count(researched), count(withEmail), count(providers)];
  const open = new Set(configs.filter((c) => states.some((s) => s.state === c.state)).map((c) => `${c.professionCode}|${c.state}`));
  const readiness = new Map<string, Awaited<ReturnType<typeof promptReadiness>>>();
  for (const p of professions) readiness.set(p.code, await promptReadiness(p.code));
  const schoolCounts = new Map((await prisma.school.groupBy({ by: ["professionCode"], where: { active: true }, _count: { _all: true } })).map((r) => [r.professionCode, r._count._all]));
  return {
    professions: professions.map((p) => {
      const g = gp.find((x) => x.professionCode === p.code);
      return {
        code: p.code, displayName: p.displayName, active: p.active,
        registrySearch: g?.registrySearch ?? (p.code === "DC" ? "Chiropractor" : ""), taxonomyCodes: g?.taxonomyCodes ?? (p.code === "DC" ? ["111N"] : []),
        practiceNoun: g?.practiceNoun ?? "practice", nameSuffix: g?.nameSuffix ?? "",
        readiness: readiness.get(p.code)!, schools: schoolCounts.get(p.code) ?? 0,
      };
    }),
    targets: targets.map((t) => ({
      ...t,
      marketplaceOpen: open.has(`${t.professionCode}|${t.state}`),
      prospects: pc.get(`${t.professionCode}|${t.state}`) ?? 0,
      researched: rc.get(`${t.professionCode}|${t.state}`) ?? 0,
      withEmail: ec.get(`${t.professionCode}|${t.state}`) ?? 0,
      providers: prc.get(`${t.professionCode}|${t.state}`) ?? 0,
    })),
    open: [...open],
    states: Object.entries(US_STATES).map(([code, name]) => ({ code, name, starterCities: STATE_CITIES[code]?.length ?? 0 })),
  };
}

/**
 * Supply & demand markets for a newly opened profession × state: the first few cities on its
 * list become metros (geocoded centers, 35-mile radius). Existing markets are left alone.
 */
export async function ensureMarkets(professionCode: string, state: string, cities: string[], n = 6) {
  if (await prisma.growthMarket.count({ where: { professionCode, state } })) return 0;
  let made = 0;
  for (const [i, city] of cities.slice(0, n).entries()) {
    const g = await geoProvider().geocode(`${city}, ${state}`).catch(() => null);
    if (!g) continue;
    const key = `${professionCode}-${state}-${city}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    await prisma.growthMarket.upsert({
      where: { key },
      create: { key, name: `${city}, ${state}`, state, professionCode, centerLat: g.lat, centerLng: g.lng, radiusMiles: 35, targetProviders: 3, priority: 100 + i },
      update: {},
    });
    made++;
  }
  return made;
}

const cleanCities = (cities: string[]) => [...new Set(cities.map((c) => c.trim().replace(/\s+/g, " ")).filter((c) => c.length >= 2 && c.length <= 60))].slice(0, 500);

export async function setTargetStatus(actor: Actor, professionCode: string, state: string, status: TargetStatus) {
  requireAdmin(actor);
  if (!TARGET_STATUSES.includes(status)) throw new DomainError("VALIDATION", "Unknown status.");
  state = state.toUpperCase();
  if (!US_STATES[state]) throw new DomainError("VALIDATION", "Unknown state.");
  const profession = await prisma.profession.findUnique({ where: { code: professionCode } });
  if (!profession) throw new DomainError("VALIDATION", "Unknown profession.");
  if (status === "LIVE") {
    if (!(await marketplaceOpen(professionCode, state))) {
      throw new DomainError("VALIDATION", `Turn on ${profession.displayName} in ${state} under States & professions first. Clinic outreach only runs where clinics can actually post shifts.`);
    }
    const { outreachMissing } = await promptReadiness(professionCode);
    if (outreachMissing.length) throw new DomainError("VALIDATION", `Approve and activate the clinic outreach emails for ${profession.displayName} first (missing: ${outreachMissing.join(", ")}). Use "Create starter drafts" below.`);
  }
  const before = await prisma.growthTarget.findUnique({ where: { professionCode_state: { professionCode, state } } });
  const cities = before?.cities.length ? before.cities : status !== "OFF" ? (STATE_CITIES[state] ?? []) : [];
  const row = await prisma.growthTarget.upsert({
    where: { professionCode_state: { professionCode, state } },
    create: { professionCode, state, status, cities, statusChangedAt: new Date() },
    update: { status, cities, ...(before?.status !== status ? { statusChangedAt: new Date() } : {}) },
  });
  if (status !== "OFF") {
    await ensureSchools([professionCode]);
    await ensureMarkets(professionCode, state, cities).catch((e) => console.error("market setup failed", e));
  }
  await audit(prisma, actor, "growth.target.status", "GrowthTarget", row.id, { status: before?.status ?? "OFF" }, { professionCode, state, status });
  return row;
}

export async function saveTargetCities(actor: Actor, professionCode: string, state: string, cities: string[], notes?: string | null) {
  requireAdmin(actor);
  state = state.toUpperCase();
  const list = cleanCities(cities);
  const row = await prisma.growthTarget.upsert({
    where: { professionCode_state: { professionCode, state } },
    create: { professionCode, state, status: "OFF", cities: list, notes: notes ?? null },
    update: { cities: list, ...(notes !== undefined ? { notes } : {}) },
  });
  await audit(prisma, actor, "growth.target.cities", "GrowthTarget", row.id, null, { count: list.length });
  return row;
}

export async function saveGrowthProfession(actor: Actor, input: { professionCode: string; registrySearch: string; taxonomyCodes: string[]; practiceNoun: string; nameSuffix: string }) {
  requireAdmin(actor);
  await prisma.profession.findUniqueOrThrow({ where: { code: input.professionCode } });
  const codes = [...new Set(input.taxonomyCodes.map((c) => c.trim().toUpperCase()).filter((c) => /^[0-9A-Z]{2,10}$/.test(c)))];
  if (input.registrySearch.trim() && !codes.length) throw new DomainError("VALIDATION", "Add at least one NPI taxonomy code prefix (e.g. 2251 for physical therapists).");
  const data = { registrySearch: input.registrySearch.trim().slice(0, 80), taxonomyCodes: codes, practiceNoun: input.practiceNoun.trim().slice(0, 60) || "practice", nameSuffix: input.nameSuffix.trim().slice(0, 12) };
  await prisma.growthProfession.upsert({ where: { professionCode: input.professionCode }, create: { professionCode: input.professionCode, ...data }, update: data });
  await audit(prisma, actor, "growth.profession.saved", "GrowthProfession", input.professionCode, null, data);
}

/**
 * Copies the chiropractic versions of the provider and outreach emails as DRAFTS for another
 * profession, with the obvious words swapped. A person edits and approves them before any is sent.
 */
export async function createStarterDrafts(actor: Actor, professionCode: string) {
  requireAdmin(actor);
  if (professionCode === "DC") throw new DomainError("VALIDATION", "Chiropractic already has its emails.");
  const profession = await prisma.profession.findUniqueOrThrow({ where: { code: professionCode } });
  const g = await registryProfile(professionCode);
  const person = profession.displayName.toLowerCase();
  const swap = (t: string | null) =>
    t == null ? t : t
      .replace(/chiropractic (practices|offices|clinics)/gi, `${g.practiceNoun}s`)
      .replace(/chiropractic (practice|office|clinic)/gi, g.practiceNoun)
      .replace(/chiropractors/gi, `${person}s`)
      .replace(/chiropractor/gi, person)
      .replace(/\bDCs\b/g, `${profession.credentialSuffix}s`)
      .replace(/chiropractic/gi, person);
  let created = 0;
  for (const key of [...PROVIDER_PROMPT_KEYS, ...RECRUITMENT_PROMPT_KEYS, ...OUTREACH_PROMPT_KEYS, "CLINIC_OBJECTION_COST"]) {
    if (await prisma.promptTemplate.count({ where: { key, professionCode, status: { in: ["DRAFT", "APPROVED"] } } })) continue;
    const src = (await livePrompts(key, "DC"))[0];
    if (!src) continue;
    const last = await prisma.promptTemplate.findFirst({ where: { key }, orderBy: { version: "desc" } });
    await prisma.promptTemplate.create({
      data: {
        key, professionCode, version: (last?.version ?? 0) + 1, agent: src.agent, channel: src.channel, purpose: src.purpose, subjectTemplate: swap(src.subjectTemplate), body: swap(src.body)!,
        instructions: swap(src.instructions), allowedVars: src.allowedVars, status: "DRAFT", active: false, notes: `Starter for ${profession.displayName}, copied from chiropractic v${src.version}. Review every line before approving.`,
      },
    });
    created++;
  }
  await audit(prisma, actor, "growth.prompt.starters", "Profession", professionCode, null, { created });
  return created;
}
