import { brand } from "@cm/config";
import { DomainError, PHI_NOTICE, screenMessage } from "@cm/core";
import { prisma } from "@cm/db";
import { moderationProvider } from "@cm/integrations";
import { audit, requireAdmin, type Actor } from "./context";
import { notify, notifyClinic } from "./notify";

/**
 * Clinic ↔ provider threads (SPEC §10). Non-circumvention: messages carrying
 * contact details or arranging off-platform work are never delivered (rules
 * always; an optional AI check after) and are kept for admin review. Likely
 * PHI is bounced back to the sender to edit (INV-4) — we keep a counter,
 * never the content.
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

export const BLOCKED_NOTICE =
  "This message wasn't sent. Messages can't include phone numbers, emails, links or social handles, or arrange work or payment outside the platform. Once a shift is confirmed, the address, front desk number and arrival notes are on the booking. Want to keep working together? Clinics can set up a standing booking, or use “Request to hire” to hire a provider directly.";

export async function sendMessage(actor: Actor, threadId: string, body: string, opts: { acknowledgePhiWarning?: boolean } = {}) {
  const { t, side } = await threadFor(actor, threadId);
  if (side === "ADMIN") throw new DomainError("FORBIDDEN", "Admins can't post in user threads.");
  const text = body.trim();
  if (!text) throw new DomainError("VALIDATION", "Write a message.");
  if (text.length > 4000) throw new DomainError("VALIDATION", "Keep messages under 4,000 characters.");
  const r = screenMessage(text);
  if (r.phiWarning && !opts.acknowledgePhiWarning) {
    await prisma.auditLog.create({ data: { actorUserId: actor.userId, action: "message.phi_warning", entityType: "MessageThread", entityId: threadId } });
    throw new DomainError("VALIDATION", `${PHI_NOTICE} Please edit your message before sending.`, { phiWarning: true });
  }
  if (r.blocked) await blockMessage(actor, threadId, side, text, r.reasons, "RULES");
  // Rules passed: an optional AI second opinion for hints the rules can't see.
  const ai = await moderationProvider().review(text, { senderType: side, brand: brand().name });
  if (ai.decision === "block") await blockMessage(actor, threadId, side, text, ["ai"], "AI", ai.reason);
  const flagged = ai.decision === "review";
  const msg = await prisma.message.create({
    data: { threadId, senderUserId: actor.userId!, senderType: side, body: text, flagged },
  });
  await prisma.messageThread.update({ where: { id: threadId }, data: { lastMessageAt: new Date() } });
  if (flagged) await flagThread(threadId, `Possible circumvention (AI): ${ai.reason || "needs a look"}`);
  const link = side === "PROVIDER" ? `/clinic/messages/${threadId}` : `/provider/messages/${threadId}`;
  const n = { template: "new_message", title: `New message from ${side === "PROVIDER" ? t.provider.displayName : t.clinicOrg.displayName}`, body: text.slice(0, 140), link, ctaLabel: "Reply" };
  if (side === "PROVIDER") await notifyClinic(prisma, t.clinicOrgId, { ...n, email: false });
  else await notify(prisma, t.provider.userId, { ...n, email: false });
  return { message: msg, notice: null };
}

/** Records the attempt for admins, then refuses the message. */
async function blockMessage(actor: Actor, threadId: string, side: "CLINIC" | "PROVIDER", text: string, reasons: string[], source: "RULES" | "AI", aiReason?: string): Promise<never> {
  await prisma.blockedMessage.create({ data: { threadId, senderUserId: actor.userId!, senderType: side, body: text.slice(0, 2000), reasons, source, aiReason: aiReason ?? null } });
  await audit(prisma, actor, "message.blocked", "MessageThread", threadId, null, { reasons, source });
  // Repeated attempts are a pattern worth a human look.
  const recent = await prisma.blockedMessage.count({ where: { senderUserId: actor.userId!, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } });
  if (recent >= 2 || reasons.includes("off-platform") || source === "AI") {
    await flagThread(threadId, recent >= 2 ? `Repeated blocked messages (${recent} in 30 days)` : `Blocked message: ${reasons.join(", ")}`);
  }
  throw new DomainError("VALIDATION", BLOCKED_NOTICE, { blocked: true, reasons });
}

/** One open admin task per thread. */
async function flagThread(threadId: string, title: string) {
  const open = await prisma.adminTask.findFirst({ where: { kind: "FLAGGED_MESSAGES", entityId: threadId, resolvedAt: null } });
  if (open) await prisma.adminTask.update({ where: { id: open.id }, data: { title } });
  else await prisma.adminTask.create({ data: { kind: "FLAGGED_MESSAGES", title, entityType: "MessageThread", entityId: threadId } });
}

export async function blockedMessages(actor: Actor) {
  requireAdmin(actor);
  const rows = await prisma.blockedMessage.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  const [threads, users] = await Promise.all([
    prisma.messageThread.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.threadId))] } }, select: { id: true, clinicOrg: { select: { displayName: true } }, provider: { select: { displayName: true } } } }),
    prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.senderUserId))] } }, select: { id: true, name: true, email: true } }),
  ]);
  const tBy = new Map(threads.map((t) => [t.id, t]));
  const uBy = new Map(users.map((u) => [u.id, u]));
  return rows.map((r) => ({ ...r, thread: tBy.get(r.threadId) ?? null, sender: uBy.get(r.senderUserId) ?? null }));
}

export async function flaggedMessages(actor: Actor) {
  requireAdmin(actor);
  return prisma.message.findMany({ where: { flagged: true }, include: { thread: { include: { clinicOrg: { select: { displayName: true } }, provider: { select: { displayName: true } } } } }, orderBy: { createdAt: "desc" }, take: 100 });
}
