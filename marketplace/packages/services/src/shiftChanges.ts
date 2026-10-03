import { z } from "zod";
import { clinicTotalCents, DomainError, looksLikePhi, minPostingLeadOk, providerTotalCents, scanContactInfo, selectionDeadline, urgencyTier } from "@cm/core";
import { isInvariantViolation, prisma, Prisma, type Shift, type ShiftChange } from "@cm/db";
import { audit, clock, getSettings, lockShift, requireClinic, requireProvider, SYSTEM, tx, type Actor, type Db } from "./context";
import { notify, notifyAdmins, notifyClinic } from "./notify";
import { depositPaidCents, refundAssignment } from "./payments";
import { quoteShift } from "./pricing";

/**
 * Changing a posted shift (clinic). Not yet filled: the change applies right away and applicants
 * are told. Confirmed: the change waits for the provider (ShiftChange PENDING). Accept = applied to
 * the shift and the booking (new price; the balance at completion settles the difference, or the
 * deposit is partly refunded if the new total is lower). Decline or no answer by respondBy = the
 * change is applied, the provider is released with no penalty, the deposit is refunded and the
 * shift reopens to everyone with the new details.
 * Location, profession and skills can't change: cancel and post again for those.
 */

export const ShiftChangeInput = z.object({
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  expectedPatients: z.coerce.number().int().min(0).max(500).nullable().optional(),
  minYearsExperience: z.coerce.number().int().min(0).max(40).optional(),
  notes: z.string().max(2000).nullable().optional(),
  /** Optional note to the confirmed provider explaining the change. */
  message: z.string().max(500).nullable().optional(),
});
export type ShiftChangeInputT = z.input<typeof ShiftChangeInput>;

const UNFILLED = ["OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING"] as const;

/** Shift columns written when a change is applied (dates as ISO strings in JSON). */
interface ShiftData {
  startsAt: string;
  endsAt: string;
  expectedPatients: number | null;
  minYearsExperience: number;
  notes: string | null;
  rateCardId: string | null;
  durationTier: string | null;
  clinicPriceCents: number;
  providerPayCents: number;
  premiumsApplied: unknown;
  declaredTier: string | null;
  volumeTerms: unknown;
  promoDiscountCents: number;
}
interface Totals {
  clinicTotalCents: number;
  providerTotalCents: number;
}
export interface ChangeSide {
  shift: ShiftData;
  totals: Totals | null;
}

function shiftDataOf(s: Shift): ShiftData {
  return {
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    expectedPatients: s.expectedPatients,
    minYearsExperience: s.minYearsExperience,
    notes: s.notes,
    rateCardId: s.rateCardId,
    durationTier: s.durationTier,
    clinicPriceCents: s.clinicPriceCents,
    providerPayCents: s.providerPayCents,
    premiumsApplied: s.premiumsApplied,
    declaredTier: s.declaredTier,
    volumeTerms: s.volumeTerms,
    promoDiscountCents: s.promoDiscountCents,
  };
}

function shiftUpdate(d: ShiftData): Prisma.ShiftUpdateInput {
  return {
    startsAt: new Date(d.startsAt),
    endsAt: new Date(d.endsAt),
    expectedPatients: d.expectedPatients,
    minYearsExperience: d.minYearsExperience,
    notes: d.notes,
    rateCardId: d.rateCardId,
    durationTier: d.durationTier as Shift["durationTier"],
    clinicPriceCents: d.clinicPriceCents,
    providerPayCents: d.providerPayCents,
    premiumsApplied: (d.premiumsApplied ?? []) as Prisma.InputJsonValue,
    declaredTier: d.declaredTier as Shift["declaredTier"],
    volumeTerms: d.volumeTerms == null ? Prisma.DbNull : (d.volumeTerms as Prisma.InputJsonValue),
    promoDiscountCents: d.promoDiscountCents,
  };
}

async function loadForClinic(actor: Actor, shiftId: string) {
  const orgId = requireClinic(actor);
  const shift = await prisma.shift.findFirst({
    where: { id: shiftId, location: { clinicOrgId: orgId } },
    include: { location: true, promoCode: true, assignments: { where: { status: { in: ["CONFIRMED", "IN_PROGRESS"] } }, include: { provider: true } } },
  });
  if (!shift) throw new DomainError("NOT_FOUND", "Shift not found");
  return shift;
}

/** The proposed shift (re-priced by the rate engine) and, for a confirmed shift, the new booking totals. */
async function propose(db: Db, shift: Awaited<ReturnType<typeof loadForClinic>>, input: z.output<typeof ShiftChangeInput>) {
  const s = await getSettings(db);
  const now = clock.now();
  if (!(input.endsAt > input.startsAt)) throw new DomainError("VALIDATION", "The end time must be after the start.");
  if (!minPostingLeadOk(now, input.startsAt)) throw new DomainError("VALIDATION", "Shifts must start at least 2 hours from now.");
  const notes = input.notes === undefined ? shift.notes : input.notes?.trim() || null;
  if (notes && looksLikePhi(notes)) throw new DomainError("VALIDATION", "Please remove patient information from the notes. Do not include patient information.");
  if (notes && scanContactInfo(notes).found) throw new DomainError("VALIDATION", "Please don't include phone numbers, emails or links in shift notes — contact details are shared after confirmation.");
  if (input.message && scanContactInfo(input.message).found) throw new DomainError("VALIDATION", "Please don't include phone numbers, emails or links in the note — message your provider in the app instead.");
  const expectedPatients = input.expectedPatients === undefined ? shift.expectedPatients : input.expectedPatients;
  // Notice premiums follow the original posting unless the shift moves earlier (then it's priced as of now).
  const pricedAt = +input.startsAt >= +shift.startsAt ? (shift.postedAt ?? shift.createdAt) : now;
  const q = await quoteShift(db, { locationId: shift.locationId, professionCode: shift.professionCode, startsAt: input.startsAt, endsAt: input.endsAt, expectedPatients, boosted: shift.boosted, pricedAt });
  const live = shift.assignments[0] ?? null;
  // Keep the promo the shift already has (never more than the new price).
  const promo = Math.min(live?.promoDiscountCents ?? shift.promoDiscountCents, q.base.clinicPriceCents);
  const after: ShiftData = {
    startsAt: input.startsAt.toISOString(),
    endsAt: input.endsAt.toISOString(),
    expectedPatients: expectedPatients ?? null,
    minYearsExperience: input.minYearsExperience ?? shift.minYearsExperience,
    notes,
    rateCardId: q.rateCardId,
    durationTier: q.base.tier,
    clinicPriceCents: q.base.clinicPriceCents,
    providerPayCents: q.base.providerPayCents,
    premiumsApplied: q.base.premiums,
    declaredTier: q.volume?.tier ?? null,
    volumeTerms: q.volume?.terms ?? null,
    promoDiscountCents: promo,
  };
  const breakdown = (d: ShiftData, l: NonNullable<typeof live>) => ({
    clinicPriceCents: d.clinicPriceCents,
    providerPayCents: d.providerPayCents,
    promoDiscountCents: d.promoDiscountCents,
    mileageCents: l.mileageCents,
    lodgingCents: l.lodgingEstimateCents,
  });
  const before: ChangeSide = { shift: shiftDataOf(shift), totals: live ? { clinicTotalCents: live.clinicTotalCents, providerTotalCents: live.providerTotalCents } : null };
  const next: ChangeSide = { shift: after, totals: live ? { clinicTotalCents: clinicTotalCents(breakdown(after, live)), providerTotalCents: providerTotalCents(breakdown(after, live)) } : null };
  if (live) {
    const lead = s["matching.changeMinLeadHours"] * 3_600_000;
    if (live.status !== "CONFIRMED" || +shift.startsAt - +now < lead || +input.startsAt - +now < lead) {
      throw new DomainError("VALIDATION", `Confirmed shifts can be changed up to ${s["matching.changeMinLeadHours"]} hours before they start. Message your provider, or cancel instead.`);
    }
  }
  const respondBy = live ? new Date(Math.min(+now + s["matching.changeResponseHours"] * 3_600_000, +shift.startsAt - 2 * 3_600_000, +input.startsAt - 2 * 3_600_000)) : null;
  return { before, after: next, live, respondBy };
}

const changed = (a: ShiftData, b: ShiftData) =>
  a.startsAt !== b.startsAt || a.endsAt !== b.endsAt || a.expectedPatients !== b.expectedPatients || a.minYearsExperience !== b.minYearsExperience || (a.notes ?? "") !== (b.notes ?? "");

function editable(shift: { status: string; emergencyAt: Date | null; rescueOfShiftId: string | null }) {
  if (shift.status === "DRAFT") throw new DomainError("VALIDATION", "This is a draft: edit it from Post a shift.");
  if (![...UNFILLED, "CONFIRMED"].includes(shift.status as never)) throw new DomainError("VALIDATION", "This shift can no longer be changed.");
  // Emergency cover carries a rescue bonus and is being filled right now: don't re-price it mid-search.
  if ((shift.emergencyAt || shift.rescueOfShiftId) && shift.status !== "CONFIRMED") {
    throw new DomainError("VALIDATION", "We're urgently finding cover for this shift, so it can't be changed right now. Contact us if the time or details are wrong.");
  }
}

/** Whether the clinic's Change shift button applies (same rules as editable, without throwing). */
export function canChange(shift: { status: string; emergencyAt: Date | null; rescueOfShiftId: string | null }) {
  try {
    editable(shift);
    return true;
  } catch {
    return false;
  }
}

/** What the clinic sees before sending: old and new times and price (never provider pay). */
export async function previewShiftChange(actor: Actor, shiftId: string, raw: ShiftChangeInputT) {
  const shift = await loadForClinic(actor, shiftId);
  editable(shift);
  const input = ShiftChangeInput.parse(raw);
  const p = await propose(prisma, shift, input);
  if (!changed(p.before.shift, p.after.shift)) throw new DomainError("VALIDATION", "Nothing has changed yet.");
  const clinicSide = (c: ChangeSide) => ({
    startsAt: c.shift.startsAt,
    endsAt: c.shift.endsAt,
    expectedPatients: c.shift.expectedPatients,
    minYearsExperience: c.shift.minYearsExperience,
    notes: c.shift.notes,
    priceCents: c.totals?.clinicTotalCents ?? c.shift.clinicPriceCents - c.shift.promoDiscountCents,
  });
  return {
    before: clinicSide(p.before),
    after: clinicSide(p.after),
    providerName: p.live?.provider.displayName ?? null,
    respondBy: p.respondBy?.toISOString() ?? null,
    timeZone: shift.location.timeZone,
  };
}

/** Clinic changes a posted shift: applied now if unfilled, or sent to the confirmed provider to accept. */
export async function changeShift(actor: Actor, shiftId: string, raw: ShiftChangeInputT) {
  const input = ShiftChangeInput.parse(raw);
  const shift = await loadForClinic(actor, shiftId);
  editable(shift);
  const result = await tx(async (db) => {
    await lockShift(db, shiftId);
    const fresh = await loadForClinic(actor, shiftId);
    editable(fresh);
    const p = await propose(db, fresh, input);
    if (!changed(p.before.shift, p.after.shift)) throw new DomainError("VALIDATION", "Nothing has changed yet.");
    if (!p.live) {
      await db.shift.update({ where: { id: shiftId }, data: { ...shiftUpdate(p.after.shift), selectionDeadline: selectionDeadline((await getSettings(db))["matching.deadlineTiers"], clock.now(), input.startsAt).deadline } });
      await audit(db, actor, "shift.changed", "Shift", shiftId, p.before.shift, p.after.shift);
      return { kind: "applied" as const, before: p.before, after: p.after, change: null };
    }
    if (await db.shiftChange.findFirst({ where: { shiftId, status: "PENDING" } })) {
      throw new DomainError("CONFLICT", "A change is already waiting for your provider. Withdraw it first to send a different one.");
    }
    const change = await db.shiftChange.create({
      data: {
        shiftId,
        assignmentId: p.live.id,
        providerId: p.live.providerId,
        requestedById: actor.userId!,
        before: p.before as unknown as Prisma.InputJsonValue,
        after: p.after as unknown as Prisma.InputJsonValue,
        message: input.message?.trim() || null,
        respondBy: p.respondBy!,
      },
    });
    await audit(db, actor, "shift.change_requested", "Shift", shiftId, p.before.shift, { ...p.after.shift, changeId: change.id });
    return { kind: "pending" as const, before: p.before, after: p.after, change, provider: p.live.provider };
  });

  const tz = shift.location.timeZone;
  if (result.kind === "applied") {
    // Applicants and providers holding an offer hear about it (their application still stands).
    const [apps, offers] = await Promise.all([
      prisma.application.findMany({ where: { shiftId, status: "ACTIVE" }, select: { provider: { select: { userId: true } } } }),
      prisma.offer.findMany({ where: { shiftId, status: "PENDING" }, select: { provider: { select: { userId: true } } } }),
    ]);
    const users = [...new Set([...apps, ...offers].map((x) => x.provider.userId))];
    for (const u of users) {
      await notify(prisma, u, {
        template: "shift_details_changed",
        title: `Shift updated: ${when(result.after.shift, tz)}`,
        body: `${shift.location.name} changed this shift${summary(result.before.shift, result.after.shift, tz)}. Your application still stands; withdraw it if it no longer works for you.`,
        link: `/provider/shifts/${shiftId}`,
        sms: result.before.shift.startsAt !== result.after.shift.startsAt || result.before.shift.endsAt !== result.after.shift.endsAt,
      });
    }
    return { status: "applied" as const };
  }
  await notify(prisma, result.provider.userId, {
    template: "shift_change_request",
    title: `Please review a change to your ${day(result.before.shift, tz)} shift`,
    body: `${shift.location.name} asked to change your shift${summary(result.before.shift, result.after.shift, tz)}. Your pay would be ${dollars(result.after.totals!.providerTotalCents)} (was ${dollars(result.before.totals!.providerTotalCents)}).${result.change.message ? ` Their note: “${result.change.message}”` : ""} Please accept or decline by ${result.change.respondBy.toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" })}. If you decline or don't answer, you're released with no penalty.`,
    link: `/provider/changes/${result.change.id}`,
    ctaLabel: "Review the change",
    sms: true,
  });
  return { status: "pending" as const, changeId: result.change.id, respondBy: result.change.respondBy };
}

/** Clinic takes back a change the provider hasn't answered. */
export async function withdrawShiftChange(actor: Actor, changeId: string) {
  const orgId = requireClinic(actor);
  const c = await prisma.shiftChange.findFirst({ where: { id: changeId, shift: { location: { clinicOrgId: orgId } } } });
  if (!c) throw new DomainError("NOT_FOUND", "Change not found");
  const n = await prisma.shiftChange.updateMany({ where: { id: changeId, status: "PENDING" }, data: { status: "WITHDRAWN", respondedAt: clock.now() } });
  if (!n.count) throw new DomainError("CONFLICT", "Your provider has already answered this change.");
  await audit(prisma, actor, "shift.change_withdrawn", "Shift", c.shiftId, null, { changeId });
  const provider = await prisma.provider.findUniqueOrThrow({ where: { id: c.providerId }, select: { userId: true } });
  await notify(prisma, provider.userId, { template: "shift_change_withdrawn", title: "The clinic withdrew its change", body: "Your shift stays as it was booked. Nothing for you to do.", link: "/provider/assignments", sms: false });
}

/** Provider view of one change (their own only). */
export async function changeForProvider(actor: Actor, changeId: string) {
  const providerId = requireProvider(actor);
  const c = await prisma.shiftChange.findFirst({ where: { id: changeId, providerId }, include: { shift: { include: { location: true } } } });
  if (!c) throw new DomainError("NOT_FOUND", "Change not found");
  return { ...c, before: c.before as unknown as ChangeSide, after: c.after as unknown as ChangeSide };
}

export async function pendingChangesForProvider(actor: Actor) {
  const providerId = requireProvider(actor);
  return prisma.shiftChange.findMany({ where: { providerId, status: "PENDING" }, include: { shift: { include: { location: true } } }, orderBy: { respondBy: "asc" } });
}

/** Provider accepts or declines. Decline = released with no penalty; the shift reopens with the change. */
export async function respondToShiftChange(actor: Actor, changeId: string, accept: boolean) {
  const providerId = requireProvider(actor);
  const c = await prisma.shiftChange.findFirst({ where: { id: changeId, providerId } });
  if (!c) throw new DomainError("NOT_FOUND", "Change not found");
  if (c.status !== "PENDING") throw new DomainError("CONFLICT", c.status === "WITHDRAWN" ? "The clinic withdrew this change; your shift stays as booked." : "This change has already been answered.");
  if (accept) return acceptChange(actor, c);
  return releaseForChange(actor, c, "DECLINED");
}

async function acceptChange(actor: Actor, c: ShiftChange) {
  const after = c.after as unknown as ChangeSide;
  const now = clock.now();
  let assignmentId = "";
  try {
    await tx(async (db) => {
      await lockShift(db, c.shiftId);
      const claimed = await db.shiftChange.updateMany({ where: { id: c.id, status: "PENDING" }, data: { status: "ACCEPTED", respondedAt: now } });
      if (!claimed.count) throw new DomainError("CONFLICT", "This change has already been answered.");
      const a = await db.assignment.findUniqueOrThrow({ where: { id: c.assignmentId } });
      if (a.status !== "CONFIRMED") throw new DomainError("CONFLICT", "This booking is no longer active.");
      assignmentId = a.id;
      const timeMoved = +a.startsAt !== +new Date(after.shift.startsAt) || +a.endsAt !== +new Date(after.shift.endsAt);
      await db.shift.update({ where: { id: c.shiftId }, data: shiftUpdate(after.shift) });
      await db.assignment.update({
        where: { id: a.id },
        data: {
          startsAt: new Date(after.shift.startsAt),
          endsAt: new Date(after.shift.endsAt),
          clinicPriceCents: after.shift.clinicPriceCents,
          providerPayCents: after.shift.providerPayCents,
          promoDiscountCents: after.shift.promoDiscountCents,
          clinicTotalCents: after.totals!.clinicTotalCents,
          providerTotalCents: after.totals!.providerTotalCents,
          // A new time means asking again whether they're still coming.
          ...(timeMoved ? { reconfirmRequestedAt: null, reconfirmRemindedAt: null, reconfirmedAt: null, checkinPromptedAt: null } : {}),
        },
      });
      await db.payout.updateMany({ where: { assignmentId: a.id, kind: "SHIFT", status: { in: ["PENDING", "SCHEDULED", "ON_HOLD"] } }, data: { amountCents: after.totals!.providerTotalCents } });
      await audit(db, actor, "shift.change_accepted", "Shift", c.shiftId, c.before, { ...after.shift, changeId: c.id });
    });
  } catch (e) {
    if (isInvariantViolation(e)) throw new DomainError("CONFLICT", "The new time overlaps another shift you're booked on, so you can't accept it. Decline instead, or cancel the other shift first.");
    throw e;
  }
  // A lower total than the deposit already paid: refund the difference now.
  const paid = await depositPaidCents(assignmentId);
  if (paid > after.totals!.clinicTotalCents) await refundAssignment(SYSTEM, assignmentId, paid - after.totals!.clinicTotalCents, "shift change lowered the total below the deposit");
  const shift = await prisma.shift.findUniqueOrThrow({ where: { id: c.shiftId }, include: { location: true } });
  const provider = await prisma.provider.findUniqueOrThrow({ where: { id: c.providerId }, select: { displayName: true } });
  await notifyClinic(prisma, shift.location.clinicOrgId, {
    template: "shift_change_accepted",
    title: `${provider.displayName} accepted your change`,
    body: `Your shift is now ${when(after.shift, shift.location.timeZone)}. New total: ${dollars(after.totals!.clinicTotalCents)}.`,
    link: `/clinic/shifts/${c.shiftId}`,
    sms: false,
  });
  return { status: "accepted" as const };
}

/** Declined or expired: apply the change, release the provider without penalty, refund the deposit, reopen. */
async function releaseForChange(actor: Actor, c: ShiftChange, outcome: "DECLINED" | "EXPIRED") {
  const after = c.after as unknown as ChangeSide;
  const now = clock.now();
  const s = await getSettings();
  const released = await tx(async (db) => {
    await lockShift(db, c.shiftId);
    const claimed = await db.shiftChange.updateMany({ where: { id: c.id, status: "PENDING" }, data: { status: outcome, respondedAt: now } });
    if (!claimed.count) return null;
    const a = await db.assignment.findUniqueOrThrow({ where: { id: c.assignmentId }, include: { shift: true } });
    await db.shift.update({ where: { id: c.shiftId }, data: shiftUpdate(after.shift) });
    if (a.status !== "CONFIRMED") return null; // already gone some other way: just keep the shift details
    await db.assignment.update({
      where: { id: a.id },
      data: { status: "CANCELLED", cancelledAt: now, cancelledBy: "CLINIC", cancelReason: outcome === "DECLINED" ? "Provider declined the clinic's change" : "Provider didn't answer the clinic's change in time" },
    });
    await db.payout.updateMany({ where: { assignmentId: a.id, status: { in: ["PENDING", "SCHEDULED", "ON_HOLD"] } }, data: { status: "CANCELLED" } });
    // The promo goes back with the booking and is redeemed again by whoever fills the shift.
    await db.promoRedemption.updateMany({ where: { shiftId: c.shiftId, voidedAt: null }, data: { voidedAt: now } });
    if (a.shift.promoCodeId && a.promoDiscountCents > 0) await db.promoCode.update({ where: { id: a.shift.promoCodeId }, data: { usedCount: { decrement: 1 } } });
    const startsAt = new Date(after.shift.startsAt);
    await db.shift.update({
      where: { id: c.shiftId },
      data: { status: "OPEN", postedAt: now, favoritesWindowEndsAt: null, selectionDeadline: selectionDeadline(s["matching.deadlineTiers"], now, startsAt).deadline },
    });
    await audit(db, actor, outcome === "DECLINED" ? "shift.change_declined" : "shift.change_expired", "Shift", c.shiftId, { status: "CONFIRMED", assignmentId: a.id }, { status: "OPEN", changeId: c.id });
    return a;
  });
  if (!released) return { status: outcome.toLowerCase() as "declined" | "expired" };
  const paid = await depositPaidCents(released.id);
  if (paid > 0) await refundAssignment(SYSTEM, released.id, paid, "provider released after a clinic change — full refund");
  const shift = await prisma.shift.findUniqueOrThrow({ where: { id: c.shiftId }, include: { location: true } });
  const provider = await prisma.provider.findUniqueOrThrow({ where: { id: c.providerId }, select: { userId: true, displayName: true } });
  const tz = shift.location.timeZone;
  await notifyClinic(prisma, shift.location.clinicOrgId, {
    template: "shift_change_declined",
    title: outcome === "DECLINED" ? `${provider.displayName} can't make the new time — we're finding someone` : `No answer from ${provider.displayName} — we're finding someone`,
    body: `We've reopened your shift with your changes (${when(after.shift, tz)}) and are offering it to eligible providers now.${paid ? " Your deposit is being refunded; a new one is charged when the next provider is confirmed." : ""}`,
    link: `/clinic/shifts/${c.shiftId}`,
    sms: true,
  });
  await notify(prisma, provider.userId, {
    template: "shift_change_released",
    title: outcome === "DECLINED" ? "You've been released from the shift" : "The change wasn't answered, so you've been released",
    body: `No penalty: this doesn't count as a cancellation. The ${day(after.shift, tz)} shift at ${shift.location.name} has gone back on the board with its new details.`,
    link: "/provider/assignments",
    sms: outcome === "EXPIRED",
  });
  // Re-release: urgent shifts go straight to Smart Dispatch, others to the board + top matches.
  if (urgencyTier(now, shift.startsAt) === "SAME_DAY" || urgencyTier(now, shift.startsAt) === "SHORT") {
    const { startDispatch } = await import("./dispatch");
    await startDispatch(c.shiftId, "BACKFILL").catch((e) => console.error("change re-release dispatch failed", e));
  } else {
    const { notifyEligibleProvidersOfShift } = await import("./shifts");
    await notifyEligibleProvidersOfShift(c.shiftId, "reopened").catch((e) => console.error("change re-release notify failed", e));
  }
  await notifyAdmins(prisma, { template: "shift_change_released_admin", title: `Shift reopened after a change (${outcome.toLowerCase()})`, body: `Shift ${c.shiftId}: ${provider.displayName} was released.`, link: `/admin/shifts/${c.shiftId}`, email: false });
  return { status: outcome.toLowerCase() as "declined" | "expired" };
}

/** Job: unanswered changes past respondBy count as a decline. */
export async function expireShiftChanges(now = clock.now()) {
  const due = await prisma.shiftChange.findMany({ where: { status: "PENDING", respondBy: { lte: now } }, take: 50 });
  for (const c of due) await releaseForChange(SYSTEM, c, "EXPIRED").catch((e) => console.error("expire shift change failed", c.id, e));
  return due.length;
}

export async function pendingChangeForShift(shiftId: string) {
  return prisma.shiftChange.findFirst({ where: { shiftId, status: "PENDING" } });
}

// ---- wording ----
const dollars = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (iso: string, tz: string, o: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-US", { timeZone: tz, ...o });
function day(d: ShiftData, tz: string) {
  return fmt(d.startsAt, tz, { weekday: "short", month: "short", day: "numeric" });
}
function when(d: ShiftData, tz: string) {
  return `${day(d, tz)}, ${fmt(d.startsAt, tz, { hour: "numeric", minute: "2-digit" })}–${fmt(d.endsAt, tz, { hour: "numeric", minute: "2-digit" })}`;
}
function summary(a: ShiftData, b: ShiftData, tz: string) {
  const parts: string[] = [];
  if (a.startsAt !== b.startsAt || a.endsAt !== b.endsAt) parts.push(`from ${when(a, tz)} to ${when(b, tz)}`);
  if (a.expectedPatients !== b.expectedPatients) parts.push(`expected patients ${a.expectedPatients ?? "not set"} → ${b.expectedPatients ?? "not set"}`);
  if (a.minYearsExperience !== b.minYearsExperience) parts.push(`experience ${a.minYearsExperience}+ → ${b.minYearsExperience}+ years`);
  if ((a.notes ?? "") !== (b.notes ?? "")) parts.push("updated notes");
  return parts.length ? `: ${parts.join("; ")}` : "";
}
