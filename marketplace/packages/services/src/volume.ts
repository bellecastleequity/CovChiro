import { countOutcome, DomainError, formatCents, parseVolumeTerms, reconcileWithTerms, VOLUME_TIER_LABEL, volumeOverage, type VolumeTerms, type VolumeTier } from "@cm/core";
import { prisma } from "@cm/db";
import { audit, clock, getSettings, SYSTEM, type Actor } from "./context";
import { absoluteUrl, notify, notifyAdmins, notifyClinic } from "./notify";
import { chargeVolume, refundAssignment } from "./payments";
import { assignmentIdFromTimesheetToken, timesheetLink } from "./timeclock";

/**
 * Visit counts and extra-visit fees (Addendum 03 as decided by the owner; core/volume.ts has the math).
 *  - The provider enters the day's visit COUNT (never patient details) at clock-out, or up to
 *    pricing.volumeLateClaimHours after the shift.
 *  - The clinic sees the count and the fee, and has pricing.volumeDisputeHours after the booking
 *    completes (or after the count arrives, whichever is later) to confirm or report its own count.
 *  - Then volumeSweep settles: counts within pricing.countTolerance → average rounded down; beyond
 *    it → admin review, with the lower count billed meanwhile. The fee is its own charge (VOLUME)
 *    and the provider's share is a VOLUME payout, created only once the clinic's charge succeeds.
 *  - No count = the booked tier, nothing extra. The price never goes below the booked tier.
 */

const HOUR = 3_600_000;
const LIVE = ["CONFIRMED", "IN_PROGRESS", "COMPLETED", "DISPUTED"];

async function load(assignmentId: string) {
  return prisma.assignment.findUniqueOrThrow({
    where: { id: assignmentId },
    include: { visitCount: true, provider: { select: { displayName: true, userId: true } }, shift: { include: { location: { select: { name: true, timeZone: true, clinicOrgId: true } } } } },
  });
}
type Loaded = Awaited<ReturnType<typeof load>>;

function termsOf(a: Loaded): { tier: VolumeTier; terms: VolumeTerms } | null {
  const terms = parseVolumeTerms(a.shift.volumeTerms);
  return a.shift.declaredTier && terms ? { tier: a.shift.declaredTier, terms } : null;
}

const cleanCount = (n: number) => {
  if (!Number.isInteger(n) || n < 0 || n > 300) throw new DomainError("VALIDATION", "Enter the number of visits (0–300).");
  return n;
};
const dayLabel = (a: Loaded) => a.startsAt.toLocaleDateString("en-US", { timeZone: a.shift.location.timeZone, weekday: "short", month: "short", day: "numeric" });
const timeLabel = (d: Date, tz: string) => d.toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" });

/** When the booking counts as complete for the window (actual, else the scheduled auto-complete). */
async function completionAt(a: Loaded) {
  return a.completedAt ?? new Date(+a.endsAt + (await getSettings())["payments.autoCompleteHours"] * HOUR);
}

// ---------------- provider ----------------

export async function submitVisits(actor: Actor, assignmentId: string, visits: number) {
  const a = await load(assignmentId);
  if (actor.role !== "PROVIDER" || actor.providerId !== a.providerId) throw new DomainError("NOT_FOUND", "Shift not found");
  const v = termsOf(a);
  if (!v) throw new DomainError("VALIDATION", "This shift isn't priced by visits.");
  if (!LIVE.includes(a.status)) throw new DomainError("CONFLICT", "This booking isn't active.");
  const s = await getSettings();
  const now = clock.now();
  if (+now < +a.startsAt) throw new DomainError("VALIDATION", "You can enter the visit count once the shift has started.");
  if (+now > +a.endsAt + s["pricing.volumeLateClaimHours"] * HOUR) throw new DomainError("VALIDATION", "The time to enter visits for this shift has passed.");
  const vc = a.visitCount;
  if (vc && (vc.status !== "OPEN" || vc.clinicVisits != null)) throw new DomainError("CONFLICT", "The clinic has already responded to your count. Contact us if it needs to change.");
  const n = cleanCount(visits);
  const due = new Date(Math.max(+(await completionAt(a)), +now + s["pricing.volumeDisputeHours"] * HOUR));
  await prisma.visitCount.upsert({
    where: { assignmentId },
    create: { assignmentId, providerVisits: n, providerAt: now, chargeDueAt: due },
    update: { providerVisits: n, providerAt: now, chargeDueAt: due },
  });
  await audit(prisma, actor, "visits.submitted", "Assignment", assignmentId, vc ? { providerVisits: vc.providerVisits } : null, { providerVisits: n });
  const o = volumeOverage({ declaredCeiling: v.terms.ceiling, finalVisits: n, graceVisits: v.terms.grace, clinicPerVisit: v.terms.overageClinicCents, providerPerVisit: v.terms.overageProviderCents });
  const tz = a.shift.location.timeZone;
  await notifyClinic(prisma, a.shift.location.clinicOrgId, {
    template: "visits_submitted",
    title: `${a.provider.displayName} reported ${n} visits on ${dayLabel(a)}`,
    body: o.overageVisits
      ? `Your ${VOLUME_TIER_LABEL[v.tier]} day covers up to ${v.terms.ceiling + v.terms.grace} visits, so ${o.overageVisits} extra visit${o.overageVisits === 1 ? "" : "s"} add ${formatCents(o.clinicCents)}. It will be charged to your card on file at ${timeLabel(due, tz)} unless you report a different count before then.`
      : `That's within your ${VOLUME_TIER_LABEL[v.tier]} day (up to ${v.terms.ceiling + v.terms.grace} visits), so there's nothing extra to pay. If the count is wrong, tell us before ${timeLabel(due, tz)}.`,
    details: ["Counts only: never send patient names or details."],
    link: timesheetLink(assignmentId),
    ctaLabel: "Confirm or report a different count",
    sms: o.overageVisits > 0,
  }).catch((e) => console.error("visit notice failed", e));
  return { visits: n, overageVisits: o.overageVisits, chargeDueAt: due };
}

/** Booking completed without a count: remind the provider once. */
export async function remindVisitCount(assignmentId: string) {
  const a = await load(assignmentId);
  if (!termsOf(a) || a.visitCount?.providerVisits != null) return;
  const s = await getSettings();
  await notify(prisma, a.provider.userId, {
    template: "visits_reminder",
    title: "How many visits did you see?",
    body: `Enter the visit count for ${a.shift.location.name} on ${dayLabel(a)} (within ${s["pricing.volumeLateClaimHours"]} hours). Busy days past the booked tier pay extra per visit.`,
    link: `/provider/assignments/${a.id}`,
    ctaLabel: "Enter visits",
  }).catch(() => undefined);
}

// ---------------- clinic ----------------

function clinicCan(actor: Actor, a: Loaded) {
  if ((actor.role !== "CLINIC_OWNER" && actor.role !== "CLINIC_STAFF") || actor.clinicOrgId !== a.shift.location.clinicOrgId) throw new DomainError("NOT_FOUND", "Shift not found");
}
function openForClinic(a: Loaded) {
  const vc = a.visitCount;
  if (!vc || vc.providerVisits == null) throw new DomainError("CONFLICT", "The provider hasn't entered a visit count yet.");
  if (vc.status !== "OPEN") throw new DomainError("CONFLICT", "This count is already settled. Contact us if something's wrong.");
  if (vc.chargeDueAt && +clock.now() > +vc.chargeDueAt) throw new DomainError("CONFLICT", "The time to respond has passed. Contact us if something's wrong.");
  return vc;
}

async function confirm(a: Loaded, actor: Actor, userId: string | null) {
  const vc = openForClinic(a);
  await prisma.visitCount.update({ where: { assignmentId: a.id }, data: { clinicVisits: vc.providerVisits, clinicAt: clock.now(), clinicUserId: userId, chargeDueAt: clock.now() } });
  await audit(prisma, actor, "visits.confirmed", "Assignment", a.id, null, { visits: vc.providerVisits });
}

async function report(a: Loaded, actor: Actor, userId: string | null, visits: number, reason: string) {
  const vc = openForClinic(a);
  const n = cleanCount(visits);
  const why = reason.trim();
  if (why.length < 3) throw new DomainError("VALIDATION", "Tell us briefly why the count is different.");
  await prisma.visitCount.update({ where: { assignmentId: a.id }, data: { clinicVisits: n, clinicAt: clock.now(), clinicUserId: userId, clinicReason: why.slice(0, 300) } });
  await audit(prisma, actor, "visits.reported", "Assignment", a.id, { providerVisits: vc.providerVisits }, { clinicVisits: n, reason: why });
  const s = await getSettings();
  const o = countOutcome(vc.providerVisits!, n, s["pricing.countTolerance"]);
  await notify(prisma, a.provider.userId, {
    template: "visits_reported",
    title: `The clinic reported ${n} visits for ${dayLabel(a)}`,
    body: o.kind === "DISPUTED" ? `You entered ${vc.providerVisits}. We'll review both counts and let you know; the lower count is paid on schedule meanwhile.` : `You entered ${vc.providerVisits}; the difference is small, so we'll use ${o.finalVisits}.`,
    link: `/provider/assignments/${a.id}`,
  }).catch(() => undefined);
  if (o.kind === "DISPUTED") {
    await notifyAdmins(prisma, { template: "visits_disputed", title: `Visit count dispute: ${vc.providerVisits} vs ${n}`, body: `${a.provider.displayName} at ${a.shift.location.name}, ${dayLabel(a)}. Clinic: ${why}`, link: "/admin/timesheets?volume=DISPUTED" }).catch(() => undefined);
  }
}

export async function confirmVisitsAsClinic(actor: Actor, assignmentId: string) {
  const a = await load(assignmentId);
  clinicCan(actor, a);
  return confirm(a, actor, actor.userId ?? null);
}
export async function reportVisitsAsClinic(actor: Actor, assignmentId: string, visits: number, reason: string) {
  const a = await load(assignmentId);
  clinicCan(actor, a);
  return report(a, actor, actor.userId ?? null, visits, reason);
}
function byToken(token: string) {
  const id = assignmentIdFromTimesheetToken(token);
  if (!id) throw new DomainError("NOT_FOUND", "This link isn't valid.");
  return id;
}
export async function confirmVisitsByToken(token: string) {
  const a = await load(byToken(token));
  return confirm(a, SYSTEM, null);
}
export async function reportVisitsByToken(token: string, visits: number, reason: string) {
  const a = await load(byToken(token));
  return report(a, { userId: null, role: "CLINIC_OWNER", clinicOrgId: a.shift.location.clinicOrgId, providerId: null }, null, visits, reason);
}

// ---------------- settling ----------------

/** Net amount already collected for extra visits (charges minus their refunds). */
async function volumeCollected(assignmentId: string) {
  const charges = await prisma.payment.findMany({ where: { assignmentId, type: "VOLUME", status: "SUCCEEDED" }, select: { id: true, amountCents: true } });
  let net = charges.reduce((x, p) => x + p.amountCents, 0);
  for (const c of charges) {
    const r = await prisma.payment.aggregate({ where: { assignmentId, type: "REFUND", description: { contains: c.id } }, _sum: { amountCents: true } });
    net -= r._sum.amountCents ?? 0;
  }
  return net;
}

async function settle(assignmentId: string, finalVisits: number, outcome: string, status: "FINAL" | "DISPUTED", actor: Actor, note?: string) {
  const a = await load(assignmentId);
  const v = termsOf(a);
  if (!v) return null;
  const r = reconcileWithTerms(v.tier, v.terms, { clinicPriceCents: a.clinicPriceCents, providerPayCents: a.providerPayCents }, finalVisits);
  const now = clock.now();
  await prisma.visitCount.update({
    where: { assignmentId },
    data: {
      finalVisits, outcome, status, overageVisits: r.overageVisits, overageClinicCents: r.overageClinicCents, overageProviderCents: r.overageProviderCents, reconciliation: r as never,
      ...(actor.role === "PLATFORM_ADMIN" ? { resolvedById: actor.userId, resolutionNote: note?.slice(0, 500) ?? null } : {}),
    },
  });
  await audit(prisma, actor, "visits.settled", "Assignment", assignmentId, null, { finalVisits, outcome, status, overageClinicCents: r.overageClinicCents });

  // Clinic side: charge (or refund) the difference from what's already collected.
  const collected = await volumeCollected(assignmentId);
  const delta = r.overageClinicCents - collected;
  let covered = delta <= 0;
  if (delta > 0) {
    const seq = (await prisma.payment.count({ where: { assignmentId, type: "VOLUME" } })) + 1;
    const desc = `Extra visits · ${r.overageVisits} past ${r.allowedVisits} · ${a.startsAt.toISOString().slice(0, 10)}`;
    const p = await chargeVolume(assignmentId, delta, collected > 0 ? seq : 1, desc);
    covered = p?.status === "SUCCEEDED" || p?.status === "PROCESSING";
    if (p?.status === "FAILED") {
      await notifyClinic(prisma, a.shift.location.clinicOrgId, { template: "volume_charge_failed", title: "Action needed: the extra-visit charge didn't go through", body: `We couldn't charge ${formatCents(delta)} for extra visits on ${dayLabel(a)}. Please update your payment method.`, link: "/clinic/billing", ctaLabel: "Update payment method" }).catch(() => undefined);
      await notifyAdmins(prisma, { template: "volume_charge_failed", title: "Extra-visit charge failed", body: `${a.shift.location.name}, ${dayLabel(a)}: ${formatCents(delta)} (${p.failureReason ?? "declined"}).`, link: `/admin/shifts/${a.shiftId}` }).catch(() => undefined);
    }
  } else if (delta < 0) {
    await refundAssignment(actor.role === "PLATFORM_ADMIN" ? actor : SYSTEM, assignmentId, -delta, "Visit count corrected");
  }
  if (!covered) return r;
  await prisma.visitCount.update({ where: { assignmentId }, data: { chargedAt: now } });

  // Provider side: their per-visit share, once the clinic side is covered.
  const s = await getSettings();
  const shiftPayout = await prisma.payout.findUnique({ where: { assignmentId_kind: { assignmentId, kind: "SHIFT" } } });
  const release = new Date(Math.max(+now, +(shiftPayout?.releaseAt ?? now), +now + (shiftPayout ? 0 : s["payments.payoutHoldHours"] * HOUR)));
  const existing = await prisma.payout.findUnique({ where: { assignmentId_kind: { assignmentId, kind: "VOLUME" } } });
  const description = `Extra visits: ${r.overageVisits} × ${formatCents(v.terms.overageProviderCents)} · ${a.startsAt.toISOString().slice(0, 10)}`;
  if (!existing) {
    if (r.overageProviderCents > 0) {
      await prisma.payout.create({ data: { providerId: a.providerId, assignmentId, kind: "VOLUME", description, amountCents: r.overageProviderCents, status: "SCHEDULED", releaseAt: release } });
    }
  } else if (existing.status === "PAID" || existing.status === "PROCESSING") {
    const diff = r.overageProviderCents - existing.amountCents;
    if (diff !== 0) {
      await prisma.payout.create({ data: { providerId: a.providerId, kind: "ADJUSTMENT", description: `Visit count corrected (${a.startsAt.toISOString().slice(0, 10)})`, amountCents: diff, status: "SCHEDULED", releaseAt: release } });
    }
  } else {
    await prisma.payout.update({ where: { id: existing.id }, data: r.overageProviderCents > 0 ? { amountCents: r.overageProviderCents, description, status: existing.status === "CANCELLED" ? "SCHEDULED" : existing.status } : { status: "CANCELLED" } });
  }
  if (r.overageProviderCents > 0 && status === "FINAL") {
    await notify(prisma, a.provider.userId, { template: "volume_paid", title: `Extra visits: +${formatCents(r.overageProviderCents)}`, body: `${r.overageVisits} extra visit${r.overageVisits === 1 ? "" : "s"} on ${dayLabel(a)} at ${a.shift.location.name}. It's added to your next payout.`, link: "/provider/earnings" }).catch(() => undefined);
  }
  return r;
}

/** Admin sets the final count (disputes, corrections). Audited. */
export async function adminSetVisits(actor: Actor, assignmentId: string, visits: number, note: string) {
  if (actor.role !== "PLATFORM_ADMIN") throw new DomainError("FORBIDDEN", "Admins only.");
  const a = await load(assignmentId);
  if (!termsOf(a)) throw new DomainError("VALIDATION", "This shift isn't priced by visits.");
  if (note.trim().length < 3) throw new DomainError("VALIDATION", "Add a short note for the record.");
  const n = cleanCount(visits);
  if (!a.visitCount) await prisma.visitCount.create({ data: { assignmentId, chargeDueAt: clock.now() } });
  const r = await settle(assignmentId, n, "ADMIN", "FINAL", actor, note.trim());
  await notifyClinic(prisma, a.shift.location.clinicOrgId, { template: "visits_resolved", title: `Visit count set to ${n} for ${dayLabel(a)}`, body: `Reviewed by our team. ${r && r.overageVisits ? `${r.overageVisits} extra visit(s): ${formatCents(r.overageClinicCents)} in total.` : "Nothing extra to pay."}`, link: absoluteUrl(`/clinic/shifts/${a.shiftId}`) }).catch(() => undefined);
  return r;
}

/** Job: settle counts whose clinic window has closed; retry failed charges daily. */
export async function volumeSweep(now = clock.now()) {
  const s = await getSettings();
  const due = await prisma.visitCount.findMany({
    where: { status: "OPEN", providerVisits: { not: null }, chargeDueAt: { lte: now }, assignment: { status: "COMPLETED" } },
    take: 200,
  });
  let settled = 0;
  for (const vc of due) {
    const o = countOutcome(vc.providerVisits!, vc.clinicVisits, s["pricing.countTolerance"]);
    try {
      await settle(vc.assignmentId, o.finalVisits, o.kind, o.kind === "DISPUTED" ? "DISPUTED" : "FINAL", SYSTEM);
      settled++;
    } catch (e) {
      console.error("volume settle failed", vc.assignmentId, e);
    }
  }
  const retry = await prisma.visitCount.findMany({
    where: { status: { in: ["FINAL", "DISPUTED"] }, chargedAt: null, overageClinicCents: { gt: 0 }, finalVisits: { not: null }, updatedAt: { lt: new Date(+now - 24 * HOUR) } },
    take: 50,
  });
  for (const vc of retry) await settle(vc.assignmentId, vc.finalVisits!, vc.outcome ?? "PROVIDER", vc.status as "FINAL" | "DISPUTED", SYSTEM).catch(() => undefined);
  return settled;
}

// ---------------- views ----------------

/** Volume facts for a booking, shaped for who's looking (clinic never sees provider pay and vice versa). */
export async function visitView(assignmentId: string, side: "CLINIC" | "PROVIDER" | "ADMIN") {
  const a = await load(assignmentId);
  const v = termsOf(a);
  if (!v) return null;
  const s = await getSettings();
  const vc = a.visitCount;
  const perVisit = side === "PROVIDER" ? v.terms.overageProviderCents : v.terms.overageClinicCents;
  const lateUntil = new Date(+a.endsAt + s["pricing.volumeLateClaimHours"] * HOUR);
  return {
    tier: v.tier,
    tierLabel: VOLUME_TIER_LABEL[v.tier],
    expected: a.shift.expectedPatients,
    allowedVisits: v.terms.ceiling + v.terms.grace,
    ceiling: v.terms.ceiling,
    grace: v.terms.grace,
    perVisitCents: perVisit,
    providerVisits: vc?.providerVisits ?? null,
    clinicVisits: vc?.clinicVisits ?? null,
    clinicReason: side === "PROVIDER" ? null : (vc?.clinicReason ?? null),
    status: vc?.status ?? null,
    outcome: vc?.outcome ?? null,
    finalVisits: vc?.finalVisits ?? null,
    overageVisits: vc?.overageVisits ?? 0,
    overageCents: side === "PROVIDER" ? (vc?.overageProviderCents ?? 0) : side === "CLINIC" ? (vc?.overageClinicCents ?? 0) : (vc?.overageClinicCents ?? 0),
    overageProviderCents: side === "ADMIN" ? (vc?.overageProviderCents ?? 0) : undefined,
    chargeDueAt: vc?.chargeDueAt ?? null,
    chargedAt: vc?.chargedAt ?? null,
    canSubmit: side === "PROVIDER" && LIVE.includes(a.status) && +clock.now() >= +a.startsAt && +clock.now() <= +lateUntil && (!vc || (vc.status === "OPEN" && vc.clinicVisits == null)),
    canRespond: side === "CLINIC" && !!vc && vc.providerVisits != null && vc.status === "OPEN" && (!vc.chargeDueAt || +clock.now() <= +vc.chargeDueAt) && vc.clinicVisits == null,
    lateUntil,
  };
}

export async function visitViewForProvider(actor: Actor, assignmentId: string) {
  const a = await prisma.assignment.findUnique({ where: { id: assignmentId }, select: { providerId: true } });
  if (!a || actor.role !== "PROVIDER" || actor.providerId !== a.providerId) return null;
  return visitView(assignmentId, "PROVIDER");
}
export async function visitViewForClinic(actor: Actor, assignmentId: string) {
  const a = await load(assignmentId);
  clinicCan(actor, a);
  return visitView(assignmentId, "CLINIC");
}
export async function visitViewByToken(token: string) {
  const id = assignmentIdFromTimesheetToken(token);
  return id ? visitView(id, "CLINIC") : null;
}

/** Admin list: disputed (or all recent) counts. */
export async function adminVisitCounts(actor: Actor, status?: string) {
  if (actor.role !== "PLATFORM_ADMIN") throw new DomainError("FORBIDDEN", "Admins only.");
  return prisma.visitCount.findMany({
    where: status ? { status } : {},
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: { assignment: { include: { provider: { select: { displayName: true } }, shift: { include: { location: { select: { name: true, timeZone: true } } } } } } },
  });
}

/** Recent final counts at a location (posting prefill / history for admins). */
export async function locationVisitHistory(locationId: string, take = 10) {
  const rows = await prisma.visitCount.findMany({ where: { finalVisits: { not: null }, assignment: { shift: { locationId } } }, orderBy: { assignment: { startsAt: "desc" } }, take, select: { finalVisits: true, assignment: { select: { startsAt: true } } } });
  return rows.map((r) => ({ visits: r.finalVisits!, date: r.assignment.startsAt }));
}
