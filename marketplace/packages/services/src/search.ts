import { DateTime } from "luxon";
import { prisma } from "@cm/db";
import type { Actor } from "./context";

/**
 * Records for the backend search bar. Scoped to what the signed-in person can already see:
 * admins search everyone; a clinic only its own shifts, locations, team and the providers who
 * have worked for it; a provider only their own shifts and the clinics they've worked at.
 * Pages are matched in the browser (lib/search-pages.ts); this only returns records.
 */
export interface SearchHit {
  group: string;
  label: string;
  sub?: string;
  href: string;
}

const ci = (q: string) => ({ contains: q, mode: "insensitive" as const });
const day = (d: Date) => DateTime.fromJSDate(d).setZone("America/New_York").toFormat("ccc LLL d");
const TAKE = 5;

export async function searchRecords(actor: Actor, raw: string): Promise<SearchHit[]> {
  const q = raw.trim().slice(0, 80);
  if (q.length < 2) return [];
  if (actor.role === "PLATFORM_ADMIN") return adminSearch(q);
  if (actor.role === "CLINIC_OWNER" || actor.role === "CLINIC_STAFF") return actor.clinicOrgId ? clinicSearch(actor.clinicOrgId, q) : [];
  if (actor.role === "PROVIDER") return actor.providerId ? providerSearch(actor.providerId, q) : [];
  return [];
}

async function adminSearch(q: string): Promise<SearchHit[]> {
  const digits = q.replace(/\D/g, "");
  const idLike = /^[a-z0-9]{8,}$/i.test(q);
  const [providers, clinics, users, leads, prospects, providerProspects, shifts, promos, referrals] = await Promise.all([
    prisma.provider.findMany({
      where: { OR: [{ displayName: ci(q) }, { legalName: ci(q) }, { user: { email: ci(q) } }, ...(digits.length >= 4 ? [{ npi: { contains: digits } }, { user: { phone: { contains: digits } } }] : []), ...(idLike ? [{ id: q }] : [])] },
      select: { id: true, displayName: true, status: true, homeCity: true, user: { select: { email: true } } },
      take: TAKE,
    }),
    prisma.clinicOrg.findMany({
      where: { OR: [{ displayName: ci(q) }, { legalName: ci(q) }, { billingEmail: ci(q) }, { members: { some: { user: { email: ci(q) } } } }, { locations: { some: { OR: [{ name: ci(q) }, { city: ci(q) }] } } }, ...(idLike ? [{ id: q }] : [])] },
      select: { id: true, displayName: true, status: true, billingEmail: true },
      take: TAKE,
    }),
    prisma.user.findMany({
      where: { role: { in: ["CLINIC_STAFF", "PLATFORM_ADMIN"] }, OR: [{ name: ci(q) }, { email: ci(q) }] },
      select: { name: true, email: true, role: true, disabledAt: true },
      take: TAKE,
    }),
    prisma.lead.findMany({ where: { spamCategory: null, OR: [{ name: ci(q) }, { email: ci(q) }, { organization: ci(q) }] }, select: { id: true, name: true, email: true, source: true }, orderBy: { createdAt: "desc" }, take: TAKE }),
    prisma.clinicProspect.findMany({ where: { OR: [{ clinicName: ci(q) }, { ownerName: ci(q) }, { email: ci(q) }] }, select: { id: true, clinicName: true, city: true }, take: TAKE }),
    prisma.providerProspect.findMany({ where: { OR: [{ displayName: ci(q) }, { email: ci(q) }, ...(digits.length >= 6 ? [{ npi: { contains: digits } }] : [])] }, select: { id: true, displayName: true, city: true, state: true }, take: TAKE }),
    prisma.shift.findMany({
      where: { OR: [...(idLike ? [{ id: q }] : []), { location: { OR: [{ name: ci(q) }, { clinicOrg: { displayName: ci(q) } }] } }] },
      select: { id: true, startsAt: true, status: true, location: { select: { name: true, city: true, clinicOrg: { select: { displayName: true } } } } },
      orderBy: { startsAt: "desc" },
      take: TAKE,
    }),
    prisma.promoCode.findMany({ where: { code: ci(q.toUpperCase()), parentId: null }, select: { code: true, description: true }, take: 3 }),
    prisma.user.findMany({ where: { referralCode: ci(q) }, select: { name: true, referralCode: true }, take: 3 }),
  ]);
  return [
    ...providers.map((p) => ({ group: "Providers", label: p.displayName, sub: [p.user.email, p.homeCity, p.status.toLowerCase()].filter(Boolean).join(" · "), href: `/admin/providers/${p.id}` })),
    ...clinics.map((c) => ({ group: "Clinics", label: c.displayName, sub: [c.billingEmail, c.status.toLowerCase()].filter(Boolean).join(" · "), href: `/admin/clinics/${c.id}` })),
    ...users.map((u) => ({ group: "Logins", label: u.name, sub: `${u.email} · ${u.role === "PLATFORM_ADMIN" ? "admin" : "clinic staff"}${u.disabledAt ? " · suspended" : ""}`, href: `/admin/users?q=${encodeURIComponent(u.email)}` })),
    ...shifts.map((s) => ({ group: "Shifts", label: `${s.location.clinicOrg.displayName}: ${day(s.startsAt)}`, sub: `${s.location.name}, ${s.location.city} · ${s.status.toLowerCase()}`, href: `/admin/shifts/${s.id}` })),
    ...leads.map((l) => ({ group: "Leads", label: l.name, sub: `${l.email} · ${l.source}`, href: `/admin/leads/${l.id}` })),
    ...prospects.map((p) => ({ group: "Clinic prospects", label: p.clinicName, sub: p.city ?? undefined, href: `/admin/growth/prospects/${p.id}` })),
    ...providerProspects.map((p) => ({ group: "Provider prospects", label: p.displayName, sub: [p.city, p.state].filter(Boolean).join(", "), href: `/admin/growth/prospects/providers/${p.id}` })),
    ...promos.map((p) => ({ group: "Promo codes", label: p.code, sub: p.description ?? undefined, href: "/admin/promo" })),
    ...referrals.map((u) => ({ group: "Referral codes", label: u.referralCode!, sub: u.name, href: "/admin/referrals" })),
  ];
}

async function clinicSearch(orgId: string, q: string): Promise<SearchHit[]> {
  const [shifts, providers, locations, team] = await Promise.all([
    prisma.shift.findMany({
      where: { location: { clinicOrgId: orgId }, OR: [{ location: { name: ci(q) } }, { assignments: { some: { provider: { displayName: ci(q) } } } }, ...(q.length >= 8 ? [{ id: q }] : [])] },
      select: { id: true, startsAt: true, status: true, location: { select: { name: true } } },
      orderBy: { startsAt: "desc" },
      take: TAKE,
    }),
    prisma.provider.findMany({ where: { displayName: ci(q), assignments: { some: { shift: { location: { clinicOrgId: orgId } } } } }, select: { id: true, displayName: true }, take: TAKE }),
    prisma.clinicLocation.findMany({ where: { clinicOrgId: orgId, OR: [{ name: ci(q) }, { city: ci(q) }] }, select: { name: true, city: true }, take: TAKE }),
    prisma.clinicMember.findMany({ where: { clinicOrgId: orgId, user: { OR: [{ name: ci(q) }, { email: ci(q) }] } }, select: { user: { select: { name: true, email: true } } }, take: TAKE }),
  ]);
  return [
    ...shifts.map((s) => ({ group: "Shifts", label: `${s.location.name}: ${day(s.startsAt)}`, sub: s.status.toLowerCase().replace(/_/g, " "), href: `/clinic/shifts/${s.id}` })),
    ...providers.map((p) => ({ group: "Providers", label: p.displayName, href: `/clinic/providers/${p.id}` })),
    ...locations.map((l) => ({ group: "Locations", label: l.name, sub: l.city, href: "/clinic/locations" })),
    ...team.map((m) => ({ group: "Team", label: m.user.name, sub: m.user.email, href: "/clinic/team" })),
  ];
}

async function providerSearch(providerId: string, q: string): Promise<SearchHit[]> {
  const shifts = await prisma.assignment.findMany({
    where: { providerId, shift: { location: { OR: [{ name: ci(q) }, { city: ci(q) }, { clinicOrg: { displayName: ci(q) } }] } } },
    select: { id: true, startsAt: true, status: true, shift: { select: { location: { select: { name: true, city: true, clinicOrg: { select: { displayName: true } } } } } } },
    orderBy: { startsAt: "desc" },
    take: TAKE * 2,
  });
  return shifts.map((a) => ({ group: "My shifts", label: `${a.shift.location.clinicOrg.displayName}: ${day(a.startsAt)}`, sub: `${a.shift.location.city} · ${a.status.toLowerCase().replace(/_/g, " ")}`, href: `/provider/assignments/${a.id}` }));
}
