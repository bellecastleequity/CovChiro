import { DomainError, looksLikePhi } from "@cm/core";
import { prisma } from "@cm/db";
import { checkRateLimit } from "./auth";
import { audit, clock, getSettings, requireAdmin, type Actor } from "./context";
import { notify, notifyAdmins } from "./notify";

/**
 * Help center → Contact support. A signed-in clinic or provider opens a request; it becomes a
 * thread between them and our team (admin inbox /admin/support). Status: OPEN = waiting on us,
 * ANSWERED = waiting on them, CLOSED. Patient information is refused like everywhere else.
 */

const BODY_MAX = 4000;

function audienceOf(actor: Actor): "CLINIC" | "PROVIDER" {
  if (actor.role === "PROVIDER" && actor.providerId) return "PROVIDER";
  if ((actor.role === "CLINIC_OWNER" || actor.role === "CLINIC_STAFF") && actor.clinicOrgId) return "CLINIC";
  throw new DomainError("FORBIDDEN", "Sign in as a clinic or provider to contact support.");
}

function cleanBody(raw: string) {
  const body = raw.trim();
  if (body.length < 5) throw new DomainError("VALIDATION", "Tell us a little more so we can help.");
  if (body.length > BODY_MAX) throw new DomainError("VALIDATION", `Please keep it under ${BODY_MAX} characters.`);
  if (looksLikePhi(body)) throw new DomainError("VALIDATION", "Please remove any patient information (names, dates of birth, record numbers). We never need it to help you.");
  return body;
}

const areaOf = (audience: string) => (audience === "PROVIDER" ? "/provider" : "/clinic");

export async function createRequest(actor: Actor, input: { topic: string; subject: string; body: string; shiftId?: string | null }) {
  const audience = audienceOf(actor);
  const s = await getSettings();
  const topic = s["support.topics"].includes(input.topic) ? input.topic : "Other";
  const subject = input.subject.trim().slice(0, 140);
  if (subject.length < 3) throw new DomainError("VALIDATION", "Add a short subject.");
  if (looksLikePhi(subject)) throw new DomainError("VALIDATION", "Please remove any patient information from the subject.");
  const body = cleanBody(input.body);
  await checkRateLimit(`support:${actor.userId}`, 10, 3600);
  // Only link a shift this person is actually part of.
  let shiftId: string | null = null;
  if (input.shiftId) {
    const sh = await prisma.shift.findFirst({
      where: { id: input.shiftId, ...(audience === "CLINIC" ? { location: { clinicOrgId: actor.clinicOrgId! } } : { assignments: { some: { providerId: actor.providerId! } } }) },
      select: { id: true },
    });
    shiftId = sh?.id ?? null;
  }
  const now = clock.now();
  const req = await prisma.supportRequest.create({
    data: {
      userId: actor.userId!, audience, clinicOrgId: actor.clinicOrgId ?? null, providerId: actor.providerId ?? null, topic, subject, shiftId, lastMessageAt: now,
      messages: { create: { authorUserId: actor.userId, body, createdAt: now } },
    },
  });
  await audit(prisma, actor, "support.created", "SupportRequest", req.id, null, { topic, subject });
  const who = await prisma.user.findUnique({ where: { id: actor.userId! }, select: { name: true, email: true } });
  await notifyAdmins(prisma, {
    template: "support_new",
    title: `Support: ${subject}`,
    body: `${who?.name ?? "Someone"} (${audience.toLowerCase()}, ${who?.email ?? ""}) · ${topic}\n\n${body.slice(0, 600)}`,
    link: `/admin/support/${req.id}`,
    ctaLabel: "Open request",
  }).catch(() => undefined);
  return req;
}

async function ownRequest(actor: Actor, id: string) {
  const r = await prisma.supportRequest.findUnique({ where: { id } });
  if (!r || r.userId !== actor.userId) throw new DomainError("NOT_FOUND", "Request not found");
  return r;
}

export async function reply(actor: Actor, id: string, raw: string) {
  const r = await ownRequest(actor, id);
  const body = cleanBody(raw);
  await checkRateLimit(`support-reply:${actor.userId}`, 30, 3600);
  const now = clock.now();
  await prisma.$transaction([
    prisma.supportMessage.create({ data: { requestId: id, authorUserId: actor.userId, body, createdAt: now } }),
    prisma.supportRequest.update({ where: { id }, data: { status: "OPEN", lastMessageAt: now, closedAt: null } }),
  ]);
  await notifyAdmins(prisma, { template: "support_reply", title: `Support reply: ${r.subject}`, body: body.slice(0, 600), link: `/admin/support/${id}`, ctaLabel: "Open request" }).catch(() => undefined);
}

export async function closeOwn(actor: Actor, id: string) {
  await ownRequest(actor, id);
  await prisma.supportRequest.update({ where: { id }, data: { status: "CLOSED", closedAt: clock.now() } });
}

export async function myRequests(actor: Actor) {
  return prisma.supportRequest.findMany({ where: { userId: actor.userId! }, orderBy: { lastMessageAt: "desc" }, take: 50, include: { _count: { select: { messages: true } } } });
}

export async function myRequest(actor: Actor, id: string) {
  await ownRequest(actor, id);
  return prisma.supportRequest.findUniqueOrThrow({ where: { id }, include: { messages: { orderBy: { createdAt: "asc" } } } });
}

/** Requests waiting on the user (answered by us) — for the Help badge. */
export async function answeredCount(userId: string) {
  return prisma.supportRequest.count({ where: { userId, status: "ANSWERED" } });
}

// ---------------- admin ----------------

export async function adminList(actor: Actor, status?: string) {
  requireAdmin(actor);
  const [rows, counts] = await Promise.all([
    prisma.supportRequest.findMany({
      where: status ? { status } : {},
      orderBy: { lastMessageAt: "desc" },
      take: 200,
      include: { user: { select: { name: true, email: true } }, _count: { select: { messages: true } } },
    }),
    prisma.supportRequest.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  return { rows, counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Record<string, number> };
}

export async function adminGet(actor: Actor, id: string) {
  requireAdmin(actor);
  const r = await prisma.supportRequest.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true, email: true, phone: true } }, messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!r) throw new DomainError("NOT_FOUND", "Request not found");
  const staff = await prisma.user.findMany({ where: { id: { in: r.messages.map((m) => m.authorUserId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  return { ...r, authors: Object.fromEntries(staff.map((u) => [u.id, u.name])) as Record<string, string> };
}

export async function adminReply(actor: Actor, id: string, raw: string, opts: { close?: boolean } = {}) {
  requireAdmin(actor);
  const r = await prisma.supportRequest.findUnique({ where: { id } });
  if (!r) throw new DomainError("NOT_FOUND", "Request not found");
  const body = raw.trim();
  if (body.length < 2) throw new DomainError("VALIDATION", "Write a reply.");
  if (body.length > BODY_MAX) throw new DomainError("VALIDATION", `Please keep it under ${BODY_MAX} characters.`);
  const now = clock.now();
  await prisma.$transaction([
    prisma.supportMessage.create({ data: { requestId: id, authorUserId: actor.userId, fromStaff: true, body, createdAt: now } }),
    prisma.supportRequest.update({ where: { id }, data: { status: opts.close ? "CLOSED" : "ANSWERED", lastMessageAt: now, closedAt: opts.close ? now : null } }),
  ]);
  await audit(prisma, actor, "support.replied", "SupportRequest", id, null, { close: !!opts.close });
  await notify(prisma, r.userId, {
    template: "support_answer",
    title: `We replied: ${r.subject}`,
    body: body.slice(0, 1200),
    link: `${areaOf(r.audience)}/help/requests/${id}`,
    ctaLabel: "View and reply",
  }).catch(() => undefined);
}

export async function adminSetStatus(actor: Actor, id: string, status: "OPEN" | "ANSWERED" | "CLOSED") {
  requireAdmin(actor);
  await prisma.supportRequest.update({ where: { id }, data: { status, closedAt: status === "CLOSED" ? clock.now() : null } });
  await audit(prisma, actor, "support.status", "SupportRequest", id, null, { status });
}

export async function openCount() {
  return prisma.supportRequest.count({ where: { status: "OPEN" } });
}
