import { DomainError } from "@cm/core";
import { prisma } from "@cm/db";
import { audit, requireAdmin, type Actor } from "./context";

/**
 * Built-in school lists, added when a profession goes active (or into Growth prelaunch).
 * Chiropractic: CCE-accredited US programs. Other professions have hundreds of programs,
 * so admins add the ones that matter for the markets being opened (Admin → Schools).
 */
export const SCHOOL_CATALOG: Record<string, { name: string; city: string; state: string }[]> = {
  DC: [
    { name: "Cleveland University–Kansas City", city: "Overland Park", state: "KS" },
    { name: "D'Youville University (Chiropractic)", city: "Buffalo", state: "NY" },
    { name: "Keiser University College of Chiropractic Medicine", city: "West Palm Beach", state: "FL" },
    { name: "Life Chiropractic College West", city: "Hayward", state: "CA" },
    { name: "Life University", city: "Marietta", state: "GA" },
    { name: "Logan University", city: "Chesterfield", state: "MO" },
    { name: "National University of Health Sciences (Illinois)", city: "Lombard", state: "IL" },
    { name: "National University of Health Sciences (Florida)", city: "Pinellas Park", state: "FL" },
    { name: "Northeast College of Health Sciences", city: "Seneca Falls", state: "NY" },
    { name: "Northwestern Health Sciences University", city: "Bloomington", state: "MN" },
    { name: "Palmer College of Chiropractic (Davenport)", city: "Davenport", state: "IA" },
    { name: "Palmer College of Chiropractic (Florida)", city: "Port Orange", state: "FL" },
    { name: "Palmer College of Chiropractic (West)", city: "San Jose", state: "CA" },
    { name: "Parker University", city: "Dallas", state: "TX" },
    { name: "Sherman College of Chiropractic", city: "Spartanburg", state: "SC" },
    { name: "Southern California University of Health Sciences", city: "Whittier", state: "CA" },
    { name: "Texas Chiropractic College", city: "Pasadena", state: "TX" },
    { name: "University of Western States", city: "Portland", state: "OR" },
  ],
};

/** Adds the built-in list for these professions (insert-if-missing; never re-activates a school an admin hid). */
export async function ensureSchools(professionCodes: string[]) {
  let added = 0;
  for (const code of professionCodes) {
    const list = SCHOOL_CATALOG[code] ?? [];
    if (!list.length) continue;
    const r = await prisma.school.createMany({ data: list.map((s) => ({ professionCode: code, ...s })), skipDuplicates: true });
    added += r.count;
  }
  return added;
}

/** Active schools for the sign-up dropdown, for active professions (plus any extra codes, e.g. a prelaunch market). */
export async function schoolOptions(extraProfessionCodes: string[] = []) {
  const professions = await prisma.profession.findMany({ where: { OR: [{ active: true }, { code: { in: extraProfessionCodes } }] }, orderBy: { sortOrder: "asc" } });
  const codes = professions.map((p) => p.code);
  const schools = await prisma.school.findMany({ where: { active: true, professionCode: { in: codes } }, orderBy: { name: "asc" } });
  return professions
    .map((p) => ({ professionCode: p.code, label: p.displayName, schools: schools.filter((s) => s.professionCode === p.code).map((s) => ({ name: s.name, city: s.city, state: s.state })) }))
    .filter((g) => g.schools.length);
}

export async function adminSchools(actor: Actor) {
  requireAdmin(actor);
  const [professions, schools] = await Promise.all([
    prisma.profession.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.school.findMany({ orderBy: [{ professionCode: "asc" }, { name: "asc" }] }),
  ]);
  return { professions, schools, catalog: Object.fromEntries(Object.entries(SCHOOL_CATALOG).map(([k, v]) => [k, v.length])) };
}

export async function addSchool(actor: Actor, input: { professionCode: string; name: string; city?: string | null; state?: string | null }) {
  requireAdmin(actor);
  const name = input.name.trim();
  if (name.length < 3) throw new DomainError("VALIDATION", "Enter the school's name.");
  const state = input.state?.trim().toUpperCase() || null;
  if (state && !/^[A-Z]{2}$/.test(state)) throw new DomainError("VALIDATION", "Use a two-letter state code.");
  await prisma.profession.findUniqueOrThrow({ where: { code: input.professionCode } });
  const s = await prisma.school.upsert({
    where: { professionCode_name: { professionCode: input.professionCode, name } },
    create: { professionCode: input.professionCode, name, city: input.city?.trim() || null, state },
    update: { active: true, city: input.city?.trim() || null, state },
  });
  await audit(prisma, actor, "school.added", "School", s.id, null, { name, professionCode: input.professionCode });
}

export async function setSchoolActive(actor: Actor, id: string, active: boolean) {
  requireAdmin(actor);
  await prisma.school.update({ where: { id }, data: { active } });
  await audit(prisma, actor, active ? "school.shown" : "school.hidden", "School", id, null, { active });
}
