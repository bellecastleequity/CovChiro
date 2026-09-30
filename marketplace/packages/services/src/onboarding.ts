import { randomBytes } from "node:crypto";
import { z } from "zod";
import { DomainError, licensedPairs, NATIONAL_CREDENTIAL, normalizeLinkedIn, US_STATES } from "@cm/core";
import { prisma } from "@cm/db";
import { esignProvider, geoProvider, lookupNpi, paymentsProvider, testSigningEnabled } from "@cm/integrations";
import { audit, requireClinic, requireProvider, SYSTEM, type Actor } from "./context";
import { absoluteUrl, sendEmail } from "./notify";
import { activateClinicIfReady } from "./payments";
import { resolveRateRegion } from "./pricing";
import { hashPassword } from "./auth";
import { onLeadConverted } from "./leads";
import { nationalCredentialStates } from "./eligibility";

/** Current agreement versions. Bumping one requires re-acceptance before the next application/posting (SPEC §13). */
export const AGREEMENT_VERSION = { CLINIC: 1, PROVIDER: 1 } as const;

// ======================================================================
// Provider
// ======================================================================

export async function providerProfile(actor: Actor) {
  const providerId = requireProvider(actor);
  const p = await prisma.provider.findUniqueOrThrow({
    where: { id: providerId },
    include: {
      user: { select: { email: true, phone: true, phoneVerifiedAt: true, emailVerifiedAt: true } },
      professions: { include: { profession: true } },
      licenses: { orderBy: [{ professionCode: "asc" }, { state: "asc" }] },
      malpractice: { orderBy: { expiresAt: "desc" } },
      skills: { include: { skill: true } },
      availability: { orderBy: [{ weekday: "asc" }, { startMin: "asc" }] },
      blackouts: { where: { endsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" } },
      openDates: { where: { endsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" } },
    },
  });
  const national = await nationalCredentialStates(prisma);
  return { provider: p, checklist: await providerChecklist(providerId), canTake: licensedPairs(p.licenses, new Date(), national), nationalCredentialStates: national };
}

export async function providerChecklist(providerId: string) {
  const p = await prisma.provider.findUniqueOrThrow({
    where: { id: providerId },
    include: { user: true, professions: { include: { profession: true } }, licenses: true, malpractice: true },
  });
  const now = new Date();
  const common = {
    profile: !!(p.legalName && p.displayName && p.user.phone && p.bio),
    photo: !!p.photoUrl,
    homeBase: p.homeLat !== null,
    emailVerified: !!p.user.emailVerifiedAt,
    payouts: p.stripePayoutsEnabled,
    agreement: p.agreementVersion === AGREEMENT_VERSION.PROVIDER && !!p.agreementSignedAt,
    npi: p.professions.some((x) => x.profession.npiRequired) ? !!p.npiVerifiedAt : true,
  };
  const perProfession = p.professions.map((pp) => ({
    professionCode: pp.professionCode,
    displayName: pp.profession.displayName,
    status: pp.status,
    license: p.licenses.some((l) => l.professionCode === pp.professionCode && l.status === "VERIFIED" && l.expiresAt > now),
    licensePending: p.licenses.some((l) => l.professionCode === pp.professionCode && l.status === "PENDING_VERIFICATION"),
    malpractice: p.malpractice.some((m) => m.status === "VERIFIED" && m.expiresAt > now && m.coveredProfessionCodes.includes(pp.professionCode)),
    npi: pp.profession.npiRequired ? !!p.npiVerifiedAt : true,
  }));
  return { common, perProfession };
}

/** "Profile complete" is evaluated per profession (Addendum 01 §4). */
export async function recomputeProviderStatus(providerId: string) {
  const { common, perProfession } = await providerChecklist(providerId);
  const base = common.profile && common.photo && common.homeBase && common.emailVerified && common.payouts && common.agreement;
  const provider = await prisma.provider.findUniqueOrThrow({ where: { id: providerId } });
  let anyActive = false;
  for (const pp of perProfession) {
    const ready = base && pp.license && pp.malpractice && pp.npi;
    if (ready) anyActive = true;
    if (ready && pp.status === "ONBOARDING") {
      await prisma.providerProfession.update({ where: { providerId_professionCode: { providerId, professionCode: pp.professionCode } }, data: { status: "ACTIVE", profileCompleteAt: new Date() } });
    }
  }
  if (anyActive && provider.status === "ONBOARDING") {
    await prisma.provider.update({ where: { id: providerId }, data: { status: "ACTIVE", profileCompleteAt: new Date() } });
    await audit(prisma, SYSTEM, "provider.activated", "Provider", providerId, { status: "ONBOARDING" }, { status: "ACTIVE" });
    await onLeadConverted([provider.userId], null);
  }
}

export const ProviderProfileInput = z.object({
  legalName: z.string().trim().min(2).max(120),
  displayName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(30),
  bio: z.string().trim().max(1500).optional().nullable(),
  homeAddress: z.string().trim().min(5).max(300),
  maxDriveMinutes: z.coerce.number().int().min(10).max(600),
  willingOvernight: z.boolean().default(false),
  school: z.string().trim().max(160).optional().nullable(),
  graduationYear: z.coerce.number().int().min(1950).max(2100).optional().nullable(),
  languages: z.array(z.string().trim().max(40)).max(10).default([]),
  ehrSystems: z.array(z.string().trim().max(60)).max(15).default([]),
  xrayComfort: z.boolean().default(false),
  maxPatientsPerDay: z.coerce.number().int().min(1).max(300).optional().nullable(),
  npi: z.string().trim().regex(/^\d{10}$/, "NPI is 10 digits").optional().nullable().or(z.literal("")),
  headline: z.string().trim().max(120).optional().nullable(),
  linkedinUrl: z.string().trim().max(200).optional().nullable(),
  yearsInPractice: z.record(z.string(), z.coerce.number().int().min(0).max(70)).optional(),
});

export async function updateProviderProfile(actor: Actor, raw: z.input<typeof ProviderProfileInput>) {
  const providerId = requireProvider(actor);
  const input = ProviderProfileInput.parse(raw);
  const current = await prisma.provider.findUniqueOrThrow({ where: { id: providerId } });
  const linkedin = input.linkedinUrl ? normalizeLinkedIn(input.linkedinUrl) : null;
  if (input.linkedinUrl && !linkedin) throw new DomainError("VALIDATION", "Enter your LinkedIn profile URL, like linkedin.com/in/your-name.");
  let geo = {};
  if (input.homeAddress !== current.homeAddress) {
    const g = await geoProvider().geocode(input.homeAddress);
    if (!g) throw new DomainError("VALIDATION", "We couldn't find that address. Include street, city, state and ZIP.");
    // Home state is display-only; it is never used for eligibility (INV-1).
    geo = { homeAddress: input.homeAddress, homeLat: g.lat, homeLng: g.lng, homeCity: g.city, homeState: g.state, homeTimeZone: g.timeZone };
  }
  let npiData = {};
  if (input.npi && input.npi !== current.npi) {
    const [first, ...rest] = input.legalName.split(/\s+/);
    const r = await lookupNpi(input.npi, first, rest.at(-1) ?? "");
    if (!r.found) throw new DomainError("VALIDATION", "That NPI wasn't found in the national registry.");
    npiData = { npi: input.npi, npiVerifiedAt: r.nameMatches ? new Date() : null, npiMismatch: !r.nameMatches };
    if (!r.nameMatches) await prisma.adminTask.create({ data: { kind: "NPI_MISMATCH", title: `NPI name mismatch: ${input.legalName} vs ${r.registryName}`, entityType: "Provider", entityId: providerId } });
  }
  await prisma.$transaction([
    prisma.provider.update({
      where: { id: providerId },
      data: {
        legalName: input.legalName,
        displayName: input.displayName,
        bio: input.bio ?? null,
        maxDriveMinutes: input.maxDriveMinutes,
        willingOvernight: input.willingOvernight,
        school: input.school ?? null,
        graduationYear: input.graduationYear ?? null,
        languages: input.languages,
        ehrSystems: input.ehrSystems,
        xrayComfort: input.xrayComfort,
        maxPatientsPerDay: input.maxPatientsPerDay ?? null,
        headline: input.headline || null,
        linkedinUrl: linkedin,
        ...geo,
        ...npiData,
      },
    }),
    prisma.user.update({ where: { id: actor.userId! }, data: { name: input.displayName } }),
    ...Object.entries(input.yearsInPractice ?? {}).map(([professionCode, years]) =>
      prisma.providerProfession.updateMany({ where: { providerId, professionCode }, data: { yearsInPractice: years } }),
    ),
  ]);
  // Phone changes go through SMS verification (auth.startPhoneVerification).
  const u = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId! } });
  if (!u.phone && input.phone) await prisma.user.update({ where: { id: u.id }, data: { phone: input.phone } });
  await recomputeProviderStatus(providerId);
}

export async function setProviderPhoto(actor: Actor, key: string) {
  const providerId = requireProvider(actor);
  await prisma.provider.update({ where: { id: providerId }, data: { photoUrl: key } });
  await recomputeProviderStatus(providerId);
}

export async function addProfession(actor: Actor, professionCode: string) {
  const providerId = requireProvider(actor);
  const prof = await prisma.profession.findUnique({ where: { code: professionCode } });
  if (!prof) throw new DomainError("VALIDATION", "Unknown profession");
  await prisma.providerProfession.upsert({ where: { providerId_professionCode: { providerId, professionCode } }, create: { providerId, professionCode }, update: {} });
}

export const LicenseInput = z.object({
  professionCode: z.string().min(1),
  /** A state, or "US" for a national registry credential (ARDMS, CCI, ARRT…). */
  state: z.string().trim().toUpperCase().refine((s) => s in US_STATES || s === NATIONAL_CREDENTIAL, "Choose a state"),
  licenseNumber: z.string().trim().min(3).max(40),
  credentialTitle: z.string().trim().max(20).optional().nullable(),
  expiresAt: z.coerce.date(),
  documentUrl: z.string().optional().nullable(),
});

export async function upsertLicense(actor: Actor, raw: z.input<typeof LicenseInput>) {
  const providerId = requireProvider(actor);
  const input = LicenseInput.parse(raw);
  if (input.expiresAt <= new Date()) throw new DomainError("VALIDATION", "That license has already expired.");
  const hasProfession = await prisma.providerProfession.findUnique({ where: { providerId_professionCode: { providerId, professionCode: input.professionCode } } });
  if (!hasProfession) throw new DomainError("VALIDATION", "Add this profession to your profile first.");
  if (input.state === NATIONAL_CREDENTIAL && !(await nationalCredentialStates(prisma))[input.professionCode]?.length) {
    throw new DomainError("VALIDATION", "National registry credentials aren't accepted for this profession yet. Add your state license instead.");
  }
  const psc = await prisma.professionStateConfig.findUnique({ where: { professionCode_state: { professionCode: input.professionCode, state: input.state } } });
  // Any edit sends the license back to verification (INV-1: only VERIFIED counts).
  const l = await prisma.license.upsert({
    where: { providerId_professionCode_state: { providerId, professionCode: input.professionCode, state: input.state } },
    create: { providerId, ...input, credentialTitle: input.credentialTitle || psc?.credentialTitle || null, status: "PENDING_VERIFICATION" },
    update: { licenseNumber: input.licenseNumber, credentialTitle: input.credentialTitle || psc?.credentialTitle || null, expiresAt: input.expiresAt, documentUrl: input.documentUrl ?? undefined, status: "PENDING_VERIFICATION", verifiedAt: null, verifiedById: null, rejectionReason: null },
  });
  await audit(prisma, actor, "license.submitted", "License", l.id, null, { professionCode: l.professionCode, state: l.state });
  return l;
}

export async function deleteLicense(actor: Actor, licenseId: string) {
  const providerId = requireProvider(actor);
  const l = await prisma.license.findFirst({ where: { id: licenseId, providerId } });
  if (!l) throw new DomainError("NOT_FOUND", "License not found");
  const future = await prisma.assignment.count({ where: { providerId, state: l.state, professionCode: l.professionCode, status: { in: ["CONFIRMED", "IN_PROGRESS"] } } });
  if (future) throw new DomainError("CONFLICT", "You have confirmed shifts that depend on this license. Cancel them first or contact support.");
  await prisma.license.delete({ where: { id: l.id } });
  await audit(prisma, actor, "license.deleted", "License", l.id, l);
}

export const MalpracticeInput = z.object({
  carrier: z.string().trim().min(2).max(120),
  policyNumber: z.string().trim().min(2).max(60),
  perOccurrenceDollars: z.coerce.number().int().min(1).max(21_000_000),
  aggregateDollars: z.coerce.number().int().min(1).max(21_000_000),
  expiresAt: z.coerce.date(),
  coveredProfessionCodes: z.array(z.string()).min(1, "Choose the professions this policy covers."),
  documentUrl: z.string().min(1, "Upload the certificate of insurance."),
});

export async function addMalpractice(actor: Actor, raw: z.input<typeof MalpracticeInput>) {
  const providerId = requireProvider(actor);
  const input = MalpracticeInput.parse(raw);
  if (input.expiresAt <= new Date()) throw new DomainError("VALIDATION", "That policy has already expired.");
  const m = await prisma.malpracticePolicy.create({
    data: {
      providerId,
      carrier: input.carrier,
      policyNumber: input.policyNumber,
      perOccurrenceCents: input.perOccurrenceDollars * 100,
      aggregateCents: input.aggregateDollars * 100,
      expiresAt: input.expiresAt,
      coveredProfessionCodes: input.coveredProfessionCodes,
      documentUrl: input.documentUrl,
    },
  });
  await audit(prisma, actor, "malpractice.submitted", "MalpracticePolicy", m.id);
  return m;
}

export async function setSkills(actor: Actor, skills: { skillId: string; proficiency: number; certificationUrl?: string | null; certificationExpiresAt?: string | null }[]) {
  const providerId = requireProvider(actor);
  const catalog = await prisma.skill.findMany({ where: { id: { in: skills.map((s) => s.skillId) } } });
  const existing = await prisma.providerSkill.findMany({ where: { providerId } });
  await prisma.$transaction(async (db) => {
    await db.providerSkill.deleteMany({ where: { providerId, skillId: { notIn: skills.map((s) => s.skillId) } } });
    for (const s of skills) {
      const k = catalog.find((c) => c.id === s.skillId);
      if (!k) continue;
      const prev = existing.find((e) => e.skillId === s.skillId);
      const certChanged = k.requiresCertification && s.certificationUrl && s.certificationUrl !== prev?.certificationUrl;
      await db.providerSkill.upsert({
        where: { providerId_skillId: { providerId, skillId: s.skillId } },
        create: {
          providerId,
          skillId: s.skillId,
          proficiency: Math.min(3, Math.max(1, Math.round(s.proficiency))),
          ...(k.requiresCertification
            ? { certificationUrl: s.certificationUrl ?? null, certificationExpiresAt: s.certificationExpiresAt ? new Date(s.certificationExpiresAt) : null, certificationStatus: s.certificationUrl ? "PENDING_VERIFICATION" : null }
            : {}),
        },
        update: {
          proficiency: Math.min(3, Math.max(1, Math.round(s.proficiency))),
          ...(certChanged ? { certificationUrl: s.certificationUrl, certificationExpiresAt: s.certificationExpiresAt ? new Date(s.certificationExpiresAt) : null, certificationStatus: "PENDING_VERIFICATION" } : {}),
        },
      });
    }
  });
}

export const AvailabilityInput = z.array(z.object({ weekday: z.number().int().min(0).max(6), startMin: z.number().int().min(0).max(1440), endMin: z.number().int().min(1).max(1440) })).max(40);

export async function setAvailability(actor: Actor, raw: z.input<typeof AvailabilityInput>) {
  const providerId = requireProvider(actor);
  const rules = AvailabilityInput.parse(raw).filter((r) => r.endMin > r.startMin);
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: providerId } });
  await prisma.$transaction([
    prisma.availabilityRule.deleteMany({ where: { providerId } }),
    prisma.availabilityRule.createMany({ data: rules.map((r) => ({ ...r, providerId, timeZone: p.homeTimeZone })) }),
  ]);
}

export async function addBlackout(actor: Actor, startsAt: Date, endsAt: Date, reason?: string) {
  const providerId = requireProvider(actor);
  if (endsAt <= startsAt) throw new DomainError("VALIDATION", "End must be after start.");
  return prisma.availabilityBlackout.create({ data: { providerId, startsAt, endsAt, reason: reason?.slice(0, 200) } });
}

export async function addOpenDate(actor: Actor, startsAt: Date, endsAt: Date) {
  const providerId = requireProvider(actor);
  if (endsAt <= startsAt) throw new DomainError("VALIDATION", "End must be after start.");
  return prisma.availabilityOpenDate.create({ data: { providerId, startsAt, endsAt } });
}

export async function removeAvailabilityException(actor: Actor, kind: "blackout" | "open", id: string) {
  const providerId = requireProvider(actor);
  if (kind === "blackout") await prisma.availabilityBlackout.deleteMany({ where: { id, providerId } });
  else await prisma.availabilityOpenDate.deleteMany({ where: { id, providerId } });
}

export async function providerStripeLink(actor: Actor) {
  const providerId = requireProvider(actor);
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: providerId }, include: { user: true } });
  const pay = paymentsProvider();
  let accountId = p.stripeAccountId;
  if (!accountId) {
    accountId = await pay.createConnectedAccount({ email: p.user.email, providerId });
    await prisma.provider.update({ where: { id: providerId }, data: { stripeAccountId: accountId } });
  }
  if (p.stripePayoutsEnabled) {
    const dash = await pay.connectDashboardUrl(accountId);
    if (dash) return dash;
  }
  return pay.connectOnboardingUrl({ accountId, providerId, returnUrl: absoluteUrl("/provider/payouts?stripe=return"), refreshUrl: absoluteUrl("/provider/payouts?stripe=refresh") });
}

export async function refreshProviderStripe(providerId: string) {
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: providerId } });
  if (!p.stripeAccountId) return;
  const st = await paymentsProvider().accountStatus(p.stripeAccountId);
  if (st.payoutsEnabled !== p.stripePayoutsEnabled) await prisma.provider.update({ where: { id: providerId }, data: { stripePayoutsEnabled: st.payoutsEnabled } });
  await recomputeProviderStatus(providerId);
}

// ======================================================================
// Agreements (e-sign)
// ======================================================================

export async function requestAgreement(actor: Actor): Promise<string> {
  const isProvider = actor.role === "PROVIDER";
  const partyId = isProvider ? requireProvider(actor) : requireClinic(actor, { ownerOnly: true });
  const kind = isProvider ? "PROVIDER" : "CLINIC";
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId! } });
  const version = AGREEMENT_VERSION[kind];
  if (esignProvider().name === "dev" && !testSigningEnabled()) {
    throw new DomainError("CONFLICT", "Agreement signing isn't available yet. Please check back soon or contact support.");
  }
  const req = await esignProvider().send({ kind, signerEmail: user.email, signerName: user.name, partyId, version });
  await prisma.agreementSignature.create({
    data: { partyType: isProvider ? "PROVIDER" : "CLINIC", partyId, signerUserId: user.id, version, provider: esignProvider().name, envelopeId: req.envelopeId },
  });
  return req.signUrl;
}

/** From the verified e-sign webhook (or the dev signing page outside production). */
export async function markAgreementSigned(envelopeId: string) {
  const sig = await prisma.agreementSignature.findUnique({ where: { envelopeId } });
  if (!sig || sig.status === "SIGNED") return;
  const now = new Date();
  await prisma.agreementSignature.update({ where: { id: sig.id }, data: { status: "SIGNED", signedAt: now } });
  if (sig.partyType === "PROVIDER") {
    await prisma.provider.update({ where: { id: sig.partyId }, data: { agreementSignedAt: now, agreementVersion: sig.version } });
    await recomputeProviderStatus(sig.partyId);
  } else {
    await prisma.clinicOrg.update({ where: { id: sig.partyId }, data: { agreementSignedAt: now, agreementVersion: sig.version } });
    await activateClinicIfReady(sig.partyId);
  }
  await audit(prisma, { userId: sig.signerUserId, role: "SYSTEM" }, "agreement.signed", sig.partyType, sig.partyId, null, { version: sig.version, envelopeId });
}

// ======================================================================
// Clinic
// ======================================================================

export async function clinicProfile(actor: Actor) {
  const orgId = requireClinic(actor);
  const org = await prisma.clinicOrg.findUniqueOrThrow({
    where: { id: orgId },
    include: {
      locations: { where: { active: true }, include: { skills: { include: { skill: true } }, rateRegion: true }, orderBy: { createdAt: "asc" } },
      members: { include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true } } } },
    },
  });
  const checklist = {
    location: org.locations.length > 0,
    paymentMethod: org.hasPaymentMethod,
    agreement: org.agreementVersion === AGREEMENT_VERSION.CLINIC && !!org.agreementSignedAt,
  };
  return { org, checklist };
}

export const OrgInput = z.object({
  legalName: z.string().trim().min(2).max(160),
  displayName: z.string().trim().min(2).max(160),
  phone: z.string().trim().max(30).optional().nullable(),
  billingEmail: z.string().trim().email().optional().nullable(),
});

export async function updateOrg(actor: Actor, raw: z.input<typeof OrgInput>) {
  const orgId = requireClinic(actor, { ownerOnly: true });
  const input = OrgInput.parse(raw);
  await prisma.clinicOrg.update({ where: { id: orgId }, data: input });
}

export const LocationInput = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(8).max(300),
  addressLine2: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  onSiteContactName: z.string().trim().max(120).optional().nullable(),
  professionCodes: z.array(z.string()).min(1, "Choose at least one profession."),
  patientsPerDay: z.coerce.number().int().min(0).max(1000).optional().nullable(),
  ehr: z.string().trim().max(80).optional().nullable(),
  equipment: z.array(z.string().trim().max(60)).max(20).default([]),
  dressCode: z.string().trim().max(200).optional().nullable(),
  arrivalNotes: z.string().trim().max(2000).optional().nullable(),
  skillIds: z.array(z.string()).default([]),
});

/** State and time zone come from the geocoder only (INV-1). */
export async function saveLocation(actor: Actor, raw: z.input<typeof LocationInput>, locationId?: string) {
  const orgId = requireClinic(actor, { ownerOnly: true });
  const input = LocationInput.parse(raw);
  const existing = locationId ? await prisma.clinicLocation.findFirst({ where: { id: locationId, clinicOrgId: orgId } }) : null;
  if (locationId && !existing) throw new DomainError("NOT_FOUND", "Location not found");
  const addressChanged = !existing || `${existing.addressLine1}, ${existing.city}, ${existing.state} ${existing.zip}`.toLowerCase() !== input.address.toLowerCase();
  let geo: Record<string, unknown> = {};
  if (addressChanged) {
    const g = await geoProvider().geocode(input.address);
    if (!g) throw new DomainError("VALIDATION", "We couldn't verify that address. Include street, city, state and ZIP.");
    geo = { addressLine1: g.addressLine1 || input.address.split(",")[0], city: g.city, state: g.state, zip: g.zip, lat: g.lat, lng: g.lng, timeZone: g.timeZone, geocodedAt: new Date(), rateRegionId: await resolveRateRegion(prisma, g.state, g.zip) };
  }
  const data = {
    name: input.name,
    addressLine2: input.addressLine2 ?? null,
    phone: input.phone ?? null,
    onSiteContactName: input.onSiteContactName ?? null,
    professionCodes: input.professionCodes,
    patientsPerDay: input.patientsPerDay ?? null,
    ehr: input.ehr ?? null,
    equipment: input.equipment,
    dressCode: input.dressCode ?? null,
    arrivalNotes: input.arrivalNotes ?? null,
    ...geo,
  };
  const loc = existing
    ? await prisma.clinicLocation.update({ where: { id: existing.id }, data })
    : await prisma.clinicLocation.create({ data: { ...(data as any), clinicOrgId: orgId } });
  await prisma.locationSkill.deleteMany({ where: { locationId: loc.id } });
  if (input.skillIds.length) await prisma.locationSkill.createMany({ data: input.skillIds.map((skillId) => ({ locationId: loc.id, skillId })), skipDuplicates: true });
  await audit(prisma, actor, existing ? "location.updated" : "location.created", "ClinicLocation", loc.id, existing, loc);
  await activateClinicIfReady(orgId);
  return loc;
}

export async function archiveLocation(actor: Actor, locationId: string) {
  const orgId = requireClinic(actor, { ownerOnly: true });
  const open = await prisma.shift.count({ where: { locationId, location: { clinicOrgId: orgId }, status: { notIn: ["COMPLETED", "UNFILLED", "CANCELLED", "DRAFT"] } } });
  if (open) throw new DomainError("CONFLICT", "This location has active shifts.");
  await prisma.clinicLocation.updateMany({ where: { id: locationId, clinicOrgId: orgId }, data: { active: false } });
}

export async function clinicPaymentSetupUrl(actor: Actor) {
  const orgId = requireClinic(actor, { ownerOnly: true });
  const org = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: orgId } });
  const pay = paymentsProvider();
  let customerId = org.stripeCustomerId;
  if (!customerId) {
    customerId = await pay.createCustomer({ name: org.legalName, email: org.billingEmail ?? "", clinicOrgId: orgId });
    await prisma.clinicOrg.update({ where: { id: orgId }, data: { stripeCustomerId: customerId } });
  }
  return pay.paymentMethodSetupUrl({ customerId, clinicOrgId: orgId, returnUrl: absoluteUrl("/clinic/billing") });
}

export async function inviteStaff(actor: Actor, input: { name: string; email: string }) {
  const orgId = requireClinic(actor, { ownerOnly: true });
  const email = input.email.trim().toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) throw new DomainError("CONFLICT", "That email already has an account.");
  const user = await prisma.user.create({
    data: { email, name: input.name.trim(), role: "CLINIC_STAFF", passwordHash: await hashPassword(randomBytes(24).toString("hex")), clinicMembers: { create: { clinicOrgId: orgId, role: "CLINIC_STAFF" } } },
  });
  const { requestPasswordReset } = await import("./auth");
  await requestPasswordReset(email);
  await sendEmail(email, {
    subject: "You've been added to your clinic's coverage account",
    heading: "You've been invited",
    paragraphs: [`You can now post and manage coverage shifts for your clinic. We've sent a separate email to set your password.`],
  });
  await audit(prisma, actor, "clinic.staff_invited", "User", user.id);
  return user;
}
