import { randomBytes } from "node:crypto";
import { z } from "zod";
import { DomainError, licensedPairs, scanContactInfo, NATIONAL_CREDENTIAL, normalizeLinkedIn, US_STATES } from "@cm/core";
import { prisma, type Prisma } from "@cm/db";
import { esignProvider, GeoServiceError, geoProvider, lookupNpi, paymentsProvider, testSigningEnabled } from "@cm/integrations";
import { AGREEMENT_VERSION, agreementAccepted, buildAgreementFor, sha256, type AgreementDoc } from "./agreements";
import { audit, getSettings, requireClinic, requireProvider, SYSTEM, type Actor } from "./context";
import { absoluteUrl, notify, sendEmail } from "./notify";
import { activateClinicIfReady } from "./payments";
import { resolveRateRegion } from "./pricing";
import { hashPassword } from "./auth";
import { onLeadConverted } from "./leads";
import { nationalCredentialStates } from "./eligibility";



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
    agreement: await agreementAccepted("PROVIDER", p.agreementSignedAt, p.agreementVersion),
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

/**
 * "Profile complete" is evaluated per profession (Addendum 01 §4). An admin
 * approval waives the profile-type steps; it never waives credentials —
 * matching still requires a verified license and malpractice (INV-1, INV-3)
 * and Stripe payouts (F3), which is also when the "ready" email goes out.
 */
export async function recomputeProviderStatus(providerId: string) {
  const { common, perProfession } = await providerChecklist(providerId);
  const provider = await prisma.provider.findUniqueOrThrow({ where: { id: providerId }, include: { user: true } });
  const approved = !!provider.adminApprovedAt;
  const base = approved || (common.profile && common.photo && common.homeBase && common.emailVerified && common.payouts && common.agreement);
  let anyActive = false;
  for (const pp of perProfession) {
    const ready = approved || (base && pp.license && pp.malpractice && pp.npi);
    if (ready) anyActive = true;
    if (ready && pp.status === "ONBOARDING") {
      await prisma.providerProfession.update({ where: { providerId_professionCode: { providerId, professionCode: pp.professionCode } }, data: { status: "ACTIVE", profileCompleteAt: new Date() } });
      pp.status = "ACTIVE";
    }
  }
  let status = provider.status;
  if (anyActive && provider.status === "ONBOARDING") {
    await prisma.provider.update({ where: { id: providerId }, data: { status: "ACTIVE", profileCompleteAt: new Date() } });
    await audit(prisma, SYSTEM, "provider.activated", "Provider", providerId, { status: "ONBOARDING" }, { status: "ACTIVE" });
    await onLeadConverted([provider.userId], null);
    status = "ACTIVE";
  }
  // "You can start taking shifts": once per profession, only when matching would actually accept them.
  if (status !== "ACTIVE" || !common.payouts || !common.agreement) return;
  for (const pp of perProfession) {
    if (pp.status !== "ACTIVE" || !pp.license || !pp.malpractice) continue;
    const claimed = await prisma.digestSend.createMany({ data: [{ key: `ready:${providerId}:${pp.professionCode}`, userId: provider.userId }], skipDuplicates: true });
    if (!claimed.count) continue;
    await notify(prisma, provider.userId, {
      template: "provider_ready",
      title: `You're all set to take ${pp.displayName} shifts`,
      body: `Your onboarding is complete. You'll now see ${pp.displayName.toLowerCase()} shifts you qualify for and can receive offers.`,
      link: "/provider/shifts",
      ctaLabel: "Find shifts",
    });
  }
}

export const ProviderProfileInput = z.object({
  legalName: z.string().trim().min(2).max(120),
  displayName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(30),
  bio: z.string().trim().max(1500).optional().nullable(),
  homeAddress: z.string().trim().min(5).max(300),
  /** Google place ID from the address autocomplete, when the provider picked a suggestion. */
  homeAddressPlaceId: z.string().trim().max(300).optional().nullable(),
  personalInjuryExperience: z.boolean().optional().nullable(),
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
    const g = await geocodeAddress(input.homeAddress, input.homeAddressPlaceId);
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
  const thisYear = new Date().getFullYear();
  if (input.graduationYear && input.graduationYear > thisYear) throw new DomainError("VALIDATION", "Your graduation year can't be in the future.");
  const claimed = Math.max(0, ...Object.values(input.yearsInPractice ?? {}));
  if (claimed > 0 && !input.graduationYear) throw new DomainError("VALIDATION", "Add your graduation year so we can confirm your years of experience.");
  if (input.graduationYear && claimed > thisYear - input.graduationYear) {
    throw new DomainError("VALIDATION", `Years practicing can't be more than ${thisYear - input.graduationYear} — the years since you graduated in ${input.graduationYear}.`);
  }
  if (input.bio && scanContactInfo(input.bio).found) throw new DomainError("VALIDATION", "Please remove phone numbers, emails, links and social handles from your bio. Clinics book you through the platform.");
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
        ...(input.personalInjuryExperience !== undefined ? { personalInjuryExperience: input.personalInjuryExperience } : {}),
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
  // Dropbox Sign only when its key is set; otherwise our own signing page (the default).
  if (esignProvider().name === "dropbox-sign") {
    const req = await esignProvider().send({ kind, signerEmail: user.email, signerName: user.name, partyId, version });
    await prisma.agreementSignature.create({
      data: { partyType: kind, partyId, signerUserId: user.id, version, provider: "dropbox-sign", envelopeId: req.envelopeId },
    });
    return req.signUrl;
  }
  // Reuse an unsigned request for the same version rather than piling up rows.
  const open = await prisma.agreementSignature.findFirst({ where: { partyType: kind, partyId, signerUserId: user.id, version, provider: "internal", status: "SENT" } });
  const envelopeId = open?.envelopeId ?? `sig_${randomBytes(18).toString("base64url")}`;
  if (!open) await prisma.agreementSignature.create({ data: { partyType: kind, partyId, signerUserId: user.id, version, provider: "internal", envelopeId } });
  return `/agreements/sign/${envelopeId}`;
}

async function signatureForSigner(actor: Actor, envelopeId: string) {
  const sig = await prisma.agreementSignature.findUnique({ where: { envelopeId } });
  if (!sig || sig.signerUserId !== actor.userId || sig.provider !== "internal") throw new DomainError("NOT_FOUND", "Agreement not found");
  return sig;
}

/** The signing page: the prefilled document for this signer, dated today. Records the first view. */
export async function agreementForSigning(actor: Actor, envelopeId: string) {
  const sig = await signatureForSigner(actor, envelopeId);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: sig.signerUserId } });
  if (sig.status === "SIGNED") return { sig, user, doc: sig.document as unknown as AgreementDoc, hash: sig.documentHash, signed: true };
  if (!sig.viewedAt) await prisma.agreementSignature.update({ where: { id: sig.id }, data: { viewedAt: new Date() } });
  const kind = sig.partyType === "CLINIC" ? "CLINIC" : "PROVIDER";
  const { doc, hash } = await buildAgreementFor(kind, sig.partyId, { name: user.name, email: user.email }, new Date());
  return { sig, user, doc, hash, signed: false };
}

export const SignInput = z.object({
  typedName: z.string().trim().min(3, "Type your full legal name to sign.").max(120),
  title: z.string().trim().max(80).optional().nullable(),
  consent: z.literal(true, { message: "Please agree to sign electronically." }),
  agree: z.literal(true, { message: "Please confirm you have read and agree to the agreement." }),
  /** SHA-256 of the text the signer was shown; must match what we'd record now. */
  viewedHash: z.string().length(64),
});

/**
 * In-house e-signature (ESIGN Act / UETA): consent to electronic records,
 * intent (typed name + explicit agreement), attribution (signed-in account,
 * IP, device) and integrity (the exact text and its SHA-256 are stored).
 */
export async function signAgreement(actor: Actor, envelopeId: string, raw: { typedName: string; title?: string | null; consent: boolean; agree: boolean; viewedHash: string }, meta: { ip: string | null; userAgent: string | null }) {
  const input = SignInput.parse(raw);
  const sig = await signatureForSigner(actor, envelopeId);
  if (sig.status === "SIGNED") return sig.id;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: sig.signerUserId } });
  const kind = sig.partyType === "CLINIC" ? "CLINIC" : "PROVIDER";
  if (kind === "CLINIC" && !input.title) throw new DomainError("VALIDATION", "Add your title (for example Owner or Office Manager).");
  const now = new Date();
  const { doc, text, hash } = await buildAgreementFor(kind, sig.partyId, { name: user.name, email: user.email }, now);
  if (hash !== input.viewedHash) throw new DomainError("CONFLICT", "The agreement was updated while you were reading it. Please review the current version and sign again.");
  await prisma.agreementSignature.update({
    where: { id: sig.id },
    data: {
      typedSignature: input.typedName,
      signerTitle: input.title ?? null,
      signerEmail: user.email,
      signerIp: meta.ip?.slice(0, 64) ?? null,
      signerAgent: meta.userAgent?.slice(0, 400) ?? null,
      consentAt: now,
      document: doc as unknown as Prisma.InputJsonValue,
      documentText: text,
      documentHash: hash,
    },
  });
  await markAgreementSigned(envelopeId);
  await sendSignedCopy(sig.id).catch(() => undefined);
  return sig.id;
}

/** A signed copy: for the signer, members of the signing clinic / the provider, and admins. */
export async function signedAgreement(actor: Actor, id: string) {
  const sig = await prisma.agreementSignature.findUnique({ where: { id } });
  if (!sig || sig.status !== "SIGNED") throw new DomainError("NOT_FOUND", "Agreement not found");
  const allowed =
    actor.role === "PLATFORM_ADMIN" ||
    sig.signerUserId === actor.userId ||
    (sig.partyType === "CLINIC" && actor.clinicOrgId === sig.partyId) ||
    (sig.partyType === "PROVIDER" && actor.providerId === sig.partyId);
  if (!allowed) throw new DomainError("NOT_FOUND", "Agreement not found");
  const signer = await prisma.user.findUnique({ where: { id: sig.signerUserId }, select: { name: true, email: true } });
  return { sig, signer, doc: sig.document as unknown as AgreementDoc | null, intact: !!sig.documentText && sha256(sig.documentText) === sig.documentHash };
}

/** The latest signed agreement for a clinic or provider (for "View signed agreement" links). */
export async function latestSignedAgreement(partyType: "CLINIC" | "PROVIDER", partyId: string) {
  return prisma.agreementSignature.findFirst({ where: { partyType, partyId, status: "SIGNED" }, orderBy: { signedAt: "desc" }, select: { id: true, version: true, signedAt: true, provider: true } });
}

async function sendSignedCopy(id: string) {
  const sig = await prisma.agreementSignature.findUniqueOrThrow({ where: { id } });
  const doc = sig.document as unknown as AgreementDoc | null;
  if (!doc || !sig.signerEmail) return;
  const when = sig.signedAt!.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "long", timeStyle: "long" });
  const paragraphs = [
    `Thanks for signing. Your copy of the ${doc.title} (version ${doc.version}) is below and always available in your account.`,
    `Signed by ${sig.typedSignature}${sig.signerTitle ? `, ${sig.signerTitle}` : ""} (${sig.signerEmail}) on ${when}. Document fingerprint (SHA-256): ${sig.documentHash}.`,
    ...doc.parties.map((p) => `${p.label}: ${p.lines.join(" · ")}`),
    ...doc.sections.flatMap((x) => [x.heading.toUpperCase(), ...x.paragraphs]),
  ];
  await sendEmail(sig.signerEmail, { subject: `Your signed ${doc.title}`, heading: "Your signed agreement", paragraphs, cta: { label: "View or print your copy", url: `/agreements/signed/${sig.id}` } });
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
    agreement: await agreementAccepted("CLINIC", org.agreementSignedAt, org.agreementVersion),
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

export const EXPERIENCE_LEVELS = [0, 2, 5, 10] as const;

/** Clinic attire a location asks providers to wear (one per location). */
export const ATTIRE_OPTIONS = ["Medical scrubs", "Business casual", "Business with clinical jacket"] as const;

/** Clinic default: minimum years of experience for new shifts, and whether emergencies relax it. */
export async function setExperiencePreference(actor: Actor, minYears: number, relaxInEmergency: boolean) {
  const orgId = requireClinic(actor, { ownerOnly: true });
  if (!(EXPERIENCE_LEVELS as readonly number[]).includes(minYears)) throw new DomainError("VALIDATION", "Pick one of the experience levels.");
  await prisma.clinicOrg.update({ where: { id: orgId }, data: { minYearsExperience: minYears, relaxExperienceInEmergency: relaxInEmergency } });
}

export const LocationInput = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(8).max(300),
  addressPlaceId: z.string().trim().max(300).optional().nullable(),
  addressLine2: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  onSiteContactName: z.string().trim().max(120).optional().nullable(),
  professionCodes: z.array(z.string()).min(1, "Choose at least one profession."),
  patientsPerDay: z.coerce.number().int().min(0).max(1000).optional().nullable(),
  ehr: z.string().trim().max(80).optional().nullable(),
  equipment: z.array(z.string().trim().max(60)).max(20).default([]),
  dressCode: z.string().trim().max(200).refine((v) => !v || (ATTIRE_OPTIONS as readonly string[]).includes(v), "Pick the attire: medical scrubs, business casual, or business with clinical jacket.").optional().nullable(),
  arrivalNotes: z.string().trim().max(2000).optional().nullable(),
  skillIds: z.array(z.string()).default([]),
});

/** Geocode or explain why not: a bad address and a broken address service get different messages. */
async function geocodeAddress(address: string, placeId?: string | null) {
  try {
    const g = await geoProvider().geocode(address, { placeId });
    if (g) return g;
  } catch (e) {
    if (e instanceof GeoServiceError) {
      throw new DomainError("VALIDATION", `Address lookup isn't working right now, so this couldn't be saved. Please try again later. (${e.message})`);
    }
    throw e;
  }
  throw new DomainError("VALIDATION", "We couldn't find that street address. Pick it from the suggestions, or enter street, city, state and ZIP.");
}

/** State and time zone come from the geocoder only (INV-1). */
export async function saveLocation(actor: Actor, raw: z.input<typeof LocationInput>, locationId?: string) {
  const orgId = requireClinic(actor, { ownerOnly: true });
  const input = LocationInput.parse(raw);
  const existing = locationId ? await prisma.clinicLocation.findFirst({ where: { id: locationId, clinicOrgId: orgId } }) : null;
  if (locationId && !existing) throw new DomainError("NOT_FOUND", "Location not found");
  const addressChanged = !existing || `${existing.addressLine1}, ${existing.city}, ${existing.state} ${existing.zip}`.toLowerCase() !== input.address.toLowerCase();
  let geo: Record<string, unknown> = {};
  if (addressChanged) {
    const g = await geocodeAddress(input.address, input.addressPlaceId);
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

export const MAX_LOCATION_PHOTOS = 4;

/** Exterior / entrance photos that help booked providers find the clinic. */
export async function addLocationPhotos(actor: Actor, locationId: string, keys: string[]) {
  const orgId = requireClinic(actor);
  const loc = await prisma.clinicLocation.findFirst({ where: { id: locationId, clinicOrgId: orgId } });
  if (!loc) throw new DomainError("NOT_FOUND", "Location not found");
  if (loc.photoKeys.length + keys.length > MAX_LOCATION_PHOTOS) throw new DomainError("VALIDATION", `Up to ${MAX_LOCATION_PHOTOS} photos per location.`);
  await prisma.clinicLocation.update({ where: { id: loc.id }, data: { photoKeys: [...loc.photoKeys, ...keys] } });
}

export async function removeLocationPhoto(actor: Actor, locationId: string, key: string) {
  const orgId = requireClinic(actor);
  const loc = await prisma.clinicLocation.findFirst({ where: { id: locationId, clinicOrgId: orgId } });
  if (!loc) throw new DomainError("NOT_FOUND", "Location not found");
  await prisma.clinicLocation.update({ where: { id: loc.id }, data: { photoKeys: loc.photoKeys.filter((k) => k !== key) } });
}

/** Who may view a location photo: that clinic's members, and providers booked there (upcoming or within the last day). */
export async function canViewLocationPhoto(actor: Actor, key: string) {
  const m = /^locations\/([^/]+)\//.exec(key);
  if (!m) return false;
  const loc = await prisma.clinicLocation.findUnique({ where: { id: m[1] }, select: { clinicOrgId: true, photoKeys: true } });
  if (!loc || !loc.photoKeys.includes(key)) return false;
  if (actor.clinicOrgId && actor.clinicOrgId === loc.clinicOrgId) return true;
  if (!actor.providerId) return false;
  return !!(await prisma.assignment.findFirst({
    where: { providerId: actor.providerId, status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] }, endsAt: { gte: new Date(Date.now() - 86_400_000) }, shift: { locationId: m[1] } },
    select: { id: true },
  }));
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
