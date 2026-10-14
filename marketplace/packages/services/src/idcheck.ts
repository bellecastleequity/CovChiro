import { canStartIdCheck, DomainError, idOutcome, type IdCheckRules, type IdStatus } from "@cm/core";
import type { SettingsMap } from "@cm/config";
import { prisma } from "@cm/db";
import { identityProvider } from "@cm/integrations";
import { audit, clock, getSettings, requireAdmin, requireProvider, SYSTEM, type Actor } from "./context";
import { absoluteUrl, notify, notifyAdmins } from "./notify";

/**
 * Photo ID check (core idcheck.ts) through Stripe Identity. Stripe holds the ID and selfie;
 * we keep the status, a plain note and whether the ID's name matches the legal name.
 * Results arrive by webhook (identity.verification_session.*), on return from Stripe, and by
 * idCheckSweep as a fallback. Bookings made while unverified carry Assignment.idDueAt; the sweep
 * reminds once and releases at the deadline (a check still with Stripe or an admin is never
 * released automatically: admins are alerted instead).
 */

const HOUR = 3_600_000;

export function idCheckRules(s: SettingsMap): IdCheckRules {
  return { enabled: s["idcheck.enabled"], acceptWithinHours: s["idcheck.acceptWithinHours"], deadlineHours: s["idcheck.deadlineHours"], maxAttempts: s["idcheck.maxAttempts"] };
}

/** What the provider's Verify your ID page shows. */
export async function idCheckState(actor: Actor) {
  const providerId = requireProvider(actor);
  const s = await getSettings();
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: providerId }, select: { idStatus: true, idAttempts: true, idNote: true, idVerifiedAt: true } });
  const due = await prisma.assignment.findMany({
    where: { providerId, status: "CONFIRMED", idDueAt: { not: null } },
    orderBy: { idDueAt: "asc" },
    select: { id: true, idDueAt: true, startsAt: true, shift: { select: { location: { select: { city: true, state: true, timeZone: true } } } } },
  });
  const status = p.idStatus as IdStatus;
  return {
    enabled: s["idcheck.enabled"],
    status,
    verifiedAt: p.idVerifiedAt,
    attemptsLeft: Math.max(0, s["idcheck.maxAttempts"] - p.idAttempts),
    canStart: s["idcheck.enabled"] && (status === "PENDING" || canStartIdCheck(status, p.idAttempts, s["idcheck.maxAttempts"])),
    /** Shown to the provider only when a try failed (plain reason, never the ID's details). */
    note: status === "FAILED" ? p.idNote : null,
    acceptWithinHours: s["idcheck.acceptWithinHours"],
    deadlineHours: s["idcheck.deadlineHours"],
    due,
  };
}

/** Opens (or resumes) a Stripe Identity session and returns its hosted page. */
export async function startIdCheck(actor: Actor): Promise<{ url: string }> {
  const providerId = requireProvider(actor);
  const s = await getSettings();
  if (!s["idcheck.enabled"]) throw new DomainError("FORBIDDEN", "ID checks aren't switched on.");
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: providerId }, include: { user: { select: { email: true } } } });
  const status = p.idStatus as IdStatus;
  // An unfinished try is resumed (no new try is counted).
  if (status === "PENDING" && p.idSessionId) {
    const open = await identityProvider().getSession(p.idSessionId).catch(() => null);
    if (open?.status === "requires_input" && !open.errorCode && open.url) return { url: open.url };
  }
  if (!canStartIdCheck(status, p.idAttempts, s["idcheck.maxAttempts"])) {
    throw new DomainError("CONFLICT", status === "VERIFIED" ? "Your ID is already verified." : status === "NEEDS_REVIEW" || status === "PROCESSING" ? "Your ID check is being reviewed. We'll let you know." : "You've used every try. Our team will be in touch.");
  }
  const session = await identityProvider().createSession({ providerId, email: p.user.email, legalName: p.legalName, returnUrl: absoluteUrl("/provider/verify-id?done=1") });
  await prisma.provider.update({ where: { id: providerId }, data: { idSessionId: session.id, idStatus: "PENDING", idAttempts: { increment: 1 }, idNote: null } });
  await audit(prisma, actor, "provider.id_check_started", "Provider", providerId, null, { attempt: p.idAttempts + 1 });
  return { url: session.url };
}

/** Reads the session from Stripe and records the outcome. Safe to call any number of times. */
export async function refreshIdCheck(providerId: string, sessionId?: string) {
  const s = await getSettings();
  const p = await prisma.provider.findUnique({ where: { id: providerId } });
  if (!p?.idSessionId || (sessionId && sessionId !== p.idSessionId)) return null;
  if (p.idStatus === "VERIFIED" || (p.idStatus === "NEEDS_REVIEW" && p.idReviewedById)) return p.idStatus as IdStatus;
  const v = await identityProvider().getSession(p.idSessionId);
  const out = idOutcome({ sessionStatus: v.status, errorCode: v.errorCode, idFirstName: v.firstName, idLastName: v.lastName, legalName: p.legalName, attempts: p.idAttempts, maxAttempts: s["idcheck.maxAttempts"] });
  if (out.status === p.idStatus && out.note === p.idNote) return out.status;
  const now = clock.now();
  const claimed = await prisma.provider.updateMany({ where: { id: providerId, idStatus: p.idStatus, idSessionId: p.idSessionId }, data: { idStatus: out.status, idNote: out.note, ...(out.status === "VERIFIED" ? { idVerifiedAt: now } : {}) } });
  if (!claimed.count) return out.status;
  await audit(prisma, SYSTEM, "provider.id_check", "Provider", providerId, { idStatus: p.idStatus }, { idStatus: out.status });
  if (out.status === "VERIFIED") {
    await prisma.assignment.updateMany({ where: { providerId, idDueAt: { not: null } }, data: { idDueAt: null } });
    await notify(prisma, p.userId, { template: "id_verified", title: "Your ID is verified", body: "Thanks! You won't need to do this again. You can now take shifts at short notice too.", link: "/provider", email: false });
  } else if (out.status === "FAILED") {
    await notify(prisma, p.userId, { template: "id_check_failed", title: "Your ID check didn't go through", body: `${out.note} You can try again from Verify your ID.`, link: "/provider/verify-id", ctaLabel: "Try again" });
  } else if (out.status === "NEEDS_REVIEW") {
    await prisma.adminTask.create({ data: { kind: "ID_CHECK", title: `${p.displayName}: ID check needs a person`, entityType: "Provider", entityId: providerId } });
    await notifyAdmins(prisma, { template: "id_check_review", title: `ID check to review: ${p.displayName}`, body: out.note ?? "An ID check needs review.", link: `/admin/providers/${providerId}#id-check`, email: true });
    await notify(prisma, p.userId, { template: "id_check_review", title: "We're reviewing your ID check", body: "Our team is taking a look and will be in touch shortly. Nothing else to do for now.", link: "/provider/verify-id", email: false });
  }
  return out.status;
}

/** Stripe webhook: identity.verification_session.* */
export async function handleIdentityEvent(obj: { id: string; metadata?: Record<string, string> | null; client_reference_id?: string | null }) {
  const providerId = obj.metadata?.providerId ?? obj.client_reference_id ?? (await prisma.provider.findFirst({ where: { idSessionId: obj.id }, select: { id: true } }))?.id;
  if (providerId) await refreshIdCheck(providerId, obj.id);
}

/** Admin decisions on the provider page: verify by hand, allow more tries, or ask for a new check. */
export async function adminIdDecision(actor: Actor, providerId: string, decision: "verify" | "allow_retry" | "reset", note: string) {
  requireAdmin(actor);
  const clean = note.trim();
  if (decision === "verify" && clean.length < 3) throw new DomainError("VALIDATION", "Add a short note on how you confirmed it.");
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: providerId } });
  const now = clock.now();
  const data =
    decision === "verify"
      ? { idStatus: "VERIFIED", idVerifiedAt: now, idReviewedById: actor.userId, idNote: `Verified by an admin: ${clean}` }
      : decision === "allow_retry"
        ? { idStatus: "NONE", idAttempts: 0, idReviewedById: actor.userId, idNote: clean ? `More tries allowed: ${clean}` : "More tries allowed" }
        : { idStatus: "NONE", idAttempts: 0, idVerifiedAt: null, idSessionId: null, idReviewedById: actor.userId, idNote: clean ? `Asked to verify again: ${clean}` : "Asked to verify again" };
  await prisma.provider.update({ where: { id: providerId }, data });
  await prisma.adminTask.updateMany({ where: { kind: "ID_CHECK", entityId: providerId, resolvedAt: null }, data: { resolvedAt: now, resolvedById: actor.userId } });
  await audit(prisma, actor, `provider.id_${decision}`, "Provider", providerId, { idStatus: p.idStatus }, { idStatus: data.idStatus, note: clean });
  if (decision === "verify") {
    await prisma.assignment.updateMany({ where: { providerId, idDueAt: { not: null } }, data: { idDueAt: null } });
    await notify(prisma, p.userId, { template: "id_verified", title: "Your ID is verified", body: "Thanks! You won't need to do this again.", link: "/provider", email: false });
  } else {
    await notify(prisma, p.userId, { template: "id_check_again", title: "Please verify your ID", body: "It takes about 2 minutes on your phone: a photo of your driver's license and a selfie, in Stripe's secure screen.", link: "/provider/verify-id", ctaLabel: "Verify your ID" });
  }
}

/**
 * Every 5 minutes: catch up on sessions Stripe hasn't told us about, remind once before a
 * booking's ID deadline, and at the deadline release the booking (or alert admins when the
 * check is waiting on Stripe or a person).
 */
export async function idCheckSweep(now: Date = clock.now()) {
  const out = { refreshed: 0, reminded: 0, released: 0, escalated: 0 };
  const stale = await prisma.provider.findMany({ where: { idStatus: { in: ["PENDING", "PROCESSING"] }, idSessionId: { not: null } }, select: { id: true }, take: 50 });
  for (const p of stale) {
    await refreshIdCheck(p.id).catch((e) => console.error("id check refresh failed", e));
    out.refreshed++;
  }
  const remind = await prisma.assignment.findMany({
    where: { status: "CONFIRMED", idDueAt: { gt: now, lte: new Date(+now + 24 * HOUR) }, idRemindedAt: null, confirmedAt: { lte: new Date(+now - 6 * HOUR) } },
    include: { provider: true, shift: { include: { location: true } } },
  });
  for (const a of remind) {
    const claimed = await prisma.assignment.updateMany({ where: { id: a.id, idRemindedAt: null }, data: { idRemindedAt: now } });
    if (!claimed.count || a.provider.idStatus === "VERIFIED") continue;
    const by = a.idDueAt!.toLocaleString("en-US", { timeZone: a.shift.location.timeZone, weekday: "short", hour: "numeric", minute: "2-digit" });
    await notify(prisma, a.provider.userId, {
      template: "id_check_reminder",
      title: `Verify your ID by ${by} to keep your booking`,
      body: `Your shift in ${a.shift.location.city} needs a quick ID check first (about 2 minutes on your phone). If it isn't done by ${by}, the shift goes to another provider.`,
      link: "/provider/verify-id",
      ctaLabel: "Verify your ID",
      sms: true,
    });
    out.reminded++;
  }
  const due = await prisma.assignment.findMany({
    where: { status: "CONFIRMED", idDueAt: { lte: now }, startsAt: { gt: now } },
    include: { provider: true },
  });
  for (const a of due) {
    const status = a.provider.idStatus as IdStatus;
    if (status === "VERIFIED") {
      await prisma.assignment.update({ where: { id: a.id }, data: { idDueAt: null } });
      continue;
    }
    if (status === "PROCESSING" || status === "NEEDS_REVIEW") {
      // Not the provider's doing: a person decides before the shift.
      const claimed = await prisma.assignment.updateMany({ where: { id: a.id, idDueAt: { not: null } }, data: { idDueAt: null, flags: { push: "ID_REVIEW_AT_DEADLINE" } } });
      if (!claimed.count) continue;
      await prisma.adminTask.create({ data: { kind: "ID_CHECK", title: `${a.provider.displayName}: ID check unresolved at a booking's deadline`, entityType: "Assignment", entityId: a.id } });
      await notifyAdmins(prisma, { template: "id_check_deadline", title: `Decide before the shift: ${a.provider.displayName}'s ID check`, body: "Their ID check is still being reviewed and a booking's deadline has passed. Verify them by hand or remove them from the shift.", link: `/admin/providers/${a.providerId}#id-check`, email: true, sms: true });
      out.escalated++;
      continue;
    }
    const claimed = await prisma.assignment.updateMany({ where: { id: a.id, idDueAt: { not: null } }, data: { idDueAt: null, flags: { push: "ID_CHECK_MISSED" } } });
    if (!claimed.count) continue;
    const { cancelAssignment } = await import("./shifts");
    await cancelAssignment(SYSTEM, a.id, "ID not verified by the deadline", { by: "PROVIDER", unconfirmed: true, idCheck: true });
    out.released++;
  }
  return out;
}
