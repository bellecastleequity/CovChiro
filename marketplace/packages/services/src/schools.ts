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

// ---------------- Public school pages (owner request Oct 2026: SEO for students and alumni) ----------------

/** Short names and web addresses for the chiropractic school pages (/chiropractic-students/<slug>). */
const DC_SCHOOL_PAGES: Record<string, { slug: string; short: string }> = {
  "Cleveland University–Kansas City": { slug: "cleveland-university-kansas-city", short: "Cleveland University–Kansas City" },
  "D'Youville University (Chiropractic)": { slug: "dyouville-university", short: "D'Youville" },
  "Keiser University College of Chiropractic Medicine": { slug: "keiser-university", short: "Keiser University" },
  "Life Chiropractic College West": { slug: "life-chiropractic-college-west", short: "Life West" },
  "Life University": { slug: "life-university", short: "Life University" },
  "Logan University": { slug: "logan-university", short: "Logan University" },
  "National University of Health Sciences (Illinois)": { slug: "nuhs-illinois", short: "National University (Illinois)" },
  "National University of Health Sciences (Florida)": { slug: "nuhs-florida", short: "National University (Florida)" },
  "Northeast College of Health Sciences": { slug: "northeast-college", short: "Northeast College" },
  "Northwestern Health Sciences University": { slug: "northwestern-health-sciences", short: "Northwestern Health Sciences" },
  "Palmer College of Chiropractic (Davenport)": { slug: "palmer-davenport", short: "Palmer Davenport" },
  "Palmer College of Chiropractic (Florida)": { slug: "palmer-florida", short: "Palmer Florida" },
  "Palmer College of Chiropractic (West)": { slug: "palmer-west", short: "Palmer West" },
  "Parker University": { slug: "parker-university", short: "Parker University" },
  "Sherman College of Chiropractic": { slug: "sherman-college", short: "Sherman College" },
  "Southern California University of Health Sciences": { slug: "scuhs", short: "SCU Health Sciences" },
  "Texas Chiropractic College": { slug: "texas-chiropractic-college", short: "Texas Chiropractic College" },
  "University of Western States": { slug: "university-of-western-states", short: "University of Western States" },
};

export interface SchoolPage { slug: string; name: string; short: string; city: string; state: string }

/** Every chiropractic school with a public page (built-in list; no database needed). */
export function schoolPages(): SchoolPage[] {
  return (SCHOOL_CATALOG.DC ?? []).flatMap((s) => {
    const p = DC_SCHOOL_PAGES[s.name];
    return p ? [{ ...s, ...p }] : [];
  });
}

export function schoolPage(slug: string): SchoolPage | null {
  return schoolPages().find((s) => s.slug === slug) ?? null;
}
