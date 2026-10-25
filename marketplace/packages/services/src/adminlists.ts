import { CLINIC_GROUPS, PROVIDER_GROUPS, clinicGroup, providerGroup, providerStates, tally, type ClinicGroup, type ProviderGroup } from "@cm/core";
import { prisma } from "@cm/db";
import { clock, requireAdmin, type Actor } from "./context";

/**
 * Admin → Providers and Admin → Clinics with filters and counts (owner request Oct 2026). Every account is read
 * once with only the fields the filters need, grouped in core (adminlists.ts), then the page's rows are loaded
 * in full. Counts are for the whole list; chip counts follow the other filters that are set.
 */

const PAGE = 200;
const matchText = (q: string | undefined, ...fields: (string | null | undefined)[]) => {
  const t = (q ?? "").trim().toLowerCase();
  return !t || fields.some((f) => f?.toLowerCase().includes(t));
};

export interface ProviderFilters { q?: string; group?: string; state?: string; profession?: string; student?: string; all?: boolean }

export async function providerList(actor: Actor, f: ProviderFilters) {
  requireAdmin(actor);
  const now = clock.now();
  const base = await prisma.provider.findMany({
    select: {
      id: true, displayName: true, legalName: true, npi: true, status: true, homeState: true, preLicensure: true,
      breakStartsAt: true, breakEndsAt: true, breakReason: true, createdAt: true,
      user: { select: { email: true } }, licenses: { select: { state: true, status: true } }, professions: { select: { professionCode: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const all = base.map((p) => ({
    id: p.id, createdAt: p.createdAt, student: p.preLicensure,
    group: providerGroup(p, now), states: providerStates(p.licenses, p.homeState),
    professions: p.professions.map((x) => x.professionCode),
    text: matchText(f.q, p.displayName, p.legalName, p.user.email, p.npi),
  }));
  const keep = (p: (typeof all)[number], skip?: "group" | "state") =>
    p.text &&
    (skip === "group" || !f.group || (f.group === "student" ? p.student : p.group === f.group)) &&
    (skip === "state" || !f.state || p.states.includes(f.state)) &&
    (!f.profession || p.professions.includes(f.profession)) &&
    (f.student !== "yes" || p.student);
  const matched = all.filter((p) => keep(p));
  const forGroups = all.filter((p) => keep(p, "group"));
  const groupCounts = Object.fromEntries(PROVIDER_GROUPS.map((g) => [g.key, forGroups.filter((p) => p.group === g.key).length])) as Record<ProviderGroup, number>;
  const ids = (f.all ? matched : matched.slice(0, PAGE)).map((p) => p.id);
  const rows = await prisma.provider.findMany({
    where: { id: { in: ids } },
    include: { user: true, licenses: { where: { status: "VERIFIED" } }, stats: true, professions: true },
  });
  const order = new Map(ids.map((id, i) => [id, i]));
  rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const groupOf = new Map(all.map((p) => [p.id, p.group]));
  return {
    total: all.length,
    matched: matched.length,
    rows: rows.map((r) => ({ ...r, group: groupOf.get(r.id)! })),
    groups: PROVIDER_GROUPS.map((g) => ({ ...g, count: groupCounts[g.key] })),
    students: forGroups.filter((p) => p.student).length,
    groupTotal: forGroups.length,
    states: tally(all.filter((p) => keep(p, "state")).map((p) => p.states)),
    professions: tally(all.map((p) => p.professions)),
  };
}

export interface ClinicFilters { q?: string; group?: string; state?: string; payment?: string; verification?: string; all?: boolean }

export async function clinicList(actor: Actor, f: ClinicFilters) {
  requireAdmin(actor);
  const now = clock.now();
  const [base, posted] = await Promise.all([
    prisma.clinicOrg.findMany({
      select: {
        id: true, displayName: true, legalName: true, billingEmail: true, status: true, hasPaymentMethod: true, verificationStatus: true, phone: true,
        locations: { select: { state: true, city: true, active: true } }, members: { select: { user: { select: { email: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
    // Latest posting per location (one row each), so "active" means a shift posted recently.
    prisma.clinicLocation.findMany({
      select: { clinicOrgId: true, shifts: { where: { postedAt: { not: null } }, select: { postedAt: true }, orderBy: { postedAt: "desc" }, take: 1 } },
    }),
  ]);
  const lastPosted = new Map<string, Date>();
  for (const l of posted) {
    const at = l.shifts[0]?.postedAt;
    if (at && (!lastPosted.has(l.clinicOrgId) || +at > +lastPosted.get(l.clinicOrgId)!)) lastPosted.set(l.clinicOrgId, at);
  }
  const all = base.map((c) => ({
    id: c.id, payment: c.hasPaymentMethod, verification: c.verificationStatus,
    group: clinicGroup({ status: c.status, lastPostedAt: lastPosted.get(c.id) ?? null }, now),
    states: [...new Set(c.locations.filter((l) => l.active).map((l) => l.state))].sort(),
    text: matchText(f.q, c.displayName, c.legalName, c.billingEmail, c.phone, ...c.members.map((m) => m.user.email), ...c.locations.map((l) => l.city)),
  }));
  const keep = (c: (typeof all)[number], skip?: "group" | "state") =>
    c.text &&
    (skip === "group" || !f.group || c.group === f.group) &&
    (skip === "state" || !f.state || (f.state === "none" ? !c.states.length : c.states.includes(f.state))) &&
    (!f.payment || (f.payment === "yes") === c.payment) &&
    (!f.verification || c.verification === f.verification);
  const matched = all.filter((c) => keep(c));
  const forGroups = all.filter((c) => keep(c, "group"));
  const groupCounts = Object.fromEntries(CLINIC_GROUPS.map((g) => [g.key, forGroups.filter((c) => c.group === g.key).length])) as Record<ClinicGroup, number>;
  const ids = (f.all ? matched : matched.slice(0, PAGE)).map((c) => c.id);
  const rows = await prisma.clinicOrg.findMany({ where: { id: { in: ids } }, include: { locations: true } });
  const order = new Map(ids.map((id, i) => [id, i]));
  rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const forState = all.filter((c) => keep(c, "state"));
  return {
    total: all.length,
    matched: matched.length,
    rows: rows.map((r) => ({ ...r, group: clinicGroup({ status: r.status, lastPostedAt: lastPosted.get(r.id) ?? null }, now), lastPostedAt: lastPosted.get(r.id) ?? null })),
    groups: CLINIC_GROUPS.map((g) => ({ ...g, count: groupCounts[g.key] })),
    groupTotal: forGroups.length,
    states: tally(forState.map((c) => c.states)),
    noLocation: forState.filter((c) => !c.states.length).length,
    withPayment: all.filter((c) => c.payment).length,
  };
}
