import { DAY, DomainError, evaluateEligibility, expiryReminderDue, HOUR } from "@cm/core";
import { prisma, type Prisma } from "@cm/db";
import { audit, getSettings, requireAdmin, requireClinic, requireProvider, SYSTEM, type Actor } from "./context";
import { eligibilityOptions, loadProviders, loadShift } from "./eligibility";
import { notify, notifyAdmins, notifyClinic } from "./notify";
import { chargeBalance, chargeLodging, refundAssignment } from "./payments";
import { scheduleShiftPayout } from "./payouts";
import { cancelAssignment } from "./shifts";

/**
 * Time-driven transitions. Every function is idempotent and safe to retry;
 * the worker calls them on a schedule (apps/worker).
 */

/** CONFIRMED → IN_PROGRESS at start time. The DB trigger re-checks credentials on this update. */
export async function startDueShifts(now = new Date()) {
  const due = await prisma.assignment.findMany({ where: { status: "CONFIRMED", startsAt: { lte: now } } });
  for (const a of due) {
    try {
      await prisma.$transaction([
        prisma.assignment.update({ where: { id: a.id }, data: { status: "IN_PROGRESS", startedAt: now } }),
        prisma.shift.update({ where: { id: a.shiftId }, data: { status: "IN_PROGRESS" } }),
      ]);
    } catch (e) {
      // Credential lapsed between the last sweep and now: treat as a lapse.
      await handleLapse(a.id, e instanceof Error ? e.message : String(e));
    }
  }
  return due.length;
}

/** IN_PROGRESS → COMPLETED at end + autoCompleteHours unless a dispute is open. */
export async function autoCompleteDue(now = new Date()) {
  const s = await getSettings();
  const cutoff = new Date(+now - s["payments.autoCompleteHours"] * HOUR);
  const due = await prisma.assignment.findMany({ where: { status: "IN_PROGRESS", endsAt: { lte: cutoff } }, include: { disputes: { where: { status: "OPEN" } } } });
  let done = 0;
  for (const a of due) {
    if (a.disputes.length) continue;
    await completeAssignment(a.id, now);
    done++;
  }
  return done;
}

export async function completeAssignment(assignmentId: string, now = new Date()) {
  const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { shift: { include: { location: true } }, provider: true } });
  if (a.status === "COMPLETED") return;
  await prisma.$transaction(async (db) => {
    await db.assignment.update({ where: { id: a.id }, data: { status: "COMPLETED", completedAt: now } });
    await db.shift.update({ where: { id: a.shiftId }, data: { status: "COMPLETED" } });
    await scheduleShiftPayout(db, a.id, now);
    await db.providerStats.upsert({ where: { providerId: a.providerId }, create: { providerId: a.providerId }, update: {} });
    await audit(db, SYSTEM, "assignment.completed", "Assignment", a.id, { status: a.status }, { status: "COMPLETED" });
  });
  await recomputeStats(a.providerId);
  await chargeBalance(a.id);
  if (a.shift.declaredTier) await import("./volume").then((v) => v.remindVisitCount(a.id)).catch(() => undefined);
  await notify(prisma, a.provider.userId, {
    template: "rate_shift",
    title: "How was your shift?",
    body: `Rate ${a.shift.location.name} — ratings are revealed once both sides submit or after 14 days.`,
    link: `/provider/assignments/${a.id}`,
    ctaLabel: "Leave a rating",
  });
  await notifyClinic(prisma, a.shift.location.clinicOrgId, {
    template: "rate_shift",
    title: "How did your coverage go?",
    body: `Rate ${a.provider.displayName}. If something went wrong, you can open a dispute for 48 hours after the shift.`,
    link: `/clinic/shifts/${a.shiftId}`,
    ctaLabel: "Rate your provider",
  });
}

/** Reliability + rating aggregates (global and per profession). */
export async function recomputeStats(providerId: string, now = new Date()) {
  const yearAgo = new Date(+now - 365 * DAY);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [assignments, ratings, lateCancels, noShows] = await Promise.all([
    prisma.assignment.findMany({ where: { providerId, status: "COMPLETED" }, select: { professionCode: true, startsAt: true } }),
    prisma.rating.findMany({ where: { raterType: "CLINIC", assignment: { providerId } }, include: { assignment: { select: { professionCode: true } } } }),
    prisma.auditLog.count({ where: { action: "assignment.cancelled", entityType: "Assignment", createdAt: { gte: yearAgo }, after: { path: ["outcome", "countsAsLateCancel"], equals: true } } }),
    prisma.assignment.count({ where: { providerId, status: "NO_SHOW", startsAt: { gte: yearAgo } } }),
  ]);
  const byProf: Record<string, { sum: number; count: number }> = {};
  for (const r of ratings) {
    const k = r.assignment.professionCode;
    byProf[k] = { sum: (byProf[k]?.sum ?? 0) + r.stars, count: (byProf[k]?.count ?? 0) + 1 };
  }
  const completedByProf: Record<string, number> = {};
  for (const a of assignments) completedByProf[a.professionCode] = (completedByProf[a.professionCode] ?? 0) + 1;
  const recent = assignments.filter((a) => a.startsAt >= yearAgo);
  const stats = await prisma.providerStats.findUnique({ where: { providerId } });
  const data = {
    completedShifts: recent.length,
    ratingSum: ratings.reduce((x, r) => x + r.stars, 0),
    ratingCount: ratings.length,
    ratingByProfession: byProf,
    completedByProfession: completedByProf,
    lastShiftAt: assignments.reduce<Date | null>((m, a) => (!m || a.startsAt > m ? a.startsAt : m), null),
    shiftsThisMonth: assignments.filter((a) => a.startsAt >= monthStart).length,
    noShows,
    // lateCancels is incremented at cancel time; keep the larger of the two counts.
    lateCancels: Math.max(stats?.lateCancels ?? 0, lateCancels),
  };
  await prisma.providerStats.upsert({ where: { providerId }, create: { providerId, ...data }, update: data });
}

/** Credential no longer qualifies for a future/in-progress assignment (SPEC INV-1 #7/#8). */
export async function handleLapse(assignmentId: string, reason: string) {
  const a = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  if (!a || !["CONFIRMED", "IN_PROGRESS"].includes(a.status)) return;
  await prisma.adminTask.create({ data: { kind: "LICENSE_LAPSED", title: `Credential lapse on assignment ${a.id}`, entityType: "Assignment", entityId: a.id } });
  if (a.status === "IN_PROGRESS") {
    await notifyAdmins(prisma, { template: "lapse_in_progress", title: "Credential lapsed during an in-progress shift", body: reason, link: `/admin/shifts/${a.shiftId}` });
    return;
  }
  await cancelAssignment(SYSTEM, a.id, `Credential no longer qualifies: ${reason}`, { by: "PLATFORM", lapse: true });
}

/** Re-run INV-1/INV-3/INV-8 for the given assignments; lapse the ones that fail. */
async function recheckAssignments(ids: string[], label: string) {
  const s = await getSettings();
  let lapsed = 0;
  for (const id of ids) {
    const a = await prisma.assignment.findUniqueOrThrow({ where: { id } });
    const shift = await loadShift(prisma, a.shiftId);
    const providers = await loadProviders(prisma, [a.providerId], a.shiftId);
    const p = providers.get(a.providerId)!;
    const r = evaluateEligibility(p.facts, shift.facts, { driveMinutes: 0, travelEstimateCents: 0, blocked: false, previouslyDeclined: false }, eligibilityOptions(s, { credentialsOnly: true }));
    if (!r.eligible) {
      lapsed++;
      await handleLapse(id, `${label}: ${r.failures.map((f) => f.message).join("; ")}`);
    }
  }
  return lapsed;
}

/** Re-check one provider's booked shifts now (a credential just stopped counting). */
export async function recheckProviderAssignments(providerId: string, label: string) {
  const future = await prisma.assignment.findMany({ where: { providerId, status: { in: ["CONFIRMED", "IN_PROGRESS"] }, endsAt: { gt: new Date() } }, select: { id: true } });
  return recheckAssignments(future.map((f) => f.id), label);
}

/** Nightly (2:00 AM ET): expire credentials, re-check future assignments, reminders, re-verify tasks. */
export async function nightlyCredentialSweep(now = new Date()) {
  const expired = await prisma.$transaction([
    prisma.license.updateMany({ where: { status: "VERIFIED", expiresAt: { lte: now } }, data: { status: "EXPIRED" } }),
    prisma.malpracticePolicy.updateMany({ where: { status: "VERIFIED", expiresAt: { lte: now } }, data: { status: "EXPIRED" } }),
    prisma.providerSkill.updateMany({ where: { certificationStatus: "VERIFIED", certificationExpiresAt: { lte: now } }, data: { certificationStatus: "EXPIRED" } }),
  ]);
  const future = await prisma.assignment.findMany({ where: { status: { in: ["CONFIRMED", "IN_PROGRESS"] }, endsAt: { gt: now } }, select: { id: true } });
  const lapsed = await recheckAssignments(future.map((f) => f.id), "Nightly credential sweep");

  // Expiry reminders at the configured points (default 60/30/14/7 days); the last one also by SMS.
  const reminderDays = (await getSettings())["credentials.expiryReminderDays"];
  const soon = new Date(+now + (Math.max(...reminderDays) + 1) * DAY);
  const [lics, pols] = await Promise.all([
    prisma.license.findMany({ where: { status: "VERIFIED", expiresAt: { lte: soon, gt: now } }, include: { provider: true } }),
    prisma.malpracticePolicy.findMany({ where: { status: "VERIFIED", expiresAt: { lte: soon, gt: now } }, include: { provider: true } }),
  ]);
  for (const c of [...lics.map((l) => ({ ...l, label: `${l.professionCode} license (${l.state})` })), ...pols.map((p) => ({ ...p, label: "Malpractice policy" }))]) {
    const due = expiryReminderDue(c.expiresAt, now, reminderDays);
    if (!due) continue;
    await notify(prisma, c.provider.userId, {
      template: "credential_expiring",
      title: `Your ${c.label} expires in ${due} days`,
      body: "Upload the renewal so you stay eligible for shifts. Shifts after the expiration date won't be offered to you.",
      link: "/provider/credentials",
      ctaLabel: "Update credentials",
      sms: due === Math.min(...reminderDays),
    });
  }
  // Re-verification tasks.
  const reverify = await prisma.license.findMany({ where: { status: "VERIFIED", nextReverifyAt: { lte: now } } });
  for (const l of reverify) {
    const exists = await prisma.adminTask.findFirst({ where: { kind: "REVERIFY", entityId: l.id, resolvedAt: null } });
    if (!exists) await prisma.adminTask.create({ data: { kind: "REVERIFY", title: `Re-verify ${l.professionCode} license ${l.licenseNumber} (${l.state})`, entityType: "License", entityId: l.id } });
  }
  // Malpractice: re-confirm with the carrier every 90 days (coverage can be cancelled any time).
  const policies = await prisma.malpracticePolicy.findMany({ where: { status: "VERIFIED", nextReverifyAt: { lte: now } }, include: { provider: { select: { displayName: true } } } });
  for (const p of policies) {
    const exists = await prisma.adminTask.findFirst({ where: { kind: "REVERIFY", entityId: p.id, resolvedAt: null } });
    if (!exists) await prisma.adminTask.create({ data: { kind: "REVERIFY", title: `Re-verify ${p.provider.displayName}'s malpractice policy ${p.policyNumber} (${p.carrier}) with the carrier`, entityType: "MalpracticePolicy", entityId: p.id } });
  }
  return { expiredLicenses: expired[0].count, expiredPolicies: expired[1].count, expiredCerts: expired[2].count, lapsed, reverifyTasks: reverify.length + policies.length };
}

/** 24h before each shift: re-verify eligibility (SPEC INV-1 #8). */
export async function preShiftChecks(now = new Date()) {
  const upcoming = await prisma.assignment.findMany({
    where: { status: "CONFIRMED", startsAt: { gt: now, lte: new Date(+now + 24 * HOUR) }, NOT: { flags: { has: "PRECHECKED" } } },
    select: { id: true },
  });
  const lapsed = await recheckAssignments(upcoming.map((u) => u.id), "24-hour pre-shift check");
  for (const u of upcoming) {
    const a = await prisma.assignment.findUnique({ where: { id: u.id }, include: { provider: true, shift: { include: { location: true } } } });
    if (a?.status !== "CONFIRMED") continue;
    await prisma.assignment.update({ where: { id: a.id }, data: { flags: { push: "PRECHECKED" } } });
    await notify(prisma, a.provider.userId, {
      template: "reminder_24h",
      title: `Reminder: shift tomorrow at ${a.shift.location.name}`,
      body: `${a.shift.location.addressLine1}, ${a.shift.location.city}. Starts ${a.startsAt.toLocaleTimeString("en-US", { timeZone: a.shift.location.timeZone, hour: "numeric", minute: "2-digit" })}.`,
      link: `/provider/assignments/${a.id}`,
      sms: true,
    });
  }
  return { checked: upcoming.length, lapsed };
}

/** Selectable shifts that reach their start time unfilled → UNFILLED. */
export async function markUnfilled(now = new Date()) {
  const r = await prisma.shift.updateMany({ where: { status: { in: ["OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING"] }, startsAt: { lte: now } }, data: { status: "UNFILLED" } });
  return r.count;
}

/** Failed deposits not fixed within the window: cancel with no provider penalty and reopen. */
export async function failedDepositSweep(now = new Date()) {
  const s = await getSettings();
  const flagged = await prisma.assignment.findMany({ where: { status: "CONFIRMED", flags: { has: "PAYMENT_FAILED" } }, include: { payments: true } });
  let cancelled = 0;
  for (const a of flagged) {
    const dep = a.payments.find((p) => p.type === "DEPOSIT");
    if (dep?.status === "SUCCEEDED") {
      await prisma.assignment.update({ where: { id: a.id }, data: { flags: { set: a.flags.filter((f) => f !== "PAYMENT_FAILED") } } });
      continue;
    }
    const urgent = +a.startsAt - +a.confirmedAt < 48 * HOUR;
    const window = (urgent ? s["payments.paymentFixWindowUrgentHours"] : s["payments.paymentFixWindowHours"]) * HOUR;
    if (+now - +a.confirmedAt >= window) {
      await cancelAssignment(SYSTEM, a.id, "Clinic deposit could not be collected", { by: "PLATFORM" });
      cancelled++;
    }
  }
  return cancelled;
}

// ---------------- lodging receipts ----------------

export async function submitLodgingReceipt(actor: Actor, assignmentId: string, input: { amountCents: number; nights: number; fileUrl: string }) {
  const providerId = requireProvider(actor);
  const a = await prisma.assignment.findFirst({ where: { id: assignmentId, providerId }, include: { shift: true } });
  if (!a) throw new DomainError("NOT_FOUND", "Assignment not found");
  if (!a.shift.lodgingAllowed) throw new DomainError("VALIDATION", "Lodging isn't covered for this shift.");
  // Bookings made since the flat nightly allowance already include lodging in the pay: no receipts.
  if (a.lodgingEstimateCents > 0 && a.clinicTotalCents >= a.clinicPriceCents - a.promoDiscountCents + a.mileageCents + a.lodgingEstimateCents) {
    throw new DomainError("VALIDATION", "Lodging is a flat nightly allowance that's already included in your pay. No receipt needed.");
  }
  const r = await prisma.lodgingReceipt.create({ data: { assignmentId, amountCents: input.amountCents, nights: input.nights, fileUrl: input.fileUrl } });
  await prisma.adminTask.create({ data: { kind: "LODGING_RECEIPT", title: "Lodging receipt to review", entityType: "LodgingReceipt", entityId: r.id } });
  return r;
}

export async function reviewLodgingReceipt(actor: Actor, receiptId: string, approve: boolean) {
  requireAdmin(actor);
  const r = await prisma.lodgingReceipt.findUniqueOrThrow({ where: { id: receiptId }, include: { assignment: { include: { shift: true } } } });
  if (r.status !== "SUBMITTED") throw new DomainError("CONFLICT", "Already reviewed.");
  const cap = (r.assignment.shift.lodgingCapCentsPerNight ?? 0) * r.nights;
  const approved = approve ? Math.min(r.amountCents, cap) : 0;
  await prisma.$transaction(async (db) => {
    await db.lodgingReceipt.update({ where: { id: receiptId }, data: { status: approve ? "APPROVED" : "REJECTED", approvedCents: approved, reviewedById: actor.userId, reviewedAt: new Date() } });
    if (approve && approved > 0) {
      await db.assignment.update({
        where: { id: r.assignmentId },
        data: { lodgingApprovedCents: { increment: approved }, clinicTotalCents: { increment: approved }, providerTotalCents: { increment: approved } },
      });
      // 100% pass-through: the provider is paid exactly what the clinic is charged.
      await db.payout.upsert({
        where: { assignmentId_kind: { assignmentId: r.assignmentId, kind: "LODGING" } },
        create: { providerId: r.assignment.providerId, assignmentId: r.assignmentId, kind: "LODGING", description: "Lodging reimbursement", amountCents: approved, status: "SCHEDULED", releaseAt: new Date() },
        update: { amountCents: { increment: approved } },
      });
    }
    await audit(db, actor, approve ? "lodging.approved" : "lodging.rejected", "LodgingReceipt", receiptId, null, { approvedCents: approved });
  });
  if (approved > 0) await chargeLodging(r.assignmentId, receiptId, approved);
}

// ---------------- disputes ----------------

export async function openDispute(actor: Actor, assignmentId: string, reason: string) {
  const s = await getSettings();
  const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { shift: { include: { location: true } } } });
  let party: "CLINIC" | "PROVIDER";
  let partyId: string;
  if (actor.role === "PROVIDER") {
    if (a.providerId !== requireProvider(actor)) throw new DomainError("NOT_FOUND", "Assignment not found");
    party = "PROVIDER";
    partyId = a.providerId;
  } else {
    const orgId = requireClinic(actor);
    if (a.shift.location.clinicOrgId !== orgId) throw new DomainError("NOT_FOUND", "Assignment not found");
    party = "CLINIC";
    partyId = orgId;
  }
  if (Date.now() - +a.endsAt > s["payments.disputeWindowHours"] * HOUR) throw new DomainError("CONFLICT", "The dispute window for this shift has closed.");
  if (!["IN_PROGRESS", "COMPLETED"].includes(a.status)) throw new DomainError("CONFLICT", "Disputes can be opened only for worked shifts.");
  const d = await prisma.dispute.create({ data: { assignmentId, openedByType: party, openedById: partyId, reason: reason.slice(0, 2000) } });
  await prisma.payout.updateMany({ where: { assignmentId, status: { in: ["PENDING", "SCHEDULED"] } }, data: { holdReason: "Dispute open" } });
  await prisma.adminTask.create({ data: { kind: "DISPUTE", title: `Dispute opened by ${party.toLowerCase()}`, entityType: "Dispute", entityId: d.id } });
  await notifyAdmins(prisma, { template: "dispute_opened", title: "New dispute", body: reason.slice(0, 200), link: `/admin/disputes` });
  await audit(prisma, actor, "dispute.opened", "Dispute", d.id, null, { assignmentId, reason });
  return d;
}

export async function resolveDispute(actor: Actor, disputeId: string, input: { resolution: string; refundCents?: number; payoutAdjustmentCents?: number }) {
  requireAdmin(actor);
  const d = await prisma.dispute.findUniqueOrThrow({ where: { id: disputeId }, include: { assignment: true } });
  if (d.status !== "OPEN") throw new DomainError("CONFLICT", "Already resolved.");
  await prisma.dispute.update({ where: { id: disputeId }, data: { status: "RESOLVED", resolution: input.resolution.slice(0, 2000), resolvedById: actor.userId, resolvedAt: new Date() } });
  if (input.refundCents && input.refundCents > 0) await refundAssignment(actor, d.assignmentId, input.refundCents, "dispute resolution");
  if (input.payoutAdjustmentCents) {
    await prisma.payout.create({
      data: {
        providerId: d.assignment.providerId,
        assignmentId: null,
        kind: "ADJUSTMENT",
        description: `Dispute resolution: ${input.resolution.slice(0, 120)}`,
        amountCents: input.payoutAdjustmentCents,
        status: "SCHEDULED",
        releaseAt: new Date(),
        createdById: actor.userId,
      },
    });
  }
  if (d.assignment.status === "IN_PROGRESS") await completeAssignment(d.assignmentId);
  await prisma.payout.updateMany({ where: { assignmentId: d.assignmentId, holdReason: "Dispute open" }, data: { holdReason: null } });
  await audit(prisma, actor, "dispute.resolved", "Dispute", disputeId, { status: "OPEN" }, { status: "RESOLVED", ...input });
}

// ---------------- ratings (double-blind) ----------------

export async function submitRating(actor: Actor, assignmentId: string, input: { stars: number; categories: Record<string, number>; comment?: string | null }) {
  const s = await getSettings();
  const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { shift: { include: { location: true } } } });
  let raterType: "CLINIC" | "PROVIDER";
  if (actor.role === "PROVIDER") {
    if (a.providerId !== requireProvider(actor)) throw new DomainError("NOT_FOUND", "Assignment not found");
    raterType = "PROVIDER";
  } else {
    if (a.shift.location.clinicOrgId !== requireClinic(actor)) throw new DomainError("NOT_FOUND", "Assignment not found");
    raterType = "CLINIC";
  }
  if (a.status !== "COMPLETED") throw new DomainError("CONFLICT", "You can rate after the shift is completed.");
  if (!a.completedAt || Date.now() - +a.completedAt > s["ratings.windowDays"] * DAY) throw new DomainError("CONFLICT", "The rating window has closed.");
  const stars = Math.round(input.stars);
  if (stars < 1 || stars > 5) throw new DomainError("VALIDATION", "Choose 1 to 5 stars.");
  await prisma.rating.create({
    data: { assignmentId, raterType, stars, categories: input.categories as Prisma.InputJsonValue, comment: input.comment?.slice(0, 1000) || null },
  });
  const both = await prisma.rating.findMany({ where: { assignmentId } });
  if (both.length === 2) await prisma.rating.updateMany({ where: { assignmentId }, data: { revealedAt: new Date() } });
  if (stars <= 2) await prisma.adminTask.create({ data: { kind: "LOW_RATING", title: `${stars}-star rating from ${raterType.toLowerCase()}`, entityType: "Assignment", entityId: assignmentId } });
  if (raterType === "CLINIC") await recomputeStats(a.providerId);
}

/** Reveal ratings once the 14-day window passes (called by the worker). */
export async function revealExpiredRatings(now = new Date()) {
  const s = await getSettings();
  const r = await prisma.rating.updateMany({ where: { revealedAt: null, submittedAt: { lte: new Date(+now - s["ratings.windowDays"] * DAY) } }, data: { revealedAt: now } });
  return r.count;
}
