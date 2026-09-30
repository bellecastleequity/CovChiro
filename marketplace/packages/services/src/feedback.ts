import { DomainError, looksLikePhi, scanContactInfo } from "@cm/core";
import { prisma } from "@cm/db";
import { audit, clock, requireClinic, requireProvider, type Actor } from "./context";
import { notify } from "./notify";

/**
 * Private post-shift feedback: clinic → provider, for the provider's own
 * growth. Only the provider sees it. It is never shown on profiles or to
 * other clinics and never feeds ratings, badges or matching.
 */

const WINDOW_DAYS = 30;

export async function submitFeedback(actor: Actor, assignmentId: string, raw: string) {
  const orgId = requireClinic(actor);
  const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { provider: true, shift: { include: { location: { include: { clinicOrg: true } } } } } });
  if (a.shift.location.clinicOrgId !== orgId) throw new DomainError("NOT_FOUND", "Shift not found");
  if (a.status !== "COMPLETED") throw new DomainError("CONFLICT", "You can leave feedback once the shift is completed.");
  if (a.completedAt && +clock.now() - +a.completedAt > WINDOW_DAYS * 86_400_000) throw new DomainError("CONFLICT", `Feedback is open for ${WINDOW_DAYS} days after the shift.`);
  const text = raw.trim();
  if (text.length < 5) throw new DomainError("VALIDATION", "Write a sentence or two.");
  if (text.length > 2000) throw new DomainError("VALIDATION", "Please keep it under 2,000 characters.");
  if (looksLikePhi(text)) throw new DomainError("VALIDATION", "Please remove patient information. Do not include patient information.");
  const body = scanContactInfo(text).redacted;
  const existing = await prisma.providerFeedback.findUnique({ where: { assignmentId } });
  await prisma.providerFeedback.upsert({
    where: { assignmentId },
    create: { assignmentId, providerId: a.providerId, clinicOrgId: orgId, authorUserId: actor.userId!, body },
    update: { body, readAt: null },
  });
  await audit(prisma, actor, existing ? "feedback.updated" : "feedback.created", "Assignment", assignmentId);
  if (!existing) {
    await notify(prisma, a.provider.userId, {
      template: "private_feedback",
      title: `Private feedback from ${a.shift.location.clinicOrg.displayName}`,
      body: "A clinic you covered left you private feedback. Only you can see it — it doesn't affect your ratings or profile.",
      link: "/provider/feedback",
      ctaLabel: "Read feedback",
    });
  }
  return "Sent privately to your provider. Thank you!";
}

/** The provider's own feedback inbox (marks everything read). */
export async function myFeedback(actor: Actor) {
  const providerId = requireProvider(actor);
  const rows = await prisma.providerFeedback.findMany({ where: { providerId }, orderBy: { createdAt: "desc" } });
  const [orgs, assignments] = await Promise.all([
    prisma.clinicOrg.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.clinicOrgId))] } }, select: { id: true, displayName: true } }),
    prisma.assignment.findMany({ where: { id: { in: rows.map((r) => r.assignmentId) } }, select: { id: true, startsAt: true, shift: { select: { location: { select: { timeZone: true } } } } } }),
  ]);
  const orgBy = new Map(orgs.map((o) => [o.id, o.displayName]));
  const aBy = new Map(assignments.map((a) => [a.id, a]));
  const unread = rows.filter((r) => !r.readAt).map((r) => r.id);
  if (unread.length) await prisma.providerFeedback.updateMany({ where: { id: { in: unread } }, data: { readAt: clock.now() } });
  return rows.map((r) => ({ id: r.id, clinic: orgBy.get(r.clinicOrgId) ?? "A clinic", body: r.body, createdAt: r.createdAt, shiftDate: aBy.get(r.assignmentId)?.startsAt ?? null, timeZone: aBy.get(r.assignmentId)?.shift.location.timeZone ?? "America/New_York", isNew: !r.readAt }));
}

export async function unreadFeedbackCount(providerId: string) {
  return prisma.providerFeedback.count({ where: { providerId, readAt: null } });
}
