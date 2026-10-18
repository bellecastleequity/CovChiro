import {
  DomainError,
  hoursBetween,
  lockedClinicPriceCents,
  paidHours,
  partnerDiscountCents,
  round2,
  normalizeCode,
  promoDiscountCents,
  promoRejection,
  quoteBase,
  tierFor,
  tierForVisits,
  volumeCeilings,
  volumeTermsFor,
  welcomeBaseCents,
  welcomeDiscount,
  type BaseQuote,
  type PricingModel,
  type PromoFacts,
  type VolumeTerms,
  type VolumeTier,
} from "@cm/core";
import type { PromoCode } from "@cm/db";
import { getSettings, type Db } from "./context";

/** Rate region for a location: explicit, then ZIP3 map, then the state's default (with an admin task). */
export async function resolveRateRegion(db: Db, state: string, zip: string): Promise<string | null> {
  const zip3 = zip.slice(0, 3);
  const region = await db.rateRegion.findFirst({ where: { state, zip3List: { has: zip3 } } });
  if (region) return region.id;
  const cfg = await db.stateConfig.findUnique({ where: { state } });
  // A state with no prices of its own uses the default (national) card at quote time; no task per ZIP3.
  if (!cfg?.defaultRateRegionId && !(await db.rateRegion.count({ where: { state } }))) return null;
  const existingTask = await db.adminTask.findFirst({ where: { kind: "UNMAPPED_ZIP3", entityId: `${state}:${zip3}`, resolvedAt: null } });
  if (!existingTask) {
    await db.adminTask.create({ data: { kind: "UNMAPPED_ZIP3", title: `ZIP3 ${zip3} (${state}) isn't mapped to a rate region`, entityType: "RateRegion", entityId: `${state}:${zip3}` } });
  }
  return cfg?.defaultRateRegionId ?? null;
}

/** Setting pricing.nationalRateRegion: the card used in any state without prices of its own (never stored on a location). */
export async function nationalRateRegionId(db: Db): Promise<string | null> {
  const name = (await getSettings(db))["pricing.nationalRateRegion"].trim();
  if (!name) return null;
  return (await db.rateRegion.findUnique({ where: { name }, select: { id: true } }))?.id ?? null;
}

/** The card in force at `at`; volumeTier null = the flat (non-volume) card. */
export async function findRateCard(db: Db, professionCode: string, rateRegionId: string, tier: string, at: Date, volumeTier: VolumeTier | null = null) {
  return db.rateCard.findFirst({
    where: {
      professionCode,
      rateRegionId,
      volumeTier,
      durationTier: tier as "HALF_DAY" | "FULL_DAY" | "HOURLY",
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
}

function promoFacts(p: PromoCode): PromoFacts {
  return {
    code: p.code,
    kind: p.kind,
    value: p.value,
    active: p.active,
    startsAt: p.startsAt,
    expiresAt: p.expiresAt,
    maxUses: p.maxUses,
    usedCount: p.usedCount,
    maxUsesPerClinic: p.maxUsesPerClinic,
    firstShiftOnly: p.firstShiftOnly,
    assignedEmail: p.assignedEmail,
    landingEnabled: p.landingEnabled,
    isPersonalCopy: p.parentId !== null,
  };
}

/** Validates a promo for a clinic. Returns the code row or throws PROMO_INVALID. */
export async function validatePromoForClinic(db: Db, rawCode: string, clinicOrgId: string, now = new Date()): Promise<PromoCode> {
  const code = normalizeCode(rawCode);
  const promo = await db.promoCode.findUnique({ where: { code } });
  if (!promo) throw new DomainError("PROMO_INVALID", "That code isn't valid.");
  const org = await db.clinicOrg.findUniqueOrThrow({ where: { id: clinicOrgId }, include: { members: { include: { user: { select: { email: true } } } } } });
  const [prior, uses] = await Promise.all([
    db.assignment.count({ where: { shift: { location: { clinicOrgId } }, status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED", "DISPUTED"] } } }),
    db.promoRedemption.count({ where: { promoCodeId: promo.id, clinicOrgId, voidedAt: null } }),
  ]);
  const why = promoRejection(promoFacts(promo), {
    now,
    clinicEmails: [...org.members.map((m) => m.user.email), ...(org.billingEmail ? [org.billingEmail] : [])],
    clinicPriorConfirmedShifts: prior,
    clinicUsesOfCode: uses,
  });
  if (why) throw new DomainError("PROMO_INVALID", why);
  return promo;
}

export interface ShiftQuote {
  base: BaseQuote;
  pricingModel: PricingModel;
  rateCardId: string;
  rateRegionId: string;
  promo: { id: string; code: string; discountCents: number } | null;
  /** Partner clinic program: the partnership in force when priced, its discount (from margin) and whether the rate lock lowered the price. */
  partner: { id: string; percent: number; discountCents: number; lockedFromCents: number | null } | null;
  /** Welcome Discount on this booking (welcome.ts): percent of baseCents, from margin; null when none applies. */
  welcome: { percent: number; baseCents: number; discountCents: number; available: number } | null;
  /** A typed promo code not used because the Welcome Discount is larger (they never combine). */
  promoSetAside: string | null;
  /** Volume-priced (Addendum 03): the tier booked, its terms, and both tier prices for the clinic. */
  volume: {
    tier: VolumeTier;
    terms: VolumeTerms;
    ceilings: Record<VolumeTier, number>;
    clinicPrices: Record<VolumeTier, number>;
    providerPays: Record<VolumeTier, number>;
  } | null;
}

export async function quoteShift(
  db: Db,
  input: {
    locationId: string;
    professionCode: string;
    startsAt: Date;
    endsAt: Date;
    /** Unpaid lunch minutes (0 = none). */
    lunchMinutes?: number | null;
    boosted?: boolean;
    promoCode?: string | null;
    /** A referral credit code to apply automatically when nothing else discounts the booking. */
    autoPromoCode?: string | null;
    /** Offer the clinic's Welcome Discount on this booking (new postings and drafts; never clinic-set rates). */
    welcome?: boolean;
    /** Re-pricing this shift: it doesn't count against its own Welcome Discount. */
    excludeShiftId?: string;
    pricedAt?: Date;
    /** Clinic's expected visits: picks the volume tier (none = Busy). */
    expectedPatients?: number | null;
    /** Re-pricing a posted shift keeps its declared tier. */
    volumeTier?: VolumeTier | null;
  },
): Promise<ShiftQuote> {
  const s = await getSettings(db);
  const pricedAt = input.pricedAt ?? new Date();
  const location = await db.clinicLocation.findUniqueOrThrow({ where: { id: input.locationId } });
  const profession = await db.profession.findUnique({ where: { code: input.professionCode } });
  if (!profession) throw new DomainError("VALIDATION", "Unknown profession");
  if (+input.endsAt <= +input.startsAt) throw new DomainError("VALIDATION", "The shift must end after it starts.");
  if (hoursBetween(input.startsAt, input.endsAt) > 16) throw new DomainError("VALIDATION", "Shifts can be at most 16 hours. Post multiple days as separate shifts.");
  const rateRegionId = location.rateRegionId ?? (await resolveRateRegion(db, location.state, location.zip)) ?? (await nationalRateRegionId(db));
  if (!rateRegionId) throw new DomainError("VALIDATION", `Pricing isn't set up for ${location.state} yet.`);
  // The tier follows paid hours (an 8–1 morning with an hour's lunch is a 4-hour day).
  const hours = paidHours(round2(hoursBetween(input.startsAt, input.endsAt)), input.lunchMinutes ?? 0, s["pricing.maxDaySpanMinutes"]);
  const tier = tierFor(profession.pricingModel, hours);
  // Volume pricing: both tier cards must exist for the region, else the flat card is used.
  let volume: ShiftQuote["volume"] = null;
  let card = null as Awaited<ReturnType<typeof findRateCard>>;
  if (profession.volumePricingEnabled && tier !== "HOURLY") {
    const [light, busy] = await Promise.all([
      findRateCard(db, input.professionCode, rateRegionId, tier, pricedAt, "LIGHT"),
      findRateCard(db, input.professionCode, rateRegionId, tier, pricedAt, "BUSY"),
    ]);
    if (light && busy) {
      const ceilings = volumeCeilings(s, tier);
      const vt: VolumeTier = input.volumeTier ?? (input.expectedPatients != null ? tierForVisits(input.expectedPatients, [{ tier: "LIGHT", visitCeiling: ceilings.LIGHT }, { tier: "BUSY", visitCeiling: ceilings.BUSY }]) : "BUSY");
      card = vt === "LIGHT" ? light : busy;
      volume = {
        tier: vt,
        terms: volumeTermsFor(s, tier, vt),
        ceilings,
        clinicPrices: { LIGHT: light.clinicPriceCents, BUSY: busy.clinicPriceCents },
        providerPays: { LIGHT: light.providerPayCents, BUSY: busy.providerPayCents },
      };
    }
  }
  card ??= await findRateCard(db, input.professionCode, rateRegionId, tier, pricedAt);
  if (!card) throw new DomainError("VALIDATION", `No ${profession.displayName} rate card for this area yet.`);
  // Partner clinic: the clinic price can't go above the card in effect when the current term started
  // (never below today's provider pay; provider pay always follows today's card).
  const partnership = await (await import("./partners")).activePartnership(db, location.clinicOrgId, pricedAt);
  let clinicCardCents = card.clinicPriceCents;
  if (partnership) {
    const lockAt = partnership.term.termStart;
    const lockedCard = await findRateCard(db, input.professionCode, rateRegionId, tier, lockAt, volume ? volume.tier : null);
    clinicCardCents = lockedClinicPriceCents(card, lockedCard);
    if (volume) {
      for (const vt of ["LIGHT", "BUSY"] as const) {
        const locked = await findRateCard(db, input.professionCode, rateRegionId, tier, lockAt, vt);
        volume.clinicPrices[vt] = lockedClinicPriceCents({ clinicPriceCents: volume.clinicPrices[vt], providerPayCents: volume.providerPays[vt] }, locked);
      }
    }
  }
  const base = quoteBase(
    { startsAt: input.startsAt, endsAt: input.endsAt, lunchMinutes: input.lunchMinutes ?? 0 },
    profession.pricingModel,
    { clinicPriceCents: clinicCardCents, providerPayCents: card.providerPayCents, minHours: card.minHours },
    { pricedAt, timeZone: location.timeZone, boosted: !!input.boosted, professionCode: input.professionCode },
    s,
  );
  // Welcome Discount: a clinic's first bookings, automatically. Never stacked: partner clinics keep their
  // partner pricing, a typed promo code gives the larger of the two, and a referral credit waits.
  let welcome: ShiftQuote["welcome"] = null;
  if (input.welcome && !partnership) {
    const st = await (await import("./welcome")).welcomeState(db, location.clinicOrgId, { excludeShiftId: input.excludeShiftId });
    if (st?.canUse) {
      const baseCents = welcomeBaseCents({ pricingModel: profession.pricingModel, cardClinicCents: clinicCardCents, billableHours: base.billableHours, clinicPriceCents: base.clinicPriceCents });
      const discountCents = welcomeDiscount({ baseCents, percent: st.entitlement.percent, clinicPriceCents: base.clinicPriceCents, providerPayCents: base.providerPayCents, maxShareOfMarginPercent: s["promo.maxShareOfMarginPercent"], minContributionCents: s["welcome.minContributionCents"] });
      if (discountCents > 0) welcome = { percent: st.entitlement.percent, baseCents, discountCents, available: st.counts.available };
    }
  }
  let promo: ShiftQuote["promo"] = null;
  let promoSetAside: string | null = null;
  const code = input.promoCode?.trim() || (welcome ? null : input.autoPromoCode?.trim() || null);
  if (code) {
    const p = await validatePromoForClinic(db, code, location.clinicOrgId, pricedAt);
    promo = { id: p.id, code: p.code, discountCents: promoDiscountCents(p, base, s["promo.maxShareOfMarginPercent"]) };
    // A typed code and the Welcome Discount never combine: the larger one applies. When the code wins,
    // the Welcome Discount stays unused for a later booking.
    if (welcome) {
      if (promo.discountCents >= welcome.discountCents) welcome = null;
      else {
        promoSetAside = promo.code;
        promo = null;
      }
    }
  }
  const partner: ShiftQuote["partner"] = partnership
    ? {
        id: partnership.id,
        percent: partnership.discountPercent,
        discountCents: partnerDiscountCents(base, partnership.discountPercent, promo?.discountCents ?? 0, s["promo.maxShareOfMarginPercent"]),
        lockedFromCents: clinicCardCents < card.clinicPriceCents ? card.clinicPriceCents : null,
      }
    : null;
  return { base, pricingModel: profession.pricingModel, rateCardId: card.id, rateRegionId, promo, partner, welcome, promoSetAside, volume };
}

/** The discount fields a shift stores from its quote: promoDiscountCents carries promo + partner + welcome (everything totals use). */
export function discountFields(q: Pick<ShiftQuote, "promo" | "partner" | "welcome">) {
  const promo = q.promo?.discountCents ?? 0;
  const partner = q.partner?.discountCents ?? 0;
  const welcome = q.welcome?.discountCents ?? 0;
  return { promoCodeId: q.promo?.id ?? null, promoDiscountCents: promo + partner + welcome, partnerDiscountCents: partner, welcomeDiscountCents: welcome, partnershipId: q.partner?.id ?? null };
}
