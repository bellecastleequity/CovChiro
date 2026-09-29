import { DomainError, licensedPairs, providerBadges, type Badge } from "@cm/core";
import { prisma } from "@cm/db";
import { clock, getSettings, type Actor } from "./context";

/**
 * Provider public profile: headshot, headline, About me, LinkedIn, verified
 * credentials, skills, ratings and badges earned from activity. Never shows
 * home address, phone, email, pay, or raw responsiveness numbers.
 */

/** Badges for many providers at once (candidate cards, profile pages). */
export async function badgesFor(providerIds: string[]): Promise<Map<string, Badge[]>> {
  const out = new Map<string, Badge[]>();
  if (!providerIds.length) return out;
  const now = clock.now();
  const yearAgo = new Date(+now - 365 * 86_400_000);
  const s = await getSettings();
  const [providers, stats, ratings, offers, favs, lateCancels, noShows] = await Promise.all([
    prisma.provider.findMany({ where: { id: { in: providerIds } }, include: { licenses: true, malpractice: true, professions: true, onCallRules: true } }),
    prisma.providerStats.findMany({ where: { providerId: { in: providerIds } } }),
    prisma.rating.findMany({ where: { raterType: "CLINIC", revealedAt: { not: null }, assignment: { providerId: { in: providerIds } } }, select: { stars: true, categories: true, assignment: { select: { providerId: true } } } }),
    prisma.offer.findMany({
      where: { providerId: { in: providerIds }, createdAt: { gte: new Date(+now - s["responsiveness.lookbackDays"] * 86_400_000) }, applicationId: null, status: { notIn: ["WITHDRAWN"] } },
      select: { providerId: true, createdAt: true, respondedAt: true, status: true },
    }),
    prisma.favorite.groupBy({ by: ["toId"], where: { fromType: "CLINIC", toType: "PROVIDER", toId: { in: providerIds } }, _count: true }),
    prisma.assignment.groupBy({ by: ["providerId"], where: { providerId: { in: providerIds }, cancelledBy: "PROVIDER", cancelledAt: { gte: yearAgo }, status: "CANCELLED" }, _count: true }),
    prisma.assignment.groupBy({ by: ["providerId"], where: { providerId: { in: providerIds }, status: "NO_SHOW", startsAt: { gte: yearAgo } }, _count: true }),
  ]);
  for (const p of providers) {
    const st = stats.find((x) => x.providerId === p.id);
    const rs = ratings.filter((r) => r.assignment.providerId === p.id);
    const punct = rs.map((r) => Number((r.categories as Record<string, number>)?.punctuality ?? 0)).filter((v) => v > 0);
    const os = offers.filter((o) => o.providerId === p.id);
    const responded = os.filter((o) => o.respondedAt);
    const times = responded.map((o) => (+o.respondedAt! - +o.createdAt) / 60_000).sort((a, b) => a - b);
    const pairs = licensedPairs(p.licenses, now);
    const late = Math.max(st?.lateCancels ?? 0, lateCancels.find((x) => x.providerId === p.id)?._count ?? 0);
    out.set(
      p.id,
      providerBadges({
        completedShifts: st?.completedShifts ?? 0,
        lateCancels12m: late,
        noShows12m: noShows.find((x) => x.providerId === p.id)?._count ?? 0,
        ratingAvg: rs.length ? rs.reduce((x, r) => x + r.stars, 0) / rs.length : null,
        ratingCount: rs.length,
        punctualityAvg: punct.length ? punct.reduce((x, v) => x + v, 0) / punct.length : null,
        punctualityCount: punct.length,
        offersReceived: os.length,
        offersResponded: responded.length,
        medianResponseMinutes: times.length ? times[Math.floor(times.length / 2)] : null,
        maxYearsInPractice: Math.max(0, ...p.professions.map((x) => x.yearsInPractice ?? 0)) || null,
        favoritedByClinics: favs.find((f) => f.toId === p.id)?._count ?? 0,
        verifiedProfessions: Object.keys(pairs).length,
        verifiedStates: new Set(Object.values(pairs).flat()).size,
        licenseVerified: Object.keys(pairs).length > 0,
        malpracticeVerified: p.malpractice.some((m) => m.status === "VERIFIED" && m.expiresAt > now),
        npiVerified: !!p.npiVerifiedAt,
        onCallActive: s["features.onCallEnabled"] && p.onCallRules.some((r) => r.active && (!r.pausedUntil || r.pausedUntil <= now)),
      }),
    );
  }
  return out;
}

export async function providerPublicProfile(viewer: Actor, providerId: string) {
  const s = await getSettings();
  const isSelf = viewer.role === "PROVIDER" && viewer.providerId === providerId;
  const isAdmin = viewer.role === "PLATFORM_ADMIN";
  const isClinic = viewer.role === "CLINIC_OWNER" || viewer.role === "CLINIC_STAFF";
  if (!isSelf && !isAdmin && !isClinic) throw new DomainError("FORBIDDEN", "Not allowed");
  const p = await prisma.provider.findUnique({
    where: { id: providerId },
    include: {
      professions: { include: { profession: true } },
      licenses: { where: { status: "VERIFIED", expiresAt: { gt: clock.now() } }, orderBy: [{ professionCode: "asc" }, { state: "asc" }] },
      skills: { include: { skill: true } },
    },
  });
  if (!p || (!isSelf && !isAdmin && p.status !== "ACTIVE")) throw new DomainError("NOT_FOUND", "Provider not found");
  let workedTogether = false;
  if (isClinic) {
    workedTogether = (await prisma.assignment.count({ where: { providerId, status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] }, shift: { location: { clinicOrgId: viewer.clinicOrgId! } } } })) > 0;
  }
  const linkedinVisible = isSelf || isAdmin || s["profiles.linkedinVisibility"] === "always" || workedTogether;
  const [badges, ratings, completed] = await Promise.all([
    badgesFor([providerId]),
    prisma.rating.findMany({
      where: { raterType: "CLINIC", revealedAt: { not: null }, assignment: { providerId } },
      include: { assignment: { select: { professionCode: true, startsAt: true } } },
      orderBy: { submittedAt: "desc" },
      take: 20,
    }),
    prisma.assignment.count({ where: { providerId, status: "COMPLETED" } }),
  ]);
  return {
    id: p.id,
    displayName: p.displayName,
    headline: p.headline,
    photoUrl: p.photoUrl,
    about: p.bio,
    city: p.homeCity,
    state: p.homeState,
    linkedinUrl: linkedinVisible ? p.linkedinUrl : null,
    linkedinHidden: !linkedinVisible && !!p.linkedinUrl,
    memberSince: p.createdAt,
    school: p.school,
    graduationYear: p.graduationYear,
    languages: p.languages,
    ehrSystems: p.ehrSystems,
    professions: p.professions.map((x) => ({ code: x.professionCode, name: x.profession.displayName, yearsInPractice: x.yearsInPractice, status: x.status })),
    credentials: p.licenses.map((l) => ({ professionCode: l.professionCode, state: l.state, title: l.credentialTitle ?? l.professionCode })),
    skills: p.skills.filter((k) => !k.skill.requiresCertification || k.certificationStatus === "VERIFIED").map((k) => ({ name: k.skill.name, proficiency: k.proficiency, certified: k.certificationStatus === "VERIFIED" })),
    badges: badges.get(providerId) ?? [],
    completedShifts: completed,
    rating: ratings.length ? { avg: ratings.reduce((x, r) => x + r.stars, 0) / ratings.length, count: ratings.length } : null,
    reviews: ratings.filter((r) => r.comment).slice(0, 6).map((r) => ({ stars: r.stars, comment: r.comment!, professionCode: r.assignment.professionCode, date: r.submittedAt })),
    isSelf,
  };
}
