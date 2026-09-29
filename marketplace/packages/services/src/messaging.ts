import { DomainError, PHI_NOTICE, REDACTION_NOTICE, screenMessage } from "@cm/core";
import { prisma } from "@cm/db";
import { requireAdmin, type Actor } from "./context";
import { notify, notifyClinic } from "./notify";

/**
 * Clinic ↔ provider threads (SPEC §10). Before a confirmed shift together,
 * contact details are redacted; after, they're allowed but repeated sharing
 * is flagged (circumvention signal). Likely PHI is bounced back to the
 * sender to edit (INV-4) — we keep a counter, never the content.
 */

async function threadFor(actor: Actor, threadId: string) {
  const t = await prisma.messageThread.findUnique({ where: { id: threadId }, include: { clinicOrg: true, provider: true } });
  if (!t) throw new DomainError("NOT_FOUND", "Conversation not found");
  if (actor.role === "PROVIDER" && t.providerId === actor.providerId) return { t, side: "PROVIDER" as const };
  if ((actor.role === "CLINIC_OWNER" || actor.role === "CLINIC_STAFF") && t.clinicOrgId === actor.clinicOrgId) return { t, side: "CLINIC" as const };
  if (actor.role === "PLATFORM_ADMIN") return { t, side: "ADMIN" as const };
  throw new DomainError("NOT_FOUND", "Conversation not found");
}

async function pairConfirmed(clinicOrgId: string, providerId: string) {
  return (await prisma.assignment.count({ where: { providerId, status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] }, shift: { location: { clinicOrgId } } } })) > 0;
}

/** A clinic may message applicants; a provider may message a clinic whose shift they applied to. */
export async function openThread(actor: Actor, input: { shiftId: string; providerId?: string }) {
  const shift = await prisma.shift.findUniqueOrThrow({ where: { id: input.shiftId }, include: { location: true } });
  let providerId: string;
  if (actor.role === "PROVIDER") providerId = actor.providerId!;
  else if (actor.clinicOrgId === shift.location.clinicOrgId && input.providerId) providerId = input.providerId;
  else throw new DomainError("FORBIDDEN", "Not allowed");
  const related = (await prisma.application.count({ where: { shiftId: shift.id, providerId } })) + (await prisma.offer.count({ where: { shiftId: shift.id, providerId } }));
  if (!related && !(await pairConfirmed(shift.location.clinicOrgId, providerId))) throw new DomainError("FORBIDDEN", "You can message once there's an application or invitation.");
  return prisma.messageThread.upsert({
    where: { clinicOrgId_providerId: { clinicOrgId: shift.location.clinicOrgId, providerId } },
    create: { clinicOrgId: shift.location.clinicOrgId, providerId, shiftId: shift.id },
    update: {},
  });
}

export async function listThreads(actor: Actor) {
  const where =
    actor.role === "PROVIDER" ? { providerId: actor.providerId! } : actor.role === "PLATFORM_ADMIN" ? {} : { clinicOrgId: actor.clinicOrgId! };
  const threads = await prisma.messageThread.findMany({
    where,
    include: { clinicOrg: { select: { displayName: true } }, provider: { select: { displayName: true, homeCity: true, homeState: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { lastMessageAt: "desc" },
    take: 100,
  });
  const out = [];
  for (const t of threads) {
    const unread = await prisma.message.count({ where: { threadId: t.id, readAt: null, senderType: actor.role === "PROVIDER" ? "CLINIC" : "PROVIDER" } });
    out.push({ id: t.id, clinicName: t.clinicOrg.displayName, providerName: t.provider.displayName, providerCity: t.provider.homeCity, providerState: t.provider.homeState, last: t.messages[0] ?? null, unread, lastMessageAt: t.lastMessageAt });
  }
  return out;
}

export async function threadMessages(actor: Actor, threadId: string) {
  const { t, side } = await threadFor(actor, threadId);
  if (side !== "ADMIN") {
    await prisma.message.updateMany({ where: { threadId, readAt: null, senderType: side === "PROVIDER" ? "CLINIC" : "PROVIDER" }, data: { readAt: new Date() } });
  }
  const messages = await prisma.message.findMany({ where: { threadId }, orderBy: { createdAt: "asc" }, take: 500 });
  return { thread: { id: t.id, clinicName: t.clinicOrg.displayName, providerName: t.provider.displayName, confirmed: await pairConfirmed(t.clinicOrgId, t.providerId) }, messages, side };
}

export async function sendMessage(actor: Actor, threadId: string, body: string, opts: { acknowledgePhiWarning?: boolean } = {}) {
  const { t, side } = await threadFor(actor, threadId);
  if (side === "ADMIN") throw new DomainError("FORBIDDEN", "Admins can't post in user threads.");
  const text = body.trim();
  if (!text) throw new DomainError("VALIDATION", "Write a message.");
  if (text.length > 4000) throw new DomainError("VALIDATION", "Keep messages under 4,000 characters.");
  const confirmed = await pairConfirmed(t.clinicOrgId, t.providerId);
  const prior = await prisma.message.count({ where: { threadId, containedContact: true } });
  const r = screenMessage(text, confirmed, prior);
  if (r.phiWarning && !opts.acknowledgePhiWarning) {
    await prisma.auditLog.create({ data: { actorUserId: actor.userId, action: "message.phi_warning", entityType: "MessageThread", entityId: threadId } });
    throw new DomainError("VALIDATION", `${PHI_NOTICE} Please edit your message before sending.`, { phiWarning: true });
  }
  const containedContact = r.redacted || r.flagged || (confirmed && r.body !== text) || /\[contact removed\]/.test(r.body) || false;
  const msg = await prisma.message.create({
    data: { threadId, senderUserId: actor.userId!, senderType: side, body: r.body, redacted: r.redacted, flagged: r.flagged, containedContact: containedContact || r.flagged || r.redacted },
  });
  await prisma.messageThread.update({ where: { id: threadId }, data: { lastMessageAt: new Date() } });
  if (r.flagged) await prisma.adminTask.create({ data: { kind: "FLAGGED_MESSAGES", title: "Repeated contact sharing in a thread", entityType: "MessageThread", entityId: threadId } });
  const link = side === "PROVIDER" ? `/clinic/messages/${threadId}` : `/provider/messages/${threadId}`;
  const n = { template: "new_message", title: `New message from ${side === "PROVIDER" ? t.provider.displayName : t.clinicOrg.displayName}`, body: r.body.slice(0, 140), link, ctaLabel: "Reply" };
  if (side === "PROVIDER") await notifyClinic(prisma, t.clinicOrgId, { ...n, email: false });
  else await notify(prisma, t.provider.userId, { ...n, email: false });
  return { message: msg, notice: r.redacted ? REDACTION_NOTICE : null };
}

export async function flaggedMessages(actor: Actor) {
  requireAdmin(actor);
  return prisma.message.findMany({ where: { flagged: true }, include: { thread: { include: { clinicOrg: { select: { displayName: true } }, provider: { select: { displayName: true } } } } }, orderBy: { createdAt: "desc" }, take: 100 });
}
