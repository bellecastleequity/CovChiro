import { randomBytes } from "node:crypto";
import { prisma, type LicenseStatus } from "@cm/db";
import type { Actor } from "@cm/services";

/** Test data builders. Every provider/clinic is unique per call. */

export const uid = () => randomBytes(5).toString("hex");
const FAR = new Date("2031-01-01T00:00:00Z");

/** A weekday at 9:00–17:00 Eastern, `days` from now (always a Wednesday so no weekend premium). */
export function futureWeekday(days: number, startHourUtc = 13, hours = 8) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(startHourUtc, 0, 0, 0);
  return { startsAt: d, endsAt: new Date(+d + hours * 3_600_000) };
}

export interface ProviderOpts {
  licenses?: { professionCode: string; state: string; status?: LicenseStatus; expiresAt?: Date }[];
  malpractice?: { covered: string[]; status?: LicenseStatus; expiresAt?: Date; perOccurrenceCents?: number; aggregateCents?: number }[] | null;
  professions?: { code: string; status?: "ONBOARDING" | "ACTIVE" | "PAUSED" }[];
  home?: { lat: number; lng: number; state: string };
  skills?: { skillId: string; certificationStatus?: LicenseStatus; certificationExpiresAt?: Date }[];
  maxDriveMinutes?: number;
  willingOvernight?: boolean;
  status?: "ONBOARDING" | "ACTIVE";
}

/** Orlando-area home by default; licensed DC in FL; available all week. */
export async function makeProvider(o: ProviderOpts = {}) {
  const id = uid();
  const home = o.home ?? { lat: 28.55, lng: -81.36, state: "FL" };
  const licenses = o.licenses ?? [{ professionCode: "DC", state: "FL" }];
  const profs = o.professions ?? [...new Set(licenses.map((l) => l.professionCode))].map((code) => ({ code, status: "ACTIVE" as const }));
  const user = await prisma.user.create({ data: { email: `p-${id}@test.dev`, name: `Provider ${id}`, role: "PROVIDER", emailVerifiedAt: new Date() } });
  const p = await prisma.provider.create({
    data: {
      userId: user.id,
      legalName: `Provider ${id}`,
      displayName: `Dr. ${id}`,
      homeLat: home.lat,
      homeLng: home.lng,
      homeState: home.state,
      homeCity: "Testville",
      homeTimeZone: "America/New_York",
      maxDriveMinutes: o.maxDriveMinutes ?? 90,
      willingOvernight: o.willingOvernight ?? false,
      stripeAccountId: `acct_test_${id}`,
      stripePayoutsEnabled: true,
      agreementSignedAt: new Date(),
      agreementVersion: 1,
      profileCompleteAt: new Date(),
      status: o.status ?? "ACTIVE",
      professions: { create: profs.map((p) => ({ professionCode: p.code, status: p.status ?? "ACTIVE" })) },
      licenses: {
        create: licenses.map((l) => ({
          professionCode: l.professionCode,
          state: l.state,
          licenseNumber: `L${uid()}`,
          expiresAt: l.expiresAt ?? FAR,
          status: l.status ?? "VERIFIED",
        })),
      },
      malpractice: {
        create: (o.malpractice === undefined ? [{ covered: profs.map((p) => p.code) }] : (o.malpractice ?? [])).map((m) => ({
          carrier: "Test Mutual",
          policyNumber: uid(),
          perOccurrenceCents: m.perOccurrenceCents ?? 100_000_000,
          aggregateCents: m.aggregateCents ?? 300_000_000,
          coveredProfessionCodes: m.covered,
          expiresAt: m.expiresAt ?? FAR,
          documentUrl: "test.pdf",
          status: m.status ?? "VERIFIED",
        })),
      },
      skills: o.skills ? { create: o.skills.map((s) => ({ skillId: s.skillId, certificationStatus: s.certificationStatus ?? null, certificationExpiresAt: s.certificationExpiresAt ?? null })) } : undefined,
      availability: { create: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMin: 0, endMin: 1440, timeZone: "America/New_York" })) },
      stats: { create: {} },
    },
  });
  const actor: Actor = { userId: user.id, role: "PROVIDER", providerId: p.id, clinicOrgId: null };
  return { ...p, user, actor };
}

export interface ClinicOpts {
  state?: "FL" | "GA" | "AL";
  zip?: string;
  lat?: number;
  lng?: number;
  professionCodes?: string[];
}

const DEFAULT_LOC: Record<string, { zip: string; lat: number; lng: number; city: string }> = {
  FL: { zip: "32801", lat: 28.5421, lng: -81.379, city: "Orlando" },
  GA: { zip: "30303", lat: 33.749, lng: -84.388, city: "Atlanta" },
  AL: { zip: "36602", lat: 30.694, lng: -88.043, city: "Mobile" },
};

export async function makeClinic(o: ClinicOpts = {}) {
  const id = uid();
  const state = o.state ?? "FL";
  const d = DEFAULT_LOC[state];
  const user = await prisma.user.create({ data: { email: `c-${id}@test.dev`, name: `Clinic Owner ${id}`, role: "CLINIC_OWNER", emailVerifiedAt: new Date() } });
  const zip = o.zip ?? d.zip;
  const region = (await prisma.rateRegion.findFirst({ where: { state, zip3List: { has: zip.slice(0, 3) } } })) ?? (await prisma.rateRegion.findFirst({ where: { state } }));
  const org = await prisma.clinicOrg.create({
    data: {
      legalName: `Clinic ${id} LLC`,
      displayName: `Clinic ${id}`,
      billingEmail: user.email,
      status: "ACTIVE",
      hasPaymentMethod: true,
      stripeCustomerId: `cus_test_${id}`,
      agreementSignedAt: new Date(),
      agreementVersion: 1,
      members: { create: { userId: user.id, role: "CLINIC_OWNER" } },
    },
  });
  const location = await prisma.clinicLocation.create({
    data: {
      clinicOrgId: org.id,
      name: `Main ${id}`,
      addressLine1: "1 Test St",
      city: d.city,
      state,
      zip: o.zip ?? d.zip,
      lat: o.lat ?? d.lat,
      lng: o.lng ?? d.lng,
      timeZone: "America/New_York",
      geocodedAt: new Date(),
      rateRegionId: region?.id ?? null,
      professionCodes: o.professionCodes ?? ["DC", "LMT", "LAC", "PT", "PTA"],
      arrivalNotes: "Back door",
    },
  });
  const actor: Actor = { userId: user.id, role: "CLINIC_OWNER", providerId: null, clinicOrgId: org.id };
  return { org, location, user, actor };
}

/** Direct shift insert (bypasses the posting service) — used to probe triggers. */
export async function makeShift(locationId: string, o: { professionCode?: string; status?: "DRAFT" | "OPEN"; days?: number; requiredSkillIds?: string[]; attestation?: unknown; lodgingAllowed?: boolean } = {}) {
  const { startsAt, endsAt } = futureWeekday(o.days ?? 10);
  const creator = await prisma.user.findFirstOrThrow();
  return prisma.shift.create({
    data: {
      locationId,
      professionCode: o.professionCode ?? "DC",
      state: "XX",
      startsAt,
      endsAt,
      status: o.status ?? "OPEN",
      requiredSkillIds: o.requiredSkillIds ?? [],
      lodgingAllowed: o.lodgingAllowed ?? false,
      clinicPriceCents: 57500,
      providerPayCents: 37500,
      postedAt: new Date(),
      createdById: creator.id,
      ...(o.attestation ? { supervisionAttestation: o.attestation as object, supervisionAttestedAt: new Date() } : {}),
    },
  });
}

/** Direct assignment insert — the trigger/constraints must reject ineligible ones. */
export async function insertAssignment(shiftId: string, providerId: string, extra: { bufferMinutes?: number; state?: string; professionCode?: string } = {}) {
  const s = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
  return prisma.assignment.create({
    data: {
      shiftId,
      providerId,
      state: extra.state ?? s.state,
      professionCode: extra.professionCode ?? s.professionCode,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      bufferMinutes: extra.bufferMinutes ?? 30,
      selectionMethod: "ADMIN",
      driveMinutes: 10,
      driveMiles: 5,
      clinicPriceCents: s.clinicPriceCents,
      providerPayCents: s.providerPayCents,
      mileageCents: 100,
      clinicTotalCents: s.clinicPriceCents + 100,
      providerTotalCents: s.providerPayCents + 100,
    },
  });
}

/** Enable a profession in FL for tests (DC is enabled by the seed). */
export async function enablePair(professionCode: string, state = "FL", extra: { supervisionRequired?: boolean; supervising?: string[]; minOcc?: number } = {}) {
  if (state !== "FL") {
    await prisma.stateConfig.update({ where: { state }, data: { legalReviewComplete: true, boardLookupUrl: "https://example.test", enabled: true } });
  }
  await prisma.professionStateConfig.upsert({
    where: { professionCode_state: { professionCode, state } },
    create: {
      professionCode,
      state,
      legalReviewComplete: true,
      boardLookupUrl: "https://example.test",
      supervisionRequired: extra.supervisionRequired ?? false,
      supervisingProfessionCodes: extra.supervising ?? [],
      malpracticeMinOccurrenceCents: extra.minOcc ?? 100_000_000,
      malpracticeMinAggregateCents: 300_000_000,
      enabled: true,
    },
    update: {
      legalReviewComplete: true,
      boardLookupUrl: "https://example.test",
      supervisionRequired: extra.supervisionRequired ?? false,
      supervisingProfessionCodes: extra.supervising ?? [],
      malpracticeMinOccurrenceCents: extra.minOcc ?? 100_000_000,
      malpracticeMinAggregateCents: 300_000_000,
      enabled: true,
    },
  });
}

/** Rate cards so the pricing engine can quote a profession in a state. */
export async function ensureRateCards(professionCode: string, state: string, hourly = false) {
  let region = await prisma.rateRegion.findFirst({ where: { state } });
  if (!region) region = await prisma.rateRegion.create({ data: { state, name: `${state}-Test`, tier: 1, zip3List: [] } });
  await prisma.stateConfig.update({ where: { state }, data: { defaultRateRegionId: region.id } });
  const tiers = hourly ? (["HOURLY"] as const) : (["HALF_DAY", "FULL_DAY"] as const);
  for (const t of tiers) {
    const exists = await prisma.rateCard.findFirst({ where: { rateRegionId: region.id, professionCode, durationTier: t } });
    if (!exists) {
      await prisma.rateCard.create({
        data: { rateRegionId: region.id, professionCode, durationTier: t, clinicPriceCents: t === "HOURLY" ? 9000 : t === "HALF_DAY" ? 32500 : 57500, providerPayCents: t === "HOURLY" ? 6000 : t === "HALF_DAY" ? 20000 : 37500, minHours: t === "HOURLY" ? 2 : null, effectiveFrom: new Date("2020-01-01") },
      });
    }
  }
  return region;
}

export async function expectDbReject(p: Promise<unknown>, pattern: RegExp) {
  let err: unknown = null;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  if (!err) throw new Error(`Expected the database to reject, but it succeeded (${pattern})`);
  const msg = err instanceof Error ? err.message : String(err);
  if (!pattern.test(msg)) throw new Error(`Rejected with unexpected error: ${msg}`);
}
