import { z } from "zod";
import {
  assertTransition,
  cancellationOutcome,
  flyInAirfareKept,
  flyInAirfareCents,
  flyInNightlyCents,
  flyInPostingProblem,
  flyInUntil,
  DomainError,
  evaluateEligibility,
  favoritesWindowEnd,
  looksLikePhi,
  lunchProblem,
  medianVisits,
  underDeclareWarning,
  NATIONAL_CREDENTIAL,
  minPostingLeadOk,
  parseAttestation,
  providerView,
  scanContactInfo,
  selectionDeadline,
  shiftIsCancellable,
  skillScopeProblem,
  supervisionProblem,
  travelEstimate,
} from "@cm/core";
import { isInvariantViolation, prisma, Prisma } from "@cm/db";
import { agreementAccepted } from "./agreements";
import { audit, clock, getSettings, lockShift, SYSTEM, requireAdmin, requireClinic, requireProvider, tx, type Actor, type Db } from "./context";
import { confirmInTx, confirmProvider } from "./confirm";
import { Effects } from "./effects";
import { assertProviderEligibleForShift, eligibilityOptions, evaluateProviderForShifts, getEligibleProviders, loadProviders, loadShift, nationalCredentialStates } from "./eligibility";
import { logMatchRun, rankEvaluated } from "./matching";
import { notify, notifyAdmins, notifyClinic } from "./notify";
import { depositPaidCents, refundAssignment } from "./payments";
import { quoteShift, validatePromoForClinic } from "./pricing";
import { referralCreditFor } from "./referrals";

// ======================================================================
// Posting (clinic)
// ======================================================================

export const ShiftInput = z.object({
  locationId: z.string().min(1),
  professionCode: z.string().min(1),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  requiredSkillIds: z.array(z.string()).default([]),
  preferredSkillIds: z.array(z.string()).default([]),
  expectedPatients: z.coerce.number().int().min(0).max(500).nullable().optional(),
  /** Minimum years of experience (0 = any). Omitted = the clinic's default from Settings. */
  minYearsExperience: z.coerce.number().int().min(0).max(40).optional(),
  notes: z.string().max(2000).nullable().optional(),
  instantBook: z.boolean().default(false),
  maxTravelBudgetCents: z.coerce.number().int().min(0).nullable().optional(),
  lodgingAllowed: z.boolean().default(false),
  lodgingCapCentsPerNight: z.coerce.number().int().min(0).nullable().optional(),
  /** Fly-in coverage OK (whole booking; flyInFields checks days and notice). */
  flyIn: z.boolean().optional(),
  /** Multi-day: one provider for every day (core/sameProvider.ts); undefined = Settings default. */
  sameProvider: z.boolean().optional(),
  /** No provider available yet: post it automatically once one is (default on). */
  autoPostWhenAvailable: z.boolean().optional(),
  /** Unpaid lunch: minutes (0 = none) and when it starts. Paid hours exclude it, up to the day-length limit. */
  lunchMinutes: z.coerce.number().int().min(0).max(300).default(0),
  lunchStartsAt: z.coerce.date().nullable().optional(),
  promoCode: z.string().max(60).nullable().optional(),
  supervisionAttestation: z
    .object({
      supervisorName: z.string(),
      supervisorProfessionCode: z.string(),
      supervisorLicenseNumber: z.string(),
      onSiteEntireShift: z.boolean(),
    })
    .nullable()
    .optional(),
  /** Clinic-set rate (beta): the clinic's own lower price and its release choice, as shown at posting. */
  clinicRate: z
    .object({
      priceCents: z.coerce.number().int().min(0),
      release: z.boolean(),
      releaseAt: z.string().nullable(),
      releaseHours: z.coerce.number().int(),
      accepted: z.boolean(),
    })
    .nullable()
    .optional(),
});
export type ShiftInputT = z.input<typeof ShiftInput>;

/** Straight-line miles between two points (haversine). */
function milesBetween(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 2 * 3959 * Math.asin(Math.sqrt(h));
}

/** What the posting wizard needs for a location: professions (enabled or "not yet available"), skills, supervision. */
export async function postingOptions(actor: Actor, locationId: string) {
  const orgId = requireClinic(actor);
  const loc = await prisma.clinicLocation.findFirst({ where: { id: locationId, clinicOrgId: orgId } });
  if (!loc) throw new DomainError("NOT_FOUND", "Location not found");
  const [professions, pscs, stateCfg] = await Promise.all([
    prisma.profession.findMany({ where: { code: { in: loc.professionCodes } }, orderBy: { sortOrder: "asc" } }),
    prisma.professionStateConfig.findMany({ where: { state: loc.state, professionCode: { in: loc.professionCodes } } }),
    prisma.stateConfig.findUnique({ where: { state: loc.state } }),
  ]);
  const out = [];
  for (const p of professions) {
    const psc = pscs.find((x) => x.professionCode === p.code);
    const enabled = !!stateCfg?.enabled && !!psc?.enabled;
    const skills = await prisma.skill.findMany({
      where: { active: true, OR: [{ professionCode: p.code }, { professionCode: null }] },
      include: { stateRules: { where: { professionCode: p.code, state: loc.state } } },
      orderBy: { name: "asc" },
    });
    out.push({
      code: p.code,
      displayName: p.displayName,
      pricingModel: p.pricingModel,
      enabled,
      unavailableReason: enabled ? null : `Not yet available in ${loc.state}`,
      supervisionRequired: psc?.supervisionRequired ?? p.requiresSupervisionDefault,
      supervisingProfessionCodes: psc?.supervisingProfessionCodes?.length ? psc.supervisingProfessionCodes : p.defaultSupervisingProfessionCodes,
      // Scope-sensitive skills appear only where a rule allows them.
      skills: skills.filter((k) => !k.scopeSensitive || k.stateRules.some((r) => r.allowed)).map((k) => ({ id: k.id, name: k.name, crossProfession: k.professionCode === null })),
    });
  }
  return { location: loc, professions: out };
}

export async function validateShiftInput(db: Db, orgId: string, input: z.output<typeof ShiftInput>, forPosting: boolean) {
  const loc = await db.clinicLocation.findFirst({ where: { id: input.locationId, clinicOrgId: orgId, active: true } });
  if (!loc) throw new DomainError("NOT_FOUND", "Location not found");
  if (!loc.professionCodes.includes(input.professionCode)) throw new DomainError("VALIDATION", "This location doesn't post shifts for that profession. Add it in Locations first.");
  const lunch = lunchProblem(input, input.lunchMinutes, input.lunchStartsAt ?? null);
  if (lunch) throw new DomainError("VALIDATION", lunch);
  if (input.notes && looksLikePhi(input.notes)) throw new DomainError("VALIDATION", "Please remove patient information from the notes. Do not include patient information.");
  if (input.notes && scanContactInfo(input.notes).found) throw new DomainError("VALIDATION", "Please don't include phone numbers, emails or links in shift notes — contact details are shared after confirmation.");
  const skillIds = [...new Set([...input.requiredSkillIds, ...input.preferredSkillIds])];
  const skills = await db.skill.findMany({
    where: { id: { in: skillIds } },
    include: { stateRules: { where: { professionCode: input.professionCode, state: loc.state } } },
  });
  if (skills.length !== skillIds.length || skills.some((k) => k.professionCode !== null && k.professionCode !== input.professionCode)) {
    throw new DomainError("VALIDATION", "Choose skills for this profession only.");
  }
  const scope = skillScopeProblem(skills.map((k) => ({ id: k.id, requiresCertification: k.requiresCertification, scopeSensitive: k.scopeSensitive, allowedInScope: k.stateRules.some((r) => r.allowed) })));
  if (scope) throw new DomainError("SKILL_NOT_IN_SCOPE", scope);

  const [psc, stateCfg, profession] = await Promise.all([
    db.professionStateConfig.findUnique({ where: { professionCode_state: { professionCode: input.professionCode, state: loc.state } } }),
    db.stateConfig.findUnique({ where: { state: loc.state } }),
    db.profession.findUniqueOrThrow({ where: { code: input.professionCode } }),
  ]);
  const supervisionRequired = psc?.supervisionRequired ?? profession.requiresSupervisionDefault;
  if (forPosting) {
    if (!stateCfg?.enabled) throw new DomainError("STATE_NOT_ENABLED", `We're not yet accepting shifts in ${loc.state}.`);
    if (!psc?.enabled) throw new DomainError("PROFESSION_NOT_ENABLED", `${profession.displayName} shifts are not yet available in ${loc.state}.`);
    if (!minPostingLeadOk(new Date(), input.startsAt)) throw new DomainError("VALIDATION", "Shifts must start at least 2 hours from now.");
    if (supervisionRequired) {
      const codes = psc.supervisingProfessionCodes.length ? psc.supervisingProfessionCodes : profession.defaultSupervisingProfessionCodes;
      const why = supervisionProblem(parseAttestation(input.supervisionAttestation), codes);
      if (why) throw new DomainError("SUPERVISION_NOT_ATTESTED", why);
    }
  }
  return { loc, supervisionRequired };
}

export async function quoteForClinic(actor: Actor, raw: ShiftInputT, opts: { needed?: number; days?: number } = {}) {
  const orgId = requireClinic(actor);
  const input = ShiftInput.parse(raw);
  const { loc: location } = await validateShiftInput(prisma, orgId, input, false);
  const q = await quoteShift(prisma, { ...input, promoCode: input.promoCode?.trim() || (await autoCredit(prisma, orgId)) });
  // Estimated travel range from currently eligible providers (clinic never sees provider pay).
  let travel: { minCents: number; maxCents: number; candidates: number } | null = null;
  const { clinicRatePreview } = await import("./clinicRate");
  const loc = await prisma.clinicLocation.findUniqueOrThrow({ where: { id: input.locationId }, select: { timeZone: true } });
  const clinicRate = await clinicRatePreview(prisma, { startsAt: input.startsAt, marketClinicPriceCents: q.base.clinicPriceCents, timeZone: loc.timeZone, days: 1 });
  // Open states: how many providers could take this shift right now (the posting gate's own check).
  const supply = await liveSupply(input, location, q, opts.needed ?? 1, opts.days ?? 1);
  const payInFull = (await prisma.clinicOrg.findUnique({ where: { id: orgId }, select: { payInFull: true } }))?.payInFull ?? false;
  return {
    supply,
    payInFull,
    clinicRate,
    coverageCents: q.base.clinicPriceCents,
    discountCents: q.promo?.discountCents ?? 0,
    promoCode: q.promo?.code ?? null,
    premiums: q.base.premiums,
    tier: q.base.tier,
    hours: q.base.hours,
    spanHours: q.base.spanHours,
    lunchMinutes: q.base.lunchMinutes,
    overtimeHours: q.base.overtimeHours,
    billableHours: q.base.billableHours,
    subtotalCents: q.base.clinicPriceCents - (q.promo?.discountCents ?? 0),
    travel,
    volume: q.volume ? await clinicVolumeView(q.volume, input.locationId, input.expectedPatients ?? null) : null,
    // Other live bookings at this location overlapping this time (fine when more providers are needed).
    overlapping: await prisma.shift.count({
      where: { locationId: input.locationId, status: { notIn: ["DRAFT", "CANCELLED", "UNFILLED", "COMPLETED"] }, startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt } },
    }),
  };
}

/**
 * Clinic-facing volume facts for the posting screen: the tier booked, both tier prices (never
 * provider pay), the extra-visit rule, the location's recent visit counts and the under-declare hint.
 */
async function liveSupply(input: z.output<typeof ShiftInput>, loc: Prisma.ClinicLocationGetPayload<object>, q: Awaited<ReturnType<typeof quoteShift>>, needed: number, days: number) {
  const supply = await import("./supply");
  if (!(await supply.supplyGateOn())) return null;
  const org = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: loc.clinicOrgId }, select: { verificationStatus: true, verifiedUntil: true, verificationGraceUntil: true, minYearsExperience: true } });
  const r = await supply.previewSupply(
    prisma,
    {
      locationId: loc.id, professionCode: input.professionCode, state: loc.state, startsAt: input.startsAt, endsAt: input.endsAt,
      requiredSkillIds: input.requiredSkillIds, preferredSkillIds: input.preferredSkillIds, minYearsExperience: input.minYearsExperience ?? org.minYearsExperience,
      lodgingAllowed: input.lodgingAllowed, maxTravelBudgetCents: input.maxTravelBudgetCents ?? null,
      flyInAirfareCents: null, flyInNightlyCents: null, flyInUntil: null,
      durationTier: q.base.tier, providerPayCents: input.clinicRate ? Math.round((q.base.providerPayCents * input.clinicRate.priceCents) / Math.max(1, q.base.clinicPriceCents)) : q.base.providerPayCents,
      lunchMinutes: input.lunchMinutes, lodgingCapCentsPerNight: null,
      supervisionAttestedAt: input.supervisionAttestation ? new Date() : null, supervisionAttestation: (input.supervisionAttestation ?? null) as Prisma.JsonValue,
      location: { clinicOrgId: loc.clinicOrgId, lat: loc.lat, lng: loc.lng, timeZone: loc.timeZone, clinicOrg: org },
    },
    needed,
    !!input.clinicRate,
    days,
  );
  return { ok: r.ok, available: r.available, gap: r.gap, headline: r.headline, hint: r.hint, detail: r.detail };
}

async function clinicVolumeView(v: NonNullable<Awaited<ReturnType<typeof quoteShift>>["volume"]>, locationId: string, expected: number | null) {
  const s = await getSettings();
  const n = s["pricing.underDeclareWarningShifts"];
  const recent = await prisma.visitCount.findMany({
    where: { finalVisits: { not: null }, assignment: { shift: { locationId } } },
    orderBy: { assignment: { startsAt: "desc" } },
    take: Math.max(3, n),
    select: { finalVisits: true },
  });
  const counts = recent.map((r) => r.finalVisits!);
  return {
    tier: v.tier,
    // Clinic sees its own per-visit price only, never the provider's share.
    terms: { ceiling: v.terms.ceiling, grace: v.terms.grace, overageClinicCents: v.terms.overageClinicCents },
    disputeHours: s["pricing.volumeDisputeHours"],
    ceilings: v.ceilings,
    clinicPrices: v.clinicPrices,
    recentCounts: counts.slice(0, 3),
    suggested: counts.length >= 3 ? medianVisits(counts.slice(0, 3)) : null,
    warning: expected != null ? underDeclareWarning(expected, v.terms.ceiling, counts, n) : null,
  };
}

/** An unused referral credit the clinic can use now (applied when no other code is entered). */
async function autoCredit(db: Db, orgId: string): Promise<string | null> {
  const code = await referralCreditFor(orgId);
  if (!code) return null;
  try {
    await validatePromoForClinic(db, code, orgId);
    return code;
  } catch {
    return null;
  }
}

/** Create (and optionally post) a shift. Price comes only from the rate engine (INV-7). */
export async function createShift(actor: Actor, raw: ShiftInputT, opts: { post: boolean }) {
  const orgId = requireClinic(actor);
  const input = ShiftInput.parse(raw);
  const effects = new Effects();
  // Open states: posting needs an available provider, checked on the saved draft before it goes out (supply.ts).
  const { assertSupplyForPosting, supplyGateOn } = await import("./supply");
  const gate = opts.post && (await supplyGateOn());
  const shiftId = await tx(async (db) => {
    const org = await db.clinicOrg.findUniqueOrThrow({ where: { id: orgId } });
    if (opts.post && (org.status === "SUSPENDED" || org.status === "DEACTIVATED")) throw new DomainError("FORBIDDEN", "Your account is suspended, so new shifts can't be posted. Please contact us.");
    if (opts.post && (org.status !== "ACTIVE" || !org.hasPaymentMethod)) {
      throw new DomainError("FORBIDDEN", "Finish setup (payment method and agreement) before posting shifts.");
    }
    if (opts.post && !(await agreementAccepted("CLINIC", org.agreementSignedAt, org.agreementVersion))) {
      throw new DomainError("FORBIDDEN", "Please sign the current Clinic Platform Agreement in Settings before posting shifts.");
    }
    if (opts.post) await assertNoOpenChargeback(orgId);
    const { supervisionRequired, loc } = await validateShiftInput(db, orgId, input, opts.post);
    if (input.clinicRate && !opts.post) throw new DomainError("VALIDATION", "A clinic-set rate is applied when you post. Post the shift now, or switch back to the market price to save a draft.");
    const q = await quoteShift(db, { ...input, promoCode: input.clinicRate ? null : input.promoCode?.trim() || (await autoCredit(db, orgId)) });
    const rate = input.clinicRate
      ? await (await import("./clinicRate")).prepareClinicRate(db, actor, input.clinicRate, { startsAt: input.startsAt, timeZone: loc.timeZone, promoCode: input.promoCode }, q.base)
      : null;
    const shift = await db.shift.create({
      data: {
        locationId: input.locationId,
        professionCode: input.professionCode,
        state: "XX", // replaced by trigger from the location's geocoded state
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        requiredSkillIds: input.requiredSkillIds,
        preferredSkillIds: input.preferredSkillIds,
        minYearsExperience: input.minYearsExperience ?? org.minYearsExperience,
        expectedPatients: input.expectedPatients ?? null,
        notes: input.notes?.trim() || null,
        instantBook: input.instantBook,
        maxTravelBudgetCents: input.maxTravelBudgetCents ?? null,
        lodgingAllowed: input.lodgingAllowed,
        lunchMinutes: input.lunchMinutes,
        lunchStartsAt: input.lunchMinutes ? (input.lunchStartsAt ?? null) : null,
        // Flat nightly allowance from Settings (no receipts), kept with the shift.
        lodgingCapCentsPerNight: input.lodgingAllowed ? (await getSettings(db))["pricing.lodgingNightlyCents"] : null,
        rateCardId: q.rateCardId,
        durationTier: q.base.tier,
        clinicPriceCents: q.base.clinicPriceCents,
        providerPayCents: q.base.providerPayCents,
        premiumsApplied: q.base.premiums as unknown as Prisma.InputJsonValue,
        declaredTier: q.volume?.tier ?? null,
        volumeTerms: q.volume ? (q.volume.terms as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        promoCodeId: q.promo?.id ?? null,
        promoDiscountCents: q.promo?.discountCents ?? 0,
        ...(supervisionRequired && input.supervisionAttestation
          ? { supervisionAttestation: parseAttestation(input.supervisionAttestation) as unknown as Prisma.InputJsonValue, supervisionAttestedById: actor.userId, supervisionAttestedAt: new Date() }
          : {}),
        ...(rate?.data ?? {}),
        createdById: actor.userId!,
      },
    });
    await audit(db, actor, "shift.created", "Shift", shift.id, null, { status: "DRAFT", clinicPriceCents: shift.clinicPriceCents, providerPayCents: shift.providerPayCents, rateMode: shift.rateMode });
    if (rate) effects.add(async () => (await import("./clinicRate")).sendClinicRateReceipt(shift.id));
    if (opts.post && !gate) await postInTx(db, actor, shift.id, effects);
    return shift.id;
  });
  if (gate) {
    try {
      await assertSupplyForPosting([shiftId], 1, [], { autoPost: input.autoPostWhenAvailable ?? true });
    } catch (e) {
      // A clinic-set rate is only kept on a posted shift: nothing is saved.
      if (input.clinicRate && e instanceof DomainError && e.code === "NO_PROVIDER_AVAILABLE") {
        await prisma.postingDemand.updateMany({ where: { shiftId }, data: { shiftId: null } });
        await prisma.shift.delete({ where: { id: shiftId } });
        throw new DomainError("NO_PROVIDER_AVAILABLE", e.message.replace(/We saved it as a draft.*$/, "Nothing was saved; try the market price or another day."), { gap: (e.details as { gap?: string })?.gap });
      }
      throw e;
    }
    await effects.run();
    await postShift(actor, shiftId, { skipSupply: true });
    return { shiftId };
  }
  await effects.run();
  return { shiftId };
}

/**
 * Fly-in for a booking (all its days): enough consecutive days and notice (core flyInPostingProblem),
 * then the destination's airfare and nightly allowances and the cut-off are snapshotted on each day.
 * Throws a clear VALIDATION error when it can't be offered; null when fly-in isn't asked for.
 */
export async function flyInFields(locationId: string, days: { startsAt: Date; endsAt: Date; flyIn?: boolean }[]) {
  if (!days.some((d) => d.flyIn)) return null;
  const s = await getSettings();
  if (!s["flyIn.enabled"]) throw new DomainError("VALIDATION", "Fly-in coverage isn't available right now. Untick it to post.");
  const why = flyInPostingProblem(days, clock.now(), s);
  if (why) throw new DomainError("VALIDATION", why);
  const loc = await prisma.clinicLocation.findUniqueOrThrow({ where: { id: locationId }, select: { state: true } });
  const first = days.reduce((a, d) => (d.startsAt < a ? d.startsAt : a), days[0].startsAt);
  return { flyInAirfareCents: flyInAirfareCents(loc.state, s), flyInNightlyCents: flyInNightlyCents(loc.state, s), flyInUntil: flyInUntil(first, s) };
}

/** Clinic Agreement v5: posting pauses while the clinic has an open card dispute (chargeback). */
async function assertNoOpenChargeback(orgId: string) {
  const { openChargebackFor } = await import("./chargebacks");
  if (await openChargebackFor(orgId)) {
    throw new DomainError("FORBIDDEN", "Posting is paused while a card dispute you opened with your bank is open. Ask your bank to withdraw it, or contact us so we can sort out the shift directly.");
  }
}

export async function postShift(actor: Actor, shiftId: string, opts: { skipSupply?: boolean; autoPost?: boolean } = {}) {
  const orgId = requireClinic(actor);
  const effects = new Effects();
  const supply = await import("./supply");
  if (!opts.skipSupply) {
    const own = await prisma.shift.findFirst({ where: { id: shiftId, location: { clinicOrgId: orgId } }, select: { status: true, waitingForProviderSince: true, autoPostWhenAvailable: true } });
    if (own?.status === "DRAFT") await supply.assertSupplyForPosting([shiftId], 1, [], { autoPost: opts.autoPost ?? (own.waitingForProviderSince ? own.autoPostWhenAvailable : true) });
  }
  await tx(async (db) => {
    const shift = await db.shift.findFirst({ where: { id: shiftId, location: { clinicOrgId: orgId } } });
    if (!shift) throw new DomainError("NOT_FOUND", "Shift not found");
    const org = await db.clinicOrg.findUniqueOrThrow({ where: { id: orgId } });
    if (org.status === "SUSPENDED" || org.status === "DEACTIVATED") throw new DomainError("FORBIDDEN", "Your account is suspended, so new shifts can't be posted. Please contact us.");
    if (org.status !== "ACTIVE" || !org.hasPaymentMethod) throw new DomainError("FORBIDDEN", "Finish setup before posting shifts.");
    if (!(await agreementAccepted("CLINIC", org.agreementSignedAt, org.agreementVersion))) {
      throw new DomainError("FORBIDDEN", "Please sign the current Clinic Platform Agreement in Settings before posting shifts.");
    }
    await assertNoOpenChargeback(orgId);
    await validateShiftInput(
      db,
      orgId,
      ShiftInput.parse({ ...shift, notes: shift.notes, supervisionAttestation: shift.supervisionAttestation ?? null, promoCode: null }),
      true,
    );
    await postInTx(db, actor, shiftId, effects);
  });
  await supply.markDemandPosted([shiftId]);
  await effects.run();
}

/** Edit a saved draft (re-validated and re-priced by the rate engine), optionally posting it. */
export async function updateDraftShift(actor: Actor, shiftId: string, raw: ShiftInputT, opts: { post: boolean }) {
  const orgId = requireClinic(actor);
  const input = ShiftInput.parse(raw);
  if (!(input.endsAt > input.startsAt)) throw new DomainError("VALIDATION", "The end time must be after the start.");
  const effects = new Effects();
  await tx(async (db) => {
    const shift = await db.shift.findFirst({ where: { id: shiftId, location: { clinicOrgId: orgId } } });
    if (!shift) throw new DomainError("NOT_FOUND", "Shift not found");
    if (shift.status !== "DRAFT") throw new DomainError("VALIDATION", "Only drafts can be edited. This shift has already been posted.");
    if (input.clinicRate) throw new DomainError("VALIDATION", "A clinic-set rate can be used on a new shift only. Post this draft at the market price, or start a new shift to set your own rate.");
    const loc = await db.clinicLocation.findFirst({ where: { id: input.locationId, clinicOrgId: orgId } });
    if (!loc) throw new DomainError("NOT_FOUND", "Location not found");
    if (shift.shiftGroupId && input.locationId !== shift.locationId) {
      throw new DomainError("VALIDATION", "This day is part of a multi-day booking; its location can't be changed.");
    }
    const { supervisionRequired } = await validateShiftInput(db, orgId, input, false);
    const q = await quoteShift(db, { ...input, promoCode: input.promoCode?.trim() || (await autoCredit(db, orgId)) });
    await db.shift.update({
      where: { id: shiftId },
      data: {
        locationId: input.locationId,
        professionCode: input.professionCode,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        requiredSkillIds: input.requiredSkillIds,
        preferredSkillIds: input.preferredSkillIds,
        minYearsExperience: input.minYearsExperience ?? shift.minYearsExperience,
        expectedPatients: input.expectedPatients ?? null,
        notes: input.notes?.trim() || null,
        instantBook: input.instantBook,
        maxTravelBudgetCents: input.maxTravelBudgetCents ?? null,
        lodgingAllowed: input.lodgingAllowed,
        lunchMinutes: input.lunchMinutes,
        lunchStartsAt: input.lunchMinutes ? (input.lunchStartsAt ?? null) : null,
        // Flat nightly allowance from Settings (no receipts), kept with the shift.
        lodgingCapCentsPerNight: input.lodgingAllowed ? (await getSettings(db))["pricing.lodgingNightlyCents"] : null,
        // Fly-in is set for the whole booking at posting; unticking it on a draft clears it.
        ...(input.flyIn ? {} : { flyInAirfareCents: null, flyInNightlyCents: null, flyInUntil: null }),
        rateCardId: q.rateCardId,
        durationTier: q.base.tier,
        clinicPriceCents: q.base.clinicPriceCents,
        providerPayCents: q.base.providerPayCents,
        premiumsApplied: q.base.premiums as unknown as Prisma.InputJsonValue,
        declaredTier: q.volume?.tier ?? null,
        volumeTerms: q.volume ? (q.volume.terms as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        promoCodeId: q.promo?.id ?? null,
        promoDiscountCents: q.promo?.discountCents ?? 0,
        ...(supervisionRequired && input.supervisionAttestation
          ? { supervisionAttestation: parseAttestation(input.supervisionAttestation) as unknown as Prisma.InputJsonValue, supervisionAttestedById: actor.userId, supervisionAttestedAt: new Date() }
          : {}),
      },
    });
    await audit(db, actor, "shift.draft_edited", "Shift", shiftId, { startsAt: shift.startsAt, clinicPriceCents: shift.clinicPriceCents }, { startsAt: input.startsAt, clinicPriceCents: q.base.clinicPriceCents });
  });
  await effects.run();
  if (opts.post) await postShift(actor, shiftId);
}

async function postInTx(db: Db, actor: Actor, shiftId: string, effects: Effects) {
  const s = await getSettings(db);
  const now = new Date();
  const shift = await db.shift.findUniqueOrThrow({ where: { id: shiftId }, include: { location: true } });
  assertTransition("Shift", shift.status, "OPEN");
  const loaded = await loadShift(db, shiftId);
  // Favorites window only counts favorites who are actually eligible (INV-1 etc.).
  const favs = await db.favorite.findMany({ where: { fromType: "CLINIC", fromId: shift.location.clinicOrgId, toType: "PROVIDER" } });
  let eligibleFavorites = 0;
  if (favs.length) {
    const providers = await loadProviders(db, favs.map((f) => f.toId), shiftId);
    for (const p of providers.values()) {
      const r = evaluateEligibility(p.facts, { ...loaded.facts, config: { ...loaded.facts.config, enabled: true, stateEnabled: true } }, { driveMinutes: 0, travelEstimateCents: 0, blocked: false, previouslyDeclined: false }, {
        ...eligibilityOptions(s),
        credentialsOnly: true,
      });
      if (r.eligible) eligibleFavorites++;
    }
  }
  const favEnd = favoritesWindowEnd(now, shift.startsAt, eligibleFavorites, s["matching.favoritesWindowHours"]);
  const { deadline } = selectionDeadline(s["matching.deadlineTiers"], now, shift.startsAt);
  const status = favEnd ? "FAVORITES_ONLY" : "OPEN";
  // Clinic-set rate: never auto-selected or dispatched until released to market.
  const held = shift.rateMode === "CLINIC" && !shift.releasedAt;
  await db.shift.update({ where: { id: shiftId }, data: { status, postedAt: now, favoritesWindowEndsAt: favEnd, selectionDeadline: held ? null : deadline } });
  await audit(db, actor, "shift.posted", "Shift", shiftId, { status: shift.status }, { status, selectionDeadline: deadline });
  // Same-day / short-notice shifts start Smart Dispatch right away (On Call check, then waves);
  // planned shifts go through the normal application + selection window (Addendum 02 §3).
  const { urgencyTier } = await import("@cm/core");
  const tier = urgencyTier(now, shift.startsAt);
  if (!held && (tier === "SAME_DAY" || tier === "SHORT")) {
    effects.add(async () => {
      const { startDispatch } = await import("./dispatch");
      await startDispatch(shiftId, "URGENT_POST", actor);
    });
  } else {
    effects.add(() => notifyEligibleProvidersOfShift(shiftId, "posted"));
  }
}

/** Notify eligible favorites + top-N scored candidates. Every recipient passes F0–F10 at send time. */
export async function notifyEligibleProvidersOfShift(shiftId: string, reason: "posted" | "reopened") {
  const s = await getSettings();
  const loaded = await loadShift(prisma, shiftId);
  // Same provider for all days: one notice from the first day, only to providers who can take every day.
  const { lockedGroupId, groupCoverage } = await import("./sameProvider");
  const lockedGroup = await lockedGroupId(prisma, shiftId);
  let onlyAllDays: Set<string> | null = null;
  if (lockedGroup) {
    const first = await prisma.shift.findFirst({ where: { shiftGroupId: lockedGroup, status: { in: ["OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING"] } }, orderBy: { startsAt: "asc" }, select: { id: true } });
    if (first?.id !== shiftId) return 0;
    onlyAllDays = new Set((await groupCoverage(lockedGroup)).allDayIds);
  }
  const set = await getEligibleProviders(prisma, loaded);
  const ranked = (await rankEvaluated(prisma, loaded, set.eligible)).filter((r) => !onlyAllDays || onlyAllDays.has(r.providerId));
  await logMatchRun(prisma, shiftId, reason, ranked, set.excluded, set.prefilteredOut);
  const shift = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId }, include: { location: true } });
  const favoritesOnly = shift.status === "FAVORITES_ONLY";
  const targets = ranked.filter((r, i) => (favoritesOnly ? r.favorite : r.favorite || r.input.providerFavoritedClinic || i < s["matching.notifyTopN"]));
  const urgent = +shift.startsAt - Date.now() < 48 * 3_600_000;
  const date = shift.startsAt.toLocaleDateString("en-US", { timeZone: shift.location.timeZone, weekday: "short", month: "short", day: "numeric" });
  // Multi-day bookings: one "booking available" message per provider, not one per day.
  const group = shift.shiftGroupId && reason === "posted"
    ? await prisma.shift.findMany({ where: { shiftGroupId: shift.shiftGroupId }, select: { id: true, startsAt: true }, orderBy: { startsAt: "asc" } })
    : null;
  // Each message is independent: send a few at a time so posting doesn't wait on them one by one.
  const send = async (t: (typeof targets)[number]) => {
    if (group && group.length > 1) {
      const claimed = await prisma.digestSend.createMany({ data: [{ key: `groupnotice:${shift.shiftGroupId}:${t.providerId}`, userId: t.evaluated.provider.userId }], skipDuplicates: true });
      if (!claimed.count) return;
      const d = (x: Date) => x.toLocaleDateString("en-US", { timeZone: shift.location.timeZone, weekday: "short", month: "short", day: "numeric" });
      await notify(prisma, t.evaluated.provider.userId, {
        template: "booking_available",
        title: `${group.length}-day booking available ${d(group[0].startsAt)} – ${d(group.at(-1)!.startsAt)} in ${shift.location.city}, ${shift.state}`,
        body: lockedGroup
          ? `A ${shift.professionCode} coverage booking matches your licenses and you're free every day. The clinic wants one provider for all ${group.length} days: apply for the whole booking in one tap.`
          : `A ${shift.professionCode} coverage booking matches your licenses. Apply to all days in one tap, or just the days that suit you.`,
        link: `/provider/shifts/${group[0].id}`,
        ctaLabel: "View booking",
        sms: urgent || favoritesOnly,
      });
      return;
    }
    await notify(prisma, t.evaluated.provider.userId, {
      template: "shift_available",
      title: `${reason === "reopened" ? "Urgent: " : ""}Shift available ${date} in ${shift.location.city}, ${shift.state}`,
      body: `A ${shift.professionCode} coverage shift matches your licenses and availability. Pay is shown on the shift page.`,
      link: `/provider/shifts/${shiftId}`,
      ctaLabel: "View shift",
      sms: urgent || favoritesOnly,
    });
  };
  for (let i = 0; i < targets.length; i += 5) await Promise.all(targets.slice(i, i + 5).map(send));
  return targets.length;
}

// ======================================================================
// Provider: board, apply, withdraw
// ======================================================================

/** The provider's board: only shifts they're eligible for (INV-1 is enforced by the shared function). */
export async function shiftBoard(actor: Actor, filters: { professionCode?: string; state?: string } = {}) {
  const providerId = requireProvider(actor);
  const s = await getSettings();
  const me = await prisma.provider.findUniqueOrThrow({ where: { id: providerId }, include: { licenses: true } });
  const national = await nationalCredentialStates(prisma);
  // A national registry credential stands in for a license in each state that accepts one (A5).
  const pairs = me.licenses
    .filter((l) => l.status === "VERIFIED" && l.expiresAt > new Date())
    .flatMap((l) => (l.state === NATIONAL_CREDENTIAL ? (national[l.professionCode] ?? []).map((state) => ({ ...l, state })) : [l]));
  if (!pairs.length) return [];
  // Cheap SQL narrowing to the provider's verified profession+state pairs, then the shared evaluator decides.
  const candidates = await prisma.shift.findMany({
    where: {
      status: { in: ["OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING"] },
      startsAt: { gt: new Date() },
      OR: pairs.map((l) => ({ professionCode: l.professionCode, state: l.state, endsAt: { lt: l.expiresAt } })),
      ...(filters.professionCode ? { professionCode: filters.professionCode } : {}),
      ...(filters.state ? { state: filters.state } : {}),
    },
    include: { location: { include: { clinicOrg: true } }, applications: { where: { providerId } } },
    orderBy: { startsAt: "asc" },
    take: 200,
  });
  const favoritedBy = new Set(
    (await prisma.favorite.findMany({ where: { fromType: "CLINIC", toType: "PROVIDER", toId: providerId } })).map((f) => f.fromId),
  );
  // Same straight-line narrowing as the matching prefilter (max drive × 1.2 miles, or the lodging limit
  // for overnight-willing providers on lodging shifts): a clinic farther than that can never pass the
  // drive-time rule, so it isn't worth a full evaluation (drive time lookup included).
  const reachable = (sh: (typeof candidates)[number]) => {
    if (me.homeLat === null || me.homeLng === null) return true;
    // Fly-in shifts in a state they fly to are never too far (eligibility still decides).
    if (sh.flyInUntil && +sh.flyInUntil >= Date.now() && me.flyInStates.includes(sh.state)) return true;
    const limitMin = me.willingOvernight && sh.lodgingAllowed ? Math.max(me.maxDriveMinutes, s["pricing.lodgingMaxDriveMinutes"]) : me.maxDriveMinutes;
    return milesBetween(me.homeLat, me.homeLng, sh.location.lat, sh.location.lng) <= limitMin * 1.2;
  };
  const toCheck = candidates.filter((sh) => (sh.status !== "FAVORITES_ONLY" || favoritedBy.has(sh.location.clinicOrgId)) && reachable(sh));
  // The shared evaluator decides, with this provider's facts loaded once for all the shifts.
  const evaluated = await evaluateProviderForShifts(prisma, providerId, toCheck.map((sh) => sh.id));
  const out = [];
  for (const sh of toCheck) {
    const ev = evaluated.get(sh.id);
    if (!ev?.result.eligible) continue;
    const flyIn = !!ev.result.flyIn;
    const trip = flyIn
      ? { mileageCents: 0, lodgingEstimateCents: sh.flyInNightlyCents ?? 0 }
      : ev.drive ? travelEstimate(ev.drive, { lodgingAllowed: sh.lodgingAllowed, lodgingCapCentsPerNight: sh.lodgingCapCentsPerNight }, s) : { mileageCents: 0, lodgingEstimateCents: 0 };
    const mileage = trip.mileageCents;
    out.push({
      id: sh.id,
      professionCode: sh.professionCode,
      startsAt: sh.startsAt,
      endsAt: sh.endsAt,
      lunchMinutes: sh.lunchMinutes,
      lunchStartsAt: sh.lunchStartsAt,
      timeZone: sh.location.timeZone,
      city: sh.location.city,
      state: sh.state,
      clinicName: sh.location.clinicOrg.displayName,
      clinicOrgId: sh.location.clinicOrgId,
      driveMinutes: ev.drive?.minutes ?? null,
      pay: providerView({ clinicPriceCents: 0, providerPayCents: sh.providerPayCents, promoDiscountCents: 0, mileageCents: mileage, lodgingCents: trip.lodgingEstimateCents }),
      applied: sh.applications.some((a) => a.status === "ACTIVE"),
      instantBook: sh.instantBook,
      /** Clinic-set rate (beta): the clinic's own price, chosen from applicants (never auto-filled). */
      clinicSetRate: sh.rateMode === "CLINIC" && !sh.releasedAt,
      urgent: +sh.startsAt - Date.now() < 48 * 3_600_000,
      expectedPatients: sh.expectedPatients,
      declaredTier: sh.declaredTier,
      /** The provider would fly in: whole trip, airfare per trip (shown separately), lodging every night. */
      flyIn: flyIn ? { airfareCents: sh.flyInAirfareCents ?? 0, nightlyCents: sh.flyInNightlyCents ?? 0, shiftGroupId: sh.shiftGroupId } : null,
      shiftGroupId: sh.shiftGroupId,
      /** Same provider for all days (locked): shown only when they can take every open day. */
      sameProviderDays: null as number | null,
    });
  }
  // Same provider for all days: show a locked booking only to providers who can take every open day.
  const groupIds = [...new Set(out.map((o) => o.shiftGroupId).filter((g): g is string => !!g))];
  if (groupIds.length) {
    const { LOCKED_GROUP } = await import("./sameProvider");
    const locked = await prisma.shiftGroup.findMany({ where: { id: { in: groupIds }, ...LOCKED_GROUP }, select: { id: true, shifts: { where: { status: { in: ["OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING"] } }, select: { id: true } } } });
    const missing = locked.flatMap((g) => g.shifts.map((x) => x.id)).filter((id) => !evaluated.has(id));
    const extra = missing.length ? await evaluateProviderForShifts(prisma, providerId, missing) : new Map();
    const ok = (id: string) => (evaluated.get(id) ?? extra.get(id))?.result.eligible === true;
    const drop = new Set<string>();
    for (const g of locked) {
      const all = g.shifts.every((x) => ok(x.id));
      for (const o of out) if (o.shiftGroupId === g.id) (all || o.applied ? (o.sameProviderDays = g.shifts.length) : drop.add(o.id));
    }
    return out.filter((o) => !drop.has(o.id));
  }
  return out;
}

export async function applyToShift(actor: Actor, shiftId: string, input: { note?: string | null; commit: boolean }, opts: { allDays?: boolean } = {}) {
  const providerId = requireProvider(actor);
  if (!input.commit) throw new DomainError("VALIDATION", "Please confirm that you'll work this shift if selected.");
  let note = input.note?.trim() || null;
  if (note && note.length > 500) throw new DomainError("VALIDATION", "Keep your note under 500 characters.");
  if (note && looksLikePhi(note)) throw new DomainError("VALIDATION", "Please remove patient information. Do not include patient information.");
  if (note) note = scanContactInfo(note).redacted;

  const ev = await assertProviderEligibleForShift(prisma, providerId, shiftId).catch(async (e) => {
    if (e instanceof DomainError && /LICENSE_/.test(e.code)) {
      // The shift should never have been visible: log a security warning.
      await audit(prisma, actor, "security.ineligible_apply_attempt", "Shift", shiftId, null, { providerId, code: e.code });
    }
    throw e;
  });
  const shift = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId }, include: { location: true } });
  if (!["OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING"].includes(shift.status)) throw new DomainError("CONFLICT", "This shift is no longer accepting applications.");
  // Flying in is for the whole trip: apply to every day of the booking together (bookings.applyToAllDays).
  if (ev.result.flyIn && shift.shiftGroupId && !opts.allDays) {
    throw new DomainError("VALIDATION", "You'd fly in for this booking, so apply to all of its days together (Apply to all days).");
  }
  // Same provider for all days: the whole booking or nothing.
  const { lockedGroupId } = await import("./sameProvider");
  const locked = shift.shiftGroupId && !opts.allDays ? await lockedGroupId(prisma, shiftId) : null;
  if (locked) throw new DomainError("VALIDATION", "The clinic wants one provider for every day of this booking, so apply for all of its days together (Apply to all days).");
  const inLockedGroup = !!shift.shiftGroupId && !!(opts.allDays && (await lockedGroupId(prisma, shiftId)));
  const ranked = await rankEvaluated(prisma, ev.shift, [ev]);
  const score = ranked[0]?.score ?? 0;
  const existing = await prisma.application.findUnique({ where: { shiftId_providerId: { shiftId, providerId } } });
  if (existing && existing.status === "ACTIVE") throw new DomainError("CONFLICT", "You've already applied.");
  if (existing) throw new DomainError("CONFLICT", "You can't re-apply to this shift.");
  const app = await prisma.application.create({
    data: { shiftId, providerId, note, scoreAtApply: score, scoreBreakdown: (ranked[0]?.components ?? {}) as unknown as Prisma.InputJsonValue },
  });
  await audit(prisma, actor, "application.created", "Application", app.id, null, { shiftId, score });

  // A fly-in applicant is always the clinic's pick (whole trip at once): no dispatch acceptance, no instant book.
  const flyIn = !!ev.result.flyIn;
  // During an active dispatch an application counts as an acceptance in the current wave (Addendum 02 §5.6).
  const { applicationAsAcceptance } = await import("./dispatch");
  if (!flyIn && !inLockedGroup && (await prisma.dispatch.findFirst({ where: { shiftId, status: "ACTIVE" } }))) {
    await applicationAsAcceptance(shiftId, providerId, app.id);
    const confirmed = await prisma.assignment.findFirst({ where: { shiftId, providerId, status: "CONFIRMED" } });
    return { applicationId: app.id, confirmed: !!confirmed, flyIn };
  }

  const s = await getSettings();
  if (!flyIn && !inLockedGroup && shift.instantBook && score >= s["matching.instantBookMinScore"]) {
    try {
      await confirmProvider(actor, shiftId, providerId, "INSTANT_BOOK");
      return { applicationId: app.id, confirmed: true, flyIn };
    } catch (e) {
      if (!(e instanceof DomainError && e.code === "CONFLICT")) throw e;
    }
  }
  await notifyClinic(prisma, shift.location.clinicOrgId, {
    template: "new_application",
    title: `New applicant for ${shift.startsAt.toLocaleDateString("en-US", { timeZone: shift.location.timeZone, month: "short", day: "numeric" })}`,
    body: `${ev.provider.displayName} applied to your ${shift.professionCode} shift at ${shift.location.name}.${flyIn ? " They'd fly in for it (airfare and lodging allowances are added to the total)." : ""}`,
    link: `/clinic/shifts/${shiftId}`,
    ctaLabel: "Review applicants",
  });
  return { applicationId: app.id, confirmed: false, flyIn };
}

export async function withdrawApplication(actor: Actor, applicationId: string) {
  const providerId = requireProvider(actor);
  const app = await prisma.application.findFirst({ where: { id: applicationId, providerId } });
  if (!app) throw new DomainError("NOT_FOUND", "Application not found");
  assertTransition("Application", app.status, "WITHDRAWN");
  await prisma.application.update({ where: { id: app.id }, data: { status: "WITHDRAWN", withdrawnAt: new Date() } });
  await audit(prisma, actor, "application.withdrawn", "Application", app.id, { status: app.status }, { status: "WITHDRAWN" });
}

// ======================================================================
// Clinic review: candidates, select, invite
// ======================================================================

async function clinicShift(actor: Actor, shiftId: string) {
  if (actor.role === "PLATFORM_ADMIN") return prisma.shift.findUniqueOrThrow({ where: { id: shiftId }, include: { location: true } });
  const orgId = requireClinic(actor);
  const shift = await prisma.shift.findFirst({ where: { id: shiftId, location: { clinicOrgId: orgId } }, include: { location: true } });
  if (!shift) throw new DomainError("NOT_FOUND", "Shift not found");
  return shift;
}

/** Applicants + recommended, scored. Clinic-safe: no provider pay, no home address. */
export async function shiftCandidates(actor: Actor, shiftId: string) {
  await clinicShift(actor, shiftId);
  const loaded = await loadShift(prisma, shiftId);
  const set = await getEligibleProviders(prisma, loaded);
  const ranked = await rankEvaluated(prisma, loaded, set.eligible);
  const apps = await prisma.application.findMany({ where: { shiftId, status: "ACTIVE" } });
  const appBy = new Map(apps.map((a) => [a.providerId, a]));
  const ids = ranked.map((r) => r.providerId);
  const [profiles, licenses, skills, offers] = await Promise.all([
    prisma.provider.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, photoUrl: true, homeCity: true, homeState: true, bio: true, personalInjuryExperience: true } }),
    prisma.license.findMany({
      where: { providerId: { in: ids }, professionCode: loaded.facts.professionCode, state: { in: [loaded.facts.state, NATIONAL_CREDENTIAL] }, status: "VERIFIED" },
      orderBy: { state: "asc" }, // a state license ("FL") sorts before the national credential ("US")
    }),
    prisma.providerSkill.findMany({
      where: { providerId: { in: ids }, skill: { OR: [{ professionCode: loaded.facts.professionCode }, { professionCode: null }] } },
      include: { skill: true },
    }),
    prisma.offer.findMany({ where: { shiftId, status: { in: ["PENDING", "ACCEPTED_PENDING"] } } }),
  ]);
  const prof = new Map(profiles.map((p) => [p.id, p]));
  const { badgesFor } = await import("./profiles");
  const { onCallMatches } = await import("./dispatch");
  const [badges, onCall] = await Promise.all([badgesFor(ids), onCallMatches(prisma, shiftId).catch(() => [])]);
  const held = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId }, select: { rateMode: true, releasedAt: true } });
  const instant = new Set(held.rateMode === "CLINIC" && !held.releasedAt ? [] : onCall.map((m) => m.providerId));
  const card = (r: (typeof ranked)[number]) => {
    const p = prof.get(r.providerId)!;
    const lic = licenses.find((l) => l.providerId === r.providerId);
    return {
      providerId: r.providerId,
      displayName: p.displayName,
      credentialTitle: lic?.credentialTitle ?? loaded.facts.professionCode,
      photoUrl: p.photoUrl,
      city: p.homeCity,
      personalInjuryExperience: p.personalInjuryExperience,
      state: p.homeState,
      bio: p.bio,
      score: r.score,
      components: r.components,
      driveMinutes: r.input.driveMinutes,
      ratingAvg: r.ratingAvg,
      ratingCount: r.ratingCount,
      reliability: r.reliability,
      skills: skills.filter((k) => k.providerId === r.providerId).map((k) => k.skill.name),
      // No "New to platform" for clinics: how long a provider has been a member is never shown to them.
      badges: [r.favorite && "Favorite", r.workedHereBefore && "Worked here before"].filter(Boolean) as string[],
      note: appBy.get(r.providerId)?.note ?? null,
      appliedAt: appBy.get(r.providerId)?.createdAt ?? null,
      pendingOffer: offers.some((o) => o.providerId === r.providerId),
      acceptedPending: offers.some((o) => o.providerId === r.providerId && o.status === "ACCEPTED_PENDING"),
      earnedBadges: (badges.get(r.providerId) ?? []).filter((b) => (b.kind === "earned" || b.key === "oncall") && b.key !== "new"),
      instantConfirm: instant.has(r.providerId),
    };
  };
  const applicants = ranked.filter((r) => appBy.has(r.providerId)).map(card);
  const recommended = ranked.filter((r) => !appBy.has(r.providerId)).slice(0, 10).map(card);
  return { applicants, recommended, ineligibleApplicants: apps.filter((a) => !ids.includes(a.providerId)).length };
}

export async function selectApplicant(actor: Actor, shiftId: string, providerId: string) {
  await clinicShift(actor, shiftId);
  const { lockedGroupId } = await import("./sameProvider");
  if (await lockedGroupId(prisma, shiftId)) return (await import("./bookings")).confirmForAllDays(actor, shiftId, providerId).then(() => ({ assignmentId: "" }));
  const app = await prisma.application.findUnique({ where: { shiftId_providerId: { shiftId, providerId } } });
  if (app?.status === "NOT_SELECTED" || app?.status === "SELECTED") throw new DomainError("CONFLICT", "This shift has already been filled.");
  // A provider who accepted a dispatch offer can be picked directly too (Addendum 02 §5.8).
  const acceptor = await prisma.offer.findFirst({ where: { shiftId, providerId, status: "ACCEPTED_PENDING" } });
  if (acceptor) return confirmProvider(actor, shiftId, providerId, "CLINIC_PICKED_OFFER", { acceptedOfferId: acceptor.id });
  if (!app || app.status !== "ACTIVE") throw new DomainError("NOT_FOUND", "That provider hasn't applied (or withdrew).");
  return confirmProvider(actor, shiftId, providerId, "CLINIC_PICKED_APPLICANT");
}

export async function inviteProviders(actor: Actor, shiftId: string, providerIds: string[]) {
  const shift = await clinicShift(actor, shiftId);
  const { lockedGroupId, groupCoverage } = await import("./sameProvider");
  const lockedGroup = await lockedGroupId(prisma, shiftId);
  if (lockedGroup) {
    // One provider for all days: a single-day offer would break that, so invite them to apply for the whole booking.
    if (!providerIds.length || providerIds.length > 3) throw new DomainError("VALIDATION", "Invite 1 to 3 providers at a time.");
    const cov = await groupCoverage(lockedGroup);
    const ok = providerIds.filter((id) => cov.allDayIds.includes(id));
    if (!ok.length) throw new DomainError("VALIDATION", "None of them can take every day of this booking. Split it to invite them for the days they can take.");
    const loc = await prisma.clinicLocation.findUniqueOrThrow({ where: { id: shift.locationId }, include: { clinicOrg: true } });
    for (const id of ok) {
      const p = await prisma.provider.findUniqueOrThrow({ where: { id }, select: { userId: true } });
      await notify(prisma, p.userId, {
        template: "booking_invite",
        title: `${loc.clinicOrg.displayName} invited you to a ${cov.openDays}-day booking`,
        body: `They'd like one provider for all ${cov.openDays} days and asked for you. Apply for the whole booking in one tap and they can confirm you right away.`,
        link: `/provider/shifts/${shiftId}`,
        ctaLabel: "View booking",
        sms: true,
      });
    }
    await audit(prisma, actor, "booking.invited_all_days", "ShiftGroup", lockedGroup, null, { providerIds: ok });
    return { offerIds: [] as string[], invited: ok.length, skipped: providerIds.length - ok.length, allDays: true };
  }
  if (!providerIds.length || providerIds.length > 3) throw new DomainError("VALIDATION", "Invite 1 to 3 providers at a time.");
  const pending = await prisma.offer.count({ where: { shiftId, dispatchId: null, status: { in: ["PENDING", "ACCEPTED_PENDING"] } } });
  if (pending + providerIds.length > 3) throw new DomainError("VALIDATION", "You can have up to 3 open invitations at once.");
  const s = await getSettings();
  const now = clock.now();
  const { tier } = selectionDeadline(s["matching.deadlineTiers"], shift.postedAt ?? now, shift.startsAt);
  const expiresAt = new Date(Math.min(+now + tier.offerWindowMinutes * 60_000, +shift.startsAt - 2 * 3_600_000));
  const created = [];
  for (const providerId of providerIds) {
    const ev = await assertProviderEligibleForShift(prisma, providerId, shiftId);
    // The match score decides between invitees who accept (rank-protected, Addendum 02 §5.4).
    const [ranked] = await rankEvaluated(prisma, ev.shift, [ev]);
    const offer = await prisma.offer.create({ data: { shiftId, providerId, source: actor.role === "PLATFORM_ADMIN" ? "ADMIN" : "CLINIC_PICK", expiresAt, matchScore: ranked?.score ?? 0 } });
    created.push(offer.id);
    await audit(prisma, actor, "offer.created", "Offer", offer.id, null, { shiftId, providerId, expiresAt });
    await notify(prisma, ev.provider.userId, {
      template: "offer_received",
      title: `You're invited: ${shift.professionCode} shift ${shift.startsAt.toLocaleDateString("en-US", { timeZone: shift.location.timeZone, month: "short", day: "numeric" })}`,
      body: `${shift.location.city}, ${shift.state}. Respond by ${expiresAt.toLocaleString("en-US", { timeZone: shift.location.timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`,
      link: `/provider/offers`,
      ctaLabel: "Accept or decline",
      sms: true,
    });
  }
  return { offerIds: created };
}

export async function respondToOffer(actor: Actor, offerId: string, accept: boolean) {
  const providerId = requireProvider(actor);
  const offer = await prisma.offer.findFirst({ where: { id: offerId, providerId } });
  if (!offer) throw new DomainError("NOT_FOUND", "Offer not found");
  if (offer.dispatchId) {
    // Pending, or expired-but-revivable while the dispatch is still active (§5.6) — the engine decides.
  } else if (offer.status !== "PENDING") throw new DomainError("CONFLICT", `This offer is ${offer.status.toLowerCase()}.`);
  else if (offer.expiresAt <= clock.now()) {
    await prisma.offer.update({ where: { id: offerId }, data: { status: "EXPIRED" } });
    throw new DomainError("CONFLICT", "This offer has expired.");
  }
  if (!accept && offer.dispatchId) {
    const { respondToDispatchOffer } = await import("./dispatch");
    await respondToDispatchOffer(offer.id, false, "APP");
    return { confirmed: false };
  }
  if (!accept) {
    await prisma.offer.update({ where: { id: offerId }, data: { status: "DECLINED", respondedAt: new Date() } });
    await audit(prisma, actor, "offer.declined", "Offer", offerId, { status: "PENDING" }, { status: "DECLINED" });
    // A higher-ranked invitee stepping aside may free a waiting acceptor.
    await settleInvites(offer.shiftId);
    return { confirmed: false };
  }
  // Dispatch offers follow rank-protected award logic (Addendum 02 §5.4); never "first to answer wins".
  if (offer.dispatchId) {
    const { respondToDispatchOffer } = await import("./dispatch");
    const r = await respondToDispatchOffer(offer.id, true, "APP");
    return { confirmed: r.state === "CONFIRMED", assignmentId: r.assignmentId, state: r.state, message: r.message };
  }
  // Clinic/admin invitations are rank-protected too: never "first to answer wins".
  await assertProviderEligibleForShift(prisma, providerId, offer.shiftId, { credentialsOnly: true });
  await prisma.offer.update({ where: { id: offerId }, data: { status: "ACCEPTED_PENDING", respondedAt: clock.now() } });
  await audit(prisma, actor, "offer.accepted", "Offer", offerId, { status: "PENDING" }, { status: "ACCEPTED_PENDING" });
  const r = await settleInvites(offer.shiftId);
  if (r?.providerId === providerId) return { confirmed: true, assignmentId: r.assignmentId };
  return {
    confirmed: false,
    state: "ACCEPTED_PENDING",
    message: "Thanks — you're in. The clinic invited a few providers; the best match among those who accept gets the shift. We'll confirm shortly.",
  };
}

/**
 * Settle clinic/admin invitations (non-dispatch offers) on one shift:
 * expire lapsed invitations, then confirm the best-matched acceptor once no
 * higher-ranked invitation is still open. Idempotent; run on every response
 * and by the worker sweep.
 */
export async function settleInvites(shiftId: string, now = clock.now()): Promise<{ providerId: string; assignmentId: string } | null> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const effects = new Effects();
    let tried: string | null = null;
    let result: { providerId: string; assignmentId: string } | null = null;
    try {
      await tx(async (db) => {
        await lockShift(db, shiftId);
        await db.offer.updateMany({ where: { shiftId, dispatchId: null, status: "PENDING", expiresAt: { lte: now } }, data: { status: "EXPIRED" } });
        const best = await db.offer.findFirst({ where: { shiftId, dispatchId: null, status: "ACCEPTED_PENDING" }, orderBy: [{ matchScore: "desc" }, { respondedAt: "asc" }] });
        if (!best) return;
        const higherOpen = await db.offer.count({ where: { shiftId, dispatchId: null, status: "PENDING", expiresAt: { gt: now }, matchScore: { gt: best.matchScore } } });
        if (higherOpen) return;
        const shift = await db.shift.findUniqueOrThrow({ where: { id: shiftId }, select: { status: true } });
        if (!["OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING"].includes(shift.status)) return;
        tried = best.id;
        const method = best.source === "ADMIN" ? "ADMIN" : "CLINIC_PICKED_OFFER";
        const assignmentId = await confirmInTx(db, SYSTEM, shiftId, best.providerId, method, effects, { acceptedOfferId: best.id });
        result = { providerId: best.providerId, assignmentId };
      });
    } catch (e) {
      // The top acceptor can't be confirmed (lapsed credential, now double-booked…): drop them and try the next.
      if (tried && (e instanceof DomainError || isInvariantViolation(e))) {
        await prisma.offer.update({ where: { id: tried }, data: { status: "INELIGIBLE", respondedAt: now } });
        continue;
      }
      throw e;
    }
    await effects.run();
    return result;
  }
  return null;
}

/** Worker sweep: shifts with invitees waiting on a higher-ranked invitation that may have lapsed. */
export async function settleDueInvites(now = clock.now()) {
  const rows = await prisma.offer.findMany({ where: { dispatchId: null, status: "ACCEPTED_PENDING" }, distinct: ["shiftId"], select: { shiftId: true } });
  let confirmed = 0;
  for (const { shiftId } of rows) if (await settleInvites(shiftId, now)) confirmed++;
  return { shifts: rows.length, confirmed };
}

/** Admin manual assign — still goes through the shared eligibility function + DB trigger. */
export async function adminAssign(actor: Actor, shiftId: string, providerId: string) {
  requireAdmin(actor);
  return confirmProvider(actor, shiftId, providerId, "ADMIN");
}

// ======================================================================
// Cancellations & backfill (SPEC §9.3, §7.9)
// ======================================================================

const LIVE = ["CONFIRMED", "IN_PROGRESS"] as const;

/**
 * Fly-in airfare when a day carrying it is cancelled (core flyInAirfareKept): kept = paid to the
 * provider (flights booked, or they still fly for other days) and not refunded to the clinic.
 * `paidPart` = the part of the paid deposit that was the airfare.
 */
export async function airfareOnCancel(
  a: { id: string; providerId: string; airfareCents: number; confirmedAt: Date; shift: { shiftGroupId: string | null } },
  by: "CLINIC" | "PROVIDER" | "PLATFORM",
  now: Date,
  depositPaid: number,
) {
  if (!a.airfareCents) return { kept: false, airfareCents: 0, paidPart: 0 };
  const otherDaysRemain = a.shift.shiftGroupId
    ? (await prisma.assignment.count({ where: { providerId: a.providerId, id: { not: a.id }, status: { in: [...LIVE, "COMPLETED"] }, shift: { shiftGroupId: a.shift.shiftGroupId } } })) > 0
    : false;
  const kept = flyInAirfareKept({ by, confirmedAt: a.confirmedAt, now, otherDaysRemain }, await getSettings());
  return { kept, airfareCents: a.airfareCents, paidPart: Math.min(a.airfareCents, depositPaid) };
}

export async function airfarePayout(db: Db, a: { id: string; providerId: string }, air: { kept: boolean; airfareCents: number }, now: Date) {
  if (!air.kept || !air.airfareCents) return;
  await db.payout.create({
    data: { providerId: a.providerId, assignmentId: a.id, kind: "LATE_CANCEL", description: "Fly-in airfare allowance (flights booked)", amountCents: air.airfareCents, status: "SCHEDULED", releaseAt: now },
  });
}

export async function cancelShiftByClinic(actor: Actor, shiftId: string, reason: string) {
  const shift = await clinicShift(actor, shiftId);
  if (!shiftIsCancellable(shift.status)) throw new DomainError("INVALID_TRANSITION", "This shift can no longer be cancelled.");
  const s = await getSettings();
  const assignment = await prisma.assignment.findFirst({ where: { shiftId, status: { in: [...LIVE] } }, include: { provider: true, shift: { select: { shiftGroupId: true } } } });
  const now = new Date();
  let outcome = null;
  let air = { kept: false, airfareCents: 0, paidPart: 0 };
  if (assignment) {
    const deposit = await depositPaidCents(assignment.id);
    const by = actor.role === "PLATFORM_ADMIN" ? "PLATFORM" : "CLINIC";
    air = await airfareOnCancel(assignment, by, now, deposit);
    // The matrix applies to the deposit without the airfare; the airfare is kept or refunded on its own.
    outcome = cancellationOutcome({ by, now, startsAt: shift.startsAt, depositPaidCents: deposit - air.paidPart }, s);
    if (!air.kept) outcome = { ...outcome, refundDepositCents: outcome.refundDepositCents + air.paidPart };
  }
  await tx(async (db) => {
    await db.shift.update({ where: { id: shiftId }, data: { status: "CANCELLED", cancelledAt: now, cancelReason: reason.slice(0, 500) } });
    await db.application.updateMany({ where: { shiftId, status: "ACTIVE" }, data: { status: "NOT_SELECTED" } });
    await db.offer.updateMany({ where: { shiftId, status: "PENDING" }, data: { status: "WITHDRAWN", respondedAt: now } });
    await db.promoRedemption.updateMany({ where: { shiftId, voidedAt: null }, data: { voidedAt: now } });
    if (assignment) {
      assertTransition("Assignment", assignment.status, "CANCELLED");
      await db.assignment.update({
        where: { id: assignment.id },
        data: { status: "CANCELLED", cancelledAt: now, cancelledBy: actor.role === "PLATFORM_ADMIN" ? "PLATFORM" : "CLINIC", cancelReason: reason.slice(0, 500) },
      });
      await db.payout.updateMany({ where: { assignmentId: assignment.id, status: { in: ["PENDING", "SCHEDULED", "ON_HOLD"] }, kind: "SHIFT" }, data: { status: "CANCELLED" } });
      if (outcome && outcome.providerCompensationCents > 0) {
        await db.payout.create({
          data: {
            providerId: assignment.providerId,
            assignmentId: assignment.id,
            kind: "LATE_CANCEL",
            description: "Late-cancellation compensation",
            amountCents: outcome.providerCompensationCents,
            status: "SCHEDULED",
            releaseAt: now,
          },
        });
      }
      await airfarePayout(db, assignment, air, now);
    }
    await audit(db, actor, "shift.cancelled", "Shift", shiftId, { status: shift.status }, { status: "CANCELLED", reason, outcome, airfare: air.airfareCents ? air : undefined });
  });
  if (assignment && outcome && outcome.refundDepositCents > 0) await refundAssignment(actor, assignment.id, outcome.refundDepositCents, "clinic cancellation ≥ free-cancel window");
  if (assignment) {
    await notify(prisma, assignment.provider.userId, {
      template: "shift_cancelled_provider",
      title: "A confirmed shift was cancelled",
      body: `The clinic cancelled your ${shift.startsAt.toLocaleDateString("en-US", { timeZone: shift.location.timeZone, month: "short", day: "numeric" })} shift at ${shift.location.name}.${outcome?.providerCompensationCents ? " You'll receive late-cancellation compensation." : ""}${air.kept ? " You'll also receive the airfare allowance for your flights." : air.airfareCents ? " The clinic cancelled within its change window, so please don't book flights for this booking." : ""}`,
      link: "/provider/earnings",
      sms: true,
    });
  }
  return outcome;
}

/**
 * Provider cancels (or platform removes them): full refund to the clinic,
 * reliability impact if late, shift reopens with urgent handling (backfill).
 */
export async function cancelAssignment(
  actor: Actor,
  assignmentId: string,
  reason: string,
  /**
   * unconfirmed: the system releases a provider who didn't reconfirm — treated as the provider's (late) cancel.
   * onBehalf: the platform records a provider-fault event (a no-show) for them.
   * quiet: the caller sends its own clinic/admin messages (emergency cover).
   */
  opts: { by: "PROVIDER" | "PLATFORM"; lapse?: boolean; noShow?: boolean; unconfirmed?: boolean; onBehalf?: boolean; quiet?: boolean } = { by: "PROVIDER" },
) {
  const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { shift: { include: { location: true } }, provider: true } });
  if (opts.unconfirmed || opts.onBehalf) {
    if (actor.role !== "SYSTEM") requireAdmin(actor);
  } else if (opts.by === "PROVIDER") {
    const pid = requireProvider(actor);
    if (a.providerId !== pid) throw new DomainError("NOT_FOUND", "Assignment not found");
  } else if (actor.role !== "SYSTEM") requireAdmin(actor);
  const s = await getSettings();
  const now = clock.now();
  const deposit = await depositPaidCents(a.id);
  const air = await airfareOnCancel(a, opts.by === "PROVIDER" ? "PROVIDER" : "PLATFORM", now, deposit);
  const base = cancellationOutcome({ by: opts.by === "PROVIDER" ? "PROVIDER" : "PLATFORM", noShow: opts.noShow, now, startsAt: a.startsAt, depositPaidCents: deposit - air.paidPart }, s);
  // Fly-in airfare: refunded unless the provider still flies for other days of the booking.
  const outcome = air.kept ? base : { ...base, refundDepositCents: base.refundDepositCents + air.paidPart };
  const newStatus = opts.lapse ? "LICENSE_LAPSED" : opts.noShow ? "NO_SHOW" : "CANCELLED";
  const reopen = a.startsAt > now && !opts.noShow;
  await tx(async (db) => {
    assertTransition("Assignment", a.status, newStatus);
    await db.assignment.update({
      where: { id: a.id },
      data: { status: newStatus, cancelledAt: now, cancelledBy: opts.by === "PROVIDER" ? "PROVIDER" : "PLATFORM", cancelReason: reason.slice(0, 500) },
    });
    await db.payout.updateMany({ where: { assignmentId: a.id, status: { in: ["PENDING", "SCHEDULED", "ON_HOLD"] } }, data: { status: "CANCELLED" } });
    await airfarePayout(db, a, air, now);
    await db.promoRedemption.updateMany({ where: { shiftId: a.shiftId, voidedAt: null }, data: { voidedAt: now } });
    if (a.shift.promoCodeId && a.shift.promoDiscountCents > 0) {
      await db.promoCode.update({ where: { id: a.shift.promoCodeId }, data: { usedCount: { decrement: 1 } } });
    }
    if (outcome.countsAsLateCancel || outcome.countsAsNoShow) {
      await db.providerStats.upsert({
        where: { providerId: a.providerId },
        create: { providerId: a.providerId, lateCancels: outcome.countsAsLateCancel ? 1 : 0, noShows: outcome.countsAsNoShow ? 1 : 0 },
        update: outcome.countsAsLateCancel ? { lateCancels: { increment: 1 } } : { noShows: { increment: 1 } },
      });
    }
    if (reopen) {
      await db.shift.update({ where: { id: a.shiftId }, data: { status: "OPEN", postedAt: now, selectionDeadline: new Date(Math.min(+now + 3_600_000, +a.startsAt)) } });
    } else if (opts.noShow) {
      // Shift is over for billing purposes; nothing to backfill.
    }
    await audit(db, actor, `assignment.${newStatus.toLowerCase()}`, "Assignment", a.id, { status: a.status }, { status: newStatus, reason, outcome, reopened: reopen });
  });
  if (outcome.refundDepositCents > 0) await refundAssignment(actor, a.id, outcome.refundDepositCents, `${newStatus.toLowerCase()} — full refund`);
  const day = a.startsAt.toLocaleDateString("en-US", { timeZone: a.shift.location.timeZone, weekday: "short", month: "short", day: "numeric" });
  if (!opts.quiet) await notifyClinic(prisma, a.shift.location.clinicOrgId, {
    template: "backfill",
    title: reopen ? `We've had a cancellation for ${day} — we're already finding a replacement` : "Your covering provider didn't show",
    body: reopen
      ? `${a.provider.displayName} ${opts.unconfirmed ? "didn't confirm they're still coming" : "can no longer make it"} on ${day}. No need to worry — we're finding a replacement urgently as we speak, and we'll email you the moment your new provider is confirmed. Your deposit for ${a.provider.displayName} is being refunded.`
      : "Your deposit is being refunded in full. Our team will follow up.",
    link: `/clinic/shifts/${a.shiftId}`,
    sms: true,
  });
  if (opts.unconfirmed) {
    await notify(prisma, a.provider.userId, {
      template: "reconfirm_released",
      title: `Released from your ${day} shift`,
      body: "You didn't confirm you were still coming by the deadline, so the shift has gone to another provider. This counts as a late cancellation.",
      link: "/provider/assignments",
      sms: true,
    });
  } else if (opts.noShow && opts.onBehalf) {
    await notify(prisma, a.provider.userId, {
      template: "no_show_recorded",
      title: `Recorded as a no-show: ${day}`,
      body: "The clinic reported you didn't arrive, so the shift has gone to another provider and this is recorded as a no-show. If this is a mistake, reply to this message or contact us right away.",
      link: "/provider/assignments",
      sms: true,
    });
  } else if (opts.by === "PLATFORM") {
    await notify(prisma, a.provider.userId, {
      template: opts.lapse ? "license_lapsed" : "assignment_removed",
      title: opts.lapse ? "Action needed: a credential no longer qualifies" : "You were removed from a shift",
      body: opts.lapse
        ? "One of your licenses or your malpractice coverage no longer qualifies for an upcoming shift, so it has been released to another provider. Update your credentials to keep working."
        : reason,
      link: "/provider/credentials",
      sms: true,
    });
  }
  if (outcome.countsAsLateCancel || outcome.countsAsNoShow) {
    const stats = await prisma.providerStats.findUnique({ where: { providerId: a.providerId } });
    if ((stats?.lateCancels ?? 0) + (stats?.noShows ?? 0) >= 3) {
      await prisma.adminTask.create({ data: { kind: "LATE_CANCELS", title: `${a.provider.displayName}: repeated late cancels / no-shows`, entityType: "Provider", entityId: a.providerId } });
    }
  }
  if (reopen) {
    if (+a.startsAt - +now <= s["emergency.triggerWithinHours"] * 3_600_000) {
      // Late cancellation: emergency cover (everyone at once, wider radius, rescue bonus from margin).
      const { activateEmergency } = await import("./emergency");
      await activateEmergency(a.shiftId, opts.unconfirmed ? "UNCONFIRMED" : opts.by === "PROVIDER" ? "PROVIDER_CANCEL" : "ADMIN", reason).catch((e) => console.error("emergency cover failed", e));
    } else {
      // Backfill: standby first, then On Call check, then waves (Addendum 02 §3, §7).
      const { startDispatch } = await import("./dispatch");
      await startDispatch(a.shiftId, "BACKFILL").catch((e) => console.error("backfill dispatch failed", e));
    }
  }
  if (!opts.quiet) await notifyAdmins(prisma, { template: "backfill_admin", title: `Backfill started (${newStatus})`, body: `Shift ${a.shiftId} reopened: ${reason}`, link: `/admin/shifts/${a.shiftId}`, email: false });
  return outcome;
}
