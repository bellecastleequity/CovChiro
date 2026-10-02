import {
  DomainError,
  hoursBetween,
  normalizeCode,
  promoDiscountCents,
  promoRejection,
  quoteBase,
  tierFor,
  tierForVisits,
  volumeCeilings,
  volumeTermsFor,
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
  const existingTask = await db.adminTask.findFirst({ where: { kind: "UNMAPPED_ZIP3", entityId: `${state}:${zip3}`, resolvedAt: null } });
  if (!existingTask) {
    await db.adminTask.create({ data: { kind: "UNMAPPED_ZIP3", title: `ZIP3 ${zip3} (${state}) isn't mapped to a rate region`, entityType: "RateRegion", entityId: `${state}:${zip3}` } });
  }
  return cfg?.defaultRateRegionId ?? null;
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
    boosted?: boolean;
    promoCode?: string | null;
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
  const rateRegionId = location.rateRegionId ?? (await resolveRateRegion(db, location.state, location.zip));
  if (!rateRegionId) throw new DomainError("VALIDATION", `Pricing isn't set up for ${location.state} yet.`);
  const hours = hoursBetween(input.startsAt, input.endsAt);
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
  const base = quoteBase(
    { startsAt: input.startsAt, endsAt: input.endsAt },
    profession.pricingModel,
    { clinicPriceCents: card.clinicPriceCents, providerPayCents: card.providerPayCents, minHours: card.minHours },
    { pricedAt, timeZone: location.timeZone, boosted: !!input.boosted, professionCode: input.professionCode },
    s,
  );
  let promo: ShiftQuote["promo"] = null;
  if (input.promoCode && input.promoCode.trim()) {
    const p = await validatePromoForClinic(db, input.promoCode, location.clinicOrgId, pricedAt);
    promo = { id: p.id, code: p.code, discountCents: promoDiscountCents(p, base, s["promo.maxShareOfMarginPercent"]) };
  }
  return { base, pricingModel: profession.pricingModel, rateCardId: card.id, rateRegionId, promo, volume };
}
