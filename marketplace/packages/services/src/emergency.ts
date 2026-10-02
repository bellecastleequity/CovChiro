import { DomainError } from "@cm/core";
import { prisma, type Prisma } from "@cm/db";
import { audit, clock, getSettings, requireAdmin, requireClinic, SYSTEM, type Actor } from "./context";
import { notifyAdmins, notifyClinic } from "./notify";

/**
 * Emergency cover: a provider cancels within 24h of the start, is released
 * for not reconfirming, doesn't show, or an admin asks for it.
 *
 * The shift (or, after a no-show, a replacement for the remaining time) goes
 * out to every eligible provider at once, with a wider drive radius and a
 * rescue bonus paid from the platform margin that steps up (10 → 15 → 20%)
 * each time nobody accepts. Everything still goes through
 * getEligibleProviders — licensure is never relaxed.
 */

const MIN = 60_000;
const SELECTABLE = ["OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING"];

export type EmergencySource = "PROVIDER_CANCEL" | "UNCONFIRMED" | "NO_SHOW" | "ADMIN";

const SOURCE_LABEL: Record<EmergencySource, string> = {
  PROVIDER_CANCEL: "provider cancelled",
  UNCONFIRMED: "provider didn't reconfirm",
  NO_SHOW: "provider didn't show",
  ADMIN: "started by admin",
};

/** Put an open shift into emergency cover and (re)start dispatch in emergency mode. */
export async function activateEmergency(shiftId: string, source: EmergencySource, reason: string, actor: Actor = SYSTEM) {
  const s = await getSettings();
  const shift = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId }, include: { location: { include: { clinicOrg: true } } } });
  if (!SELECTABLE.includes(shift.status)) throw new DomainError("CONFLICT", "This shift isn't open for cover right now.");
  const { cancelDispatch, rescuePay, startDispatch } = await import("./dispatch");
  const first = s["emergency.bonusStepsPercent"][0] ?? 0;
  const base = shift.emergencyBasePayCents ?? shift.providerPayCents;
  const now = clock.now();
  await prisma.shift.update({
    where: { id: shiftId },
    data: {
      emergencyAt: shift.emergencyAt ?? now,
      emergencySource: source,
      emergencyReason: reason.slice(0, 300),
      emergencyBasePayCents: base,
      emergencyBonusPercent: first,
      providerPayCents: rescuePay(base, first, shift.clinicPriceCents, shift.promoDiscountCents),
      // The clinic's experience minimum gives way in an emergency unless it opted out.
      ...(shift.location.clinicOrg.relaxExperienceInEmergency ? { minYearsExperience: 0 } : {}),
    },
  });
  await audit(prisma, actor, "emergency.started", "Shift", shiftId, null, { source, reason, bonusPercent: first });
  // A dispatch already running in normal mode restarts in emergency mode.
  await cancelDispatch({ userId: null, role: "PLATFORM_ADMIN" }, shiftId);
  const r = await startDispatch(shiftId, source === "ADMIN" ? "ADMIN" : source === "NO_SHOW" ? "CLINIC_REQUEST" : "BACKFILL", actor);
  const t = shift.startsAt.toLocaleTimeString("en-US", { timeZone: shift.location.timeZone, hour: "numeric", minute: "2-digit" });
  await notifyAdmins(prisma, {
    template: "emergency_started",
    title: `Emergency cover: ${shift.location.clinicOrg.displayName}, ${t} (${SOURCE_LABEL[source]})`,
    body: `Every eligible provider nearby is being texted now with a +${first}% rescue bonus. ${reason}`,
    link: `/admin/emergencies/${shiftId}`,
    ctaLabel: "Open emergency screen",
  });
  return r;
}

/**
 * No-show (reported by the clinic, or by an admin who can't reach the
 * provider): record it, refund the clinic for that provider, and send a
 * replacement for the rest of the shift.
 */
export async function reportNoShow(actor: Actor, assignmentId: string, opts: { note?: string } = {}) {
  const s = await getSettings();
  const now = clock.now();
  const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { provider: true, shift: { include: { location: { include: { clinicOrg: true } } } } } });
  const source = actor.role === "PLATFORM_ADMIN" ? "ADMIN" : "CLINIC";
  if (source === "CLINIC") {
    const orgId = requireClinic(actor);
    if (a.shift.location.clinicOrgId !== orgId) throw new DomainError("NOT_FOUND", "Shift not found");
    if (+now < +a.startsAt - 15 * MIN) throw new DomainError("VALIDATION", "You can report a no-show from 15 minutes before the start.");
  } else requireAdmin(actor);
  if (a.status !== "CONFIRMED" && a.status !== "IN_PROGRESS") throw new DomainError("CONFLICT", "This booking isn't active.");
  if (a.arrivedAt) throw new DomainError("CONFLICT", "This provider was marked as arrived.");
  if (+now >= +a.endsAt) throw new DomainError("VALIDATION", "This shift has already ended.");

  const reason = opts.note?.trim() || (source === "CLINIC" ? "Clinic reported the provider didn't show" : "Admin: provider didn't show / unreachable");
  const { cancelAssignment } = await import("./shifts");
  await cancelAssignment(SYSTEM, a.id, reason, { by: "PROVIDER", noShow: true, onBehalf: true, quiet: true });

  // Replacement for what's left of the shift, leaving time to get there.
  const startsAt = new Date(Math.max(+a.startsAt, +now + s["emergency.replacementLeadMinutes"] * MIN));
  const clinic = a.shift.location.clinicOrg.displayName;
  if (+a.endsAt - +startsAt < s["emergency.minRemainingMinutes"] * MIN) {
    await notifyClinic(prisma, a.shift.location.clinicOrgId, {
      template: "no_show_no_replacement",
      title: `${a.provider.displayName} didn't show — you won't be charged`,
      body: "Too little of the shift is left to send a replacement in time. You won't be charged for this shift, and our team will follow up.",
      link: `/clinic/shifts/${a.shiftId}`,
      sms: true,
    });
    await notifyAdmins(prisma, { template: "no_show_admin", title: `No-show: ${a.provider.displayName} at ${clinic} (too late to replace)`, body: reason, link: `/admin/shifts/${a.shiftId}` });
    return { replacementShiftId: null };
  }
  const replacementShiftId = await createReplacementShift(a.shiftId, startsAt, actor);
  await notifyClinic(prisma, a.shift.location.clinicOrgId, {
    template: "no_show_replacement",
    title: `${a.provider.displayName} didn't show — we're finding a replacement now`,
    body: `We're sorry about this. No need to worry — we're finding a replacement urgently as we speak, texting every eligible provider nearby, and we'll email you the moment your new provider is confirmed. You won't be charged for ${a.provider.displayName}.`,
    link: `/clinic/shifts/${replacementShiftId}`,
    sms: true,
  });
  await activateEmergency(replacementShiftId, "NO_SHOW", `${a.provider.displayName} didn't show (${reason})`, actor);
  return { replacementShiftId };
}

/**
 * A copy of the original shift for the remaining time. Priced as the same
 * deal pro-rated (no new urgency premiums — the clinic didn't cause this);
 * the rescue bonus is added later from the margin.
 */
async function createReplacementShift(originalId: string, startsAt: Date, actor: Actor) {
  const o = await prisma.shift.findUniqueOrThrow({ where: { id: originalId } });
  const ratio = Math.min(1, (+o.endsAt - +startsAt) / (+o.endsAt - +o.startsAt));
  const basePay = o.emergencyBasePayCents ?? o.providerPayCents;
  const now = clock.now();
  const shift = await prisma.shift.create({
    data: {
      locationId: o.locationId,
      professionCode: o.professionCode,
      state: "XX", // replaced by trigger from the location's geocoded state
      startsAt,
      endsAt: o.endsAt,
      requiredSkillIds: o.requiredSkillIds,
      minYearsExperience: o.minYearsExperience,
      preferredSkillIds: o.preferredSkillIds,
      expectedPatients: o.expectedPatients,
      notes: ["Emergency replacement — the original provider didn't show.", o.notes].filter(Boolean).join("\n\n"),
      instantBook: false,
      maxTravelBudgetCents: o.maxTravelBudgetCents,
      lodgingAllowed: false,
      rateCardId: o.rateCardId,
      durationTier: o.durationTier,
      clinicPriceCents: Math.round(o.clinicPriceCents * ratio),
      providerPayCents: Math.round(basePay * ratio),
      premiumsApplied: o.premiumsApplied as Prisma.InputJsonValue,
      declaredTier: o.declaredTier,
      volumeTerms: (o.volumeTerms ?? undefined) as Prisma.InputJsonValue | undefined,
      supervisionAttestation: (o.supervisionAttestation ?? undefined) as Prisma.InputJsonValue | undefined,
      supervisionAttestedById: o.supervisionAttestedById,
      supervisionAttestedAt: o.supervisionAttestedAt,
      createdById: o.createdById,
      rescueOfShiftId: o.id,
    },
  });
  await prisma.shift.update({ where: { id: shift.id }, data: { status: "OPEN", postedAt: now, selectionDeadline: now } });
  await audit(prisma, actor, "shift.replacement_created", "Shift", shift.id, null, { rescueOf: o.id, startsAt, clinicPriceCents: shift.clinicPriceCents });
  return shift.id;
}

/** Admin "Find cover now": no-show path for a booked shift, emergency dispatch for an open one. */
export async function findCoverNow(actor: Actor, shiftId: string, note?: string) {
  requireAdmin(actor);
  const live = await prisma.assignment.findFirst({ where: { shiftId, status: { in: ["CONFIRMED", "IN_PROGRESS"] } } });
  if (live) {
    const r = await reportNoShow(actor, live.id, { note });
    return r.replacementShiftId ? { shiftId: r.replacementShiftId, message: "Provider recorded as a no-show; emergency replacement is going out now." } : { shiftId, message: "Recorded as a no-show. Too little time left to send a replacement." };
  }
  await activateEmergency(shiftId, "ADMIN", note?.trim() || "Started by admin", actor);
  return { shiftId, message: "Emergency cover started: everyone eligible is being texted now." };
}

/** Clinic: "Provider arrived" — also stops any worry about a no-show. */
export async function markArrived(actor: Actor, assignmentId: string) {
  const orgId = requireClinic(actor);
  const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { shift: { include: { location: true } } } });
  if (a.shift.location.clinicOrgId !== orgId) throw new DomainError("NOT_FOUND", "Shift not found");
  if (a.status !== "CONFIRMED" && a.status !== "IN_PROGRESS") throw new DomainError("CONFLICT", "This booking isn't active.");
  if (!a.arrivedAt) {
    await prisma.assignment.update({ where: { id: a.id }, data: { arrivedAt: clock.now() } });
    await audit(prisma, actor, "assignment.arrived", "Assignment", a.id, null, null);
  }
  return "Thanks — marked as arrived.";
}

// ---------------- admin views ----------------

/** Open emergencies (still looking) plus those filled in the last 24 hours. */
export async function emergencies(actor: Actor) {
  requireAdmin(actor);
  const since = new Date(+clock.now() - 24 * 60 * MIN);
  const rows = await prisma.shift.findMany({
    where: { emergencyAt: { not: null }, OR: [{ status: { in: SELECTABLE as never } }, { emergencyAt: { gte: since } }] },
    include: { location: { include: { clinicOrg: true } }, assignments: { where: { status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] } }, include: { provider: true } } },
    orderBy: { emergencyAt: "desc" },
  });
  return rows.map((r) => ({ ...r, open: SELECTABLE.includes(r.status) }));
}

export async function openEmergencyCount() {
  return prisma.shift.count({ where: { emergencyAt: { not: null }, status: { in: SELECTABLE as never } } });
}

/** The emergency screen: the shift, live offer status, and nearby eligible providers with phone numbers. */
export async function emergencyView(actor: Actor, shiftId: string) {
  requireAdmin(actor);
  const s = await getSettings();
  const shift = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId }, include: { location: { include: { clinicOrg: true } }, assignments: { include: { provider: { include: { user: true } } }, orderBy: { confirmedAt: "desc" } } } });
  const { dispatchStatus } = await import("./dispatch");
  const { getEligibleProviders, loadShift } = await import("./eligibility");
  const [status, offers] = await Promise.all([
    dispatchStatus(shiftId),
    prisma.offer.findMany({ where: { shiftId }, include: { provider: { include: { user: true } } }, orderBy: { createdAt: "desc" } }),
  ]);
  const open = SELECTABLE.includes(shift.status);
  let candidates: { providerId: string; name: string; phone: string | null; driveMinutes: number | null; lastOffer: string | null }[] = [];
  if (open) {
    const set = await getEligibleProviders(prisma, await loadShift(prisma, shiftId), { distanceMultiplierAll: s["emergency.driveMultiplier"] });
    const users = await prisma.provider.findMany({ where: { id: { in: set.eligible.map((e) => e.providerId) } }, include: { user: true } });
    const uBy = new Map(users.map((u) => [u.id, u]));
    // Latest offer per provider; on a timestamp tie (a re-offer in the same instant) the live one wins.
    const live = (st: string) => (st === "PENDING" || st === "ACCEPTED_PENDING" || st === "ACCEPTED" ? 1 : 0);
    const latest = new Map<string, (typeof offers)[number]>();
    for (const o of offers) {
      const cur = latest.get(o.providerId);
      if (!cur || +o.createdAt > +cur.createdAt || (+o.createdAt === +cur.createdAt && live(o.status) > live(cur.status))) latest.set(o.providerId, o);
    }
    const lastBy = new Map([...latest].map(([k, o]) => [k, o.status as string]));
    candidates = set.eligible
      .map((e) => ({ providerId: e.providerId, name: e.provider.displayName, phone: uBy.get(e.providerId)?.user.phone ?? null, driveMinutes: e.drive?.minutes ?? null, lastOffer: lastBy.get(e.providerId) ?? null }))
      .sort((a, b) => (a.driveMinutes ?? 999) - (b.driveMinutes ?? 999));
  }
  return { shift, open, status, offers, candidates, stepMinutes: s["emergency.stepMinutes"], steps: s["emergency.bonusStepsPercent"] };
}
