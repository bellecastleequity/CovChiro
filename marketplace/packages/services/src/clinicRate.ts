import { brand } from "@cm/config";
import { clinicRateAllowed, clinicRatePrice, clinicRateReleaseAt, clinicRateTerms, DomainError, selectionDeadline, urgencyTier } from "@cm/core";
import { prisma, Prisma } from "@cm/db";
import { audit, clock, getSettings, lockShift, requireAdmin, requireClinic, SYSTEM, tx, type Actor, type Db } from "./context";
import { notify, notifyClinic } from "./notify";
import { quoteShift } from "./pricing";

/**
 * Clinic-set rate (beta). Rules in core/clinicRate.ts; settings group "Clinic-set rate (beta)".
 * A CLINIC-rate shift is never auto-filled (no selection deadline, Smart Dispatch, instant book or
 * On Call instant confirm) until it's released to market: on schedule at releaseAt when the clinic
 * chose release, or when the clinic taps "Release to market now". The terms the clinic saw are
 * stored on the shift (rateTerms) and emailed to them.
 */

export interface ClinicRateRequest {
  priceCents: number;
  release: boolean;
  /** Release time and window exactly as the clinic saw them (checked against the current settings). */
  releaseAt: string | null;
  releaseHours: number;
  accepted: boolean;
}

const UNFILLED = ["OPEN", "FAVORITES_ONLY", "SELECTING"] as const;

/** What the posting screen shows for a single shift: availability, market price, floor, exact release time. */
export async function clinicRatePreview(db: Db, i: { startsAt: Date; marketClinicPriceCents: number; timeZone: string; days: number }) {
  const s = await getSettings(db);
  if (!s["clinicRate.enabled"]) return null;
  const hours = s["clinicRate.releaseHours"];
  const releaseAt = clinicRateReleaseAt(i.startsAt, hours);
  const unavailable =
    i.days > 1 ? "Available for single-day shifts only." : !clinicRateAllowed(clock.now(), i.startsAt, hours) ? `Available for shifts starting more than ${hours} hours from now.` : null;
  return {
    available: !unavailable,
    unavailableReason: unavailable,
    marketCents: i.marketClinicPriceCents,
    minPercent: s["clinicRate.minPercent"],
    floorCents: Math.ceil((i.marketClinicPriceCents * s["clinicRate.minPercent"]) / 100 / 100) * 100,
    releaseHours: hours,
    releaseAt: releaseAt.toISOString(),
    message: s["clinicRate.message"],
    brandName: brand().name,
    timeZone: i.timeZone,
  };
}

/** Validate a clinic-set rate at posting and return the shift columns to store (incl. the receipt). */
export async function prepareClinicRate(
  db: Db,
  actor: Actor,
  r: ClinicRateRequest,
  shift: { startsAt: Date; timeZone: string; promoCode: string | null | undefined },
  market: { clinicPriceCents: number; providerPayCents: number },
) {
  const s = await getSettings(db);
  if (!s["clinicRate.enabled"]) throw new DomainError("VALIDATION", "Setting your own rate isn't available right now. Post at the market price instead.");
  if (!r.accepted) throw new DomainError("VALIDATION", "Please confirm you understand the clinic-set rate terms.");
  if (shift.promoCode?.trim()) throw new DomainError("VALIDATION", "Promo codes can't be combined with a clinic-set rate. Remove one of them.");
  const hours = s["clinicRate.releaseHours"];
  if (r.releaseHours !== hours) throw new DomainError("CONFLICT", "The release window has just changed. Please review the terms again before posting.");
  const now = clock.now();
  if (!clinicRateAllowed(now, shift.startsAt, hours)) throw new DomainError("VALIDATION", `A clinic-set rate is only available for shifts starting more than ${hours} hours from now.`);
  const releaseAt = clinicRateReleaseAt(shift.startsAt, hours);
  if (r.releaseAt && Math.abs(+new Date(r.releaseAt) - +releaseAt) > 60_000) throw new DomainError("CONFLICT", "The release time has changed. Please review the terms again before posting.");
  const price = clinicRatePrice(market, Math.round(r.priceCents), s["clinicRate.minPercent"]);
  if (!price.ok) throw new DomainError("VALIDATION", price.reason);
  const text = clinicRateTerms({
    brandName: brand().name,
    clinicPriceCents: price.clinicPriceCents,
    marketPriceCents: market.clinicPriceCents,
    floorPercent: s["clinicRate.minPercent"],
    release: r.release,
    releaseAt: r.release ? releaseAt : null,
    releaseHours: hours,
    timeZone: shift.timeZone,
    message: s["clinicRate.message"],
  });
  const user = actor.userId ? await db.user.findUnique({ where: { id: actor.userId }, select: { name: true, email: true } }) : null;
  return {
    data: {
      rateMode: "CLINIC",
      clinicPriceCents: price.clinicPriceCents,
      providerPayCents: price.providerPayCents,
      marketClinicPriceCents: market.clinicPriceCents,
      marketProviderPayCents: market.providerPayCents,
      releaseOnUnfilled: r.release,
      releaseHours: hours,
      releaseAt,
      instantBook: false,
      promoCodeId: null,
      promoDiscountCents: 0,
      rateTerms: {
        text,
        acceptedAt: now.toISOString(),
        acceptedById: actor.userId,
        acceptedByName: user?.name ?? null,
        acceptedByEmail: user?.email ?? null,
        floorPercent: s["clinicRate.minPercent"],
        floorCents: price.floorCents,
        marketClinicPriceCents: market.clinicPriceCents,
        clinicPriceCents: price.clinicPriceCents,
        release: r.release,
        releaseAt: r.release ? releaseAt.toISOString() : null,
        releaseHours: hours,
        message: s["clinicRate.message"],
      } as Prisma.InputJsonValue,
    },
    text,
  };
}

/** Email the clinic its receipt of the terms (after posting). */
export async function sendClinicRateReceipt(shiftId: string) {
  const sh = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId }, include: { location: true } });
  const t = sh.rateTerms as { text?: string; acceptedByName?: string; acceptedAt?: string } | null;
  if (sh.rateMode !== "CLINIC" || !t?.text) return;
  const day = sh.startsAt.toLocaleDateString("en-US", { timeZone: sh.location.timeZone, weekday: "short", month: "short", day: "numeric" });
  await notifyClinic(prisma, sh.location.clinicOrgId, {
    template: "clinic_rate_receipt",
    title: `Your clinic-set rate for ${day}: receipt`,
    body: `You posted the ${day} shift at ${sh.location.name} at your own rate. These are the terms you accepted${t.acceptedByName ? ` (${t.acceptedByName}` : ""}${t.acceptedAt ? `${t.acceptedByName ? ", " : " ("}${new Date(t.acceptedAt).toLocaleString("en-US", { timeZone: sh.location.timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })})` : t.acceptedByName ? ")" : ""}:`,
    details: t.text.split("\n"),
    link: `/clinic/shifts/${shiftId}`,
    ctaLabel: "View the shift",
    sms: false,
    push: false,
  });
}

/** Re-price an unfilled clinic-rate shift at market and open it to the usual filling. */
export async function releaseClinicRateShift(shiftId: string, actor: Actor, why: "SCHEDULED" | "CLINIC") {
  const now = clock.now();
  const s = await getSettings();
  const done = await tx(async (db) => {
    await lockShift(db, shiftId);
    const sh = await db.shift.findUniqueOrThrow({ where: { id: shiftId } });
    if (sh.rateMode !== "CLINIC" || sh.releasedAt) return null;
    if (!UNFILLED.includes(sh.status as never) || sh.startsAt <= now) return null;
    const q = await quoteShift(db, { locationId: sh.locationId, professionCode: sh.professionCode, startsAt: sh.startsAt, endsAt: sh.endsAt, lunchMinutes: sh.lunchMinutes, expectedPatients: sh.expectedPatients, boosted: sh.boosted, pricedAt: now });
    await db.shift.update({
      where: { id: shiftId },
      data: {
        releasedAt: now,
        status: "OPEN",
        favoritesWindowEndsAt: null,
        selectionDeadline: selectionDeadline(s["matching.deadlineTiers"], now, sh.startsAt).deadline,
        rateCardId: q.rateCardId,
        durationTier: q.base.tier,
        clinicPriceCents: q.base.clinicPriceCents,
        providerPayCents: q.base.providerPayCents,
        premiumsApplied: q.base.premiums as unknown as Prisma.InputJsonValue,
        declaredTier: q.volume?.tier ?? null,
        volumeTerms: q.volume ? (q.volume.terms as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
    await audit(db, actor, "shift.clinic_rate_released", "Shift", shiftId, { clinicPriceCents: sh.clinicPriceCents, providerPayCents: sh.providerPayCents }, { clinicPriceCents: q.base.clinicPriceCents, providerPayCents: q.base.providerPayCents, why });
    return { before: sh, clinicPriceCents: q.base.clinicPriceCents, providerPayCents: q.base.providerPayCents };
  });
  if (!done) return null;
  const sh = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId }, include: { location: true } });
  const day = sh.startsAt.toLocaleDateString("en-US", { timeZone: sh.location.timeZone, weekday: "short", month: "short", day: "numeric" });
  const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  await notifyClinic(prisma, sh.location.clinicOrgId, {
    template: "clinic_rate_released",
    title: why === "SCHEDULED" ? `Your ${day} shift was released to market` : `Released to market: ${day}`,
    body: `No provider was confirmed at your rate, so ${why === "SCHEDULED" ? "as agreed when you posted it, " : ""}we're now filling it at the market price of ${money(done.clinicPriceCents)} (plus mileage and lodging if needed). You can still choose from applicants.`,
    link: `/clinic/shifts/${shiftId}`,
    sms: why === "SCHEDULED",
  });
  // People who already applied hear that the pay went up; their application stands.
  const apps = await prisma.application.findMany({ where: { shiftId, status: "ACTIVE" }, select: { provider: { select: { userId: true } } } });
  for (const a of apps) {
    await notify(prisma, a.provider.userId, {
      template: "clinic_rate_released_provider",
      title: `Pay went up: ${day} shift`,
      body: `The ${day} shift you applied for is now at market pay: ${money(done.providerPayCents)} plus mileage. Your application still stands.`,
      link: `/provider/shifts/${shiftId}`,
      sms: false,
    });
  }
  if (urgencyTier(now, sh.startsAt) === "SAME_DAY" || urgencyTier(now, sh.startsAt) === "SHORT") {
    const { startDispatch } = await import("./dispatch");
    await startDispatch(shiftId, "SELECTION_DEADLINE").catch((e) => console.error("clinic-rate release dispatch failed", e));
  } else {
    const { notifyEligibleProvidersOfShift } = await import("./shifts");
    await notifyEligibleProvidersOfShift(shiftId, "reopened").catch((e) => console.error("clinic-rate release notify failed", e));
  }
  return { clinicPriceCents: done.clinicPriceCents };
}

/** Clinic: release now (any time before the start, whatever they chose at posting). */
export async function releaseNow(actor: Actor, shiftId: string) {
  const orgId = requireClinic(actor);
  const sh = await prisma.shift.findFirst({ where: { id: shiftId, location: { clinicOrgId: orgId } } });
  if (!sh) throw new DomainError("NOT_FOUND", "Shift not found");
  if (sh.rateMode !== "CLINIC" || sh.releasedAt) throw new DomainError("CONFLICT", "This shift is already at the market price.");
  const r = await releaseClinicRateShift(shiftId, actor, "CLINIC");
  if (!r) throw new DomainError("CONFLICT", "This shift can no longer be released.");
  return r;
}

/** Job: release unfilled clinic-rate shifts whose release time has come (only where the clinic chose release). */
export async function releaseDueClinicRates(now = clock.now()) {
  const due = await prisma.shift.findMany({
    where: { rateMode: "CLINIC", releasedAt: null, releaseOnUnfilled: true, releaseAt: { lte: now }, startsAt: { gt: now }, status: { in: [...UNFILLED] } },
    select: { id: true },
    take: 50,
  });
  for (const { id } of due) await releaseClinicRateShift(id, SYSTEM, "SCHEDULED").catch((e) => console.error("clinic-rate release failed", id, e));
  return due.length;
}

/** True while a clinic-rate shift must not be auto-filled. */
export const heldAtClinicRate = (sh: { rateMode: string; releasedAt: Date | null }) => sh.rateMode === "CLINIC" && !sh.releasedAt;

/** Admin: how the beta is doing (manual vs market). */
export async function clinicRateStats(actor: Actor, sinceDays = 90) {
  requireAdmin(actor);
  const since = new Date(+clock.now() - sinceDays * 86_400_000);
  const rows = await prisma.shift.findMany({
    where: { rateMode: "CLINIC", postedAt: { gte: since } },
    select: { status: true, releasedAt: true, releaseOnUnfilled: true, clinicPriceCents: true, providerPayCents: true, marketClinicPriceCents: true, assignments: { where: { status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] } }, select: { clinicPriceCents: true, providerPayCents: true } } },
  });
  const filledAtClinicRate = rows.filter((r) => !r.releasedAt && r.assignments.length);
  const releasedFilled = rows.filter((r) => r.releasedAt && r.assignments.length);
  const unfilled = rows.filter((r) => r.status === "UNFILLED");
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  return {
    posted: rows.length,
    filledAtClinicRate: filledAtClinicRate.length,
    releasedThenFilled: releasedFilled.length,
    released: rows.filter((r) => r.releasedAt).length,
    unfilled: unfilled.length,
    open: rows.filter((r) => UNFILLED.includes(r.status as never) || r.status === "CASCADING").length,
    choseRelease: rows.filter((r) => r.releaseOnUnfilled).length,
    avgClinicRatePercent: avg(rows.filter((r) => r.marketClinicPriceCents).map((r) => (100 * (r.assignments[0]?.clinicPriceCents ?? (r.releasedAt ? r.marketClinicPriceCents! : r.clinicPriceCents))) / r.marketClinicPriceCents!)),
    marginAtClinicRateCents: filledAtClinicRate.reduce((t, r) => t + (r.assignments[0].clinicPriceCents - r.assignments[0].providerPayCents), 0),
  };
}
