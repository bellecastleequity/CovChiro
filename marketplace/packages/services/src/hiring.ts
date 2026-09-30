import { brand } from "@cm/config";
import { DomainError } from "@cm/core";
import { prisma } from "@cm/db";
import { longDate, sha256 } from "./agreements";
import { audit, clock, getSettings, requireAdmin, requireClinic, SYSTEM, type Actor } from "./context";
import { notify, notifyAdmins, notifyClinic } from "./notify";
import { chargePlacementFee } from "./payments";

/**
 * Direct hire ("Request to hire"). The only allowed way for a clinic to hire
 * a provider it met on the platform outside shift coverage: the clinic asks,
 * our team calls both sides, quotes a placement fee with written terms, the
 * clinic accepts and pays through a link, and the provider is released to
 * the clinic — and no longer offered that clinic's shifts. Anything else is
 * circumvention under the platform agreements.
 */

export const POSITION_TYPES = { FULL_TIME: "Full-time", PART_TIME: "Part-time", CONTRACT: "Independent contract", OTHER: "Other" } as const;
const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0 })}`;

export async function requestHire(actor: Actor, input: { providerId: string; positionType: string; message?: string | null; callbackPhone?: string | null; callbackTimes?: string | null }) {
  const orgId = requireClinic(actor);
  if (!(input.positionType in POSITION_TYPES)) throw new DomainError("VALIDATION", "Pick the kind of position.");
  const provider = await prisma.provider.findUnique({ where: { id: input.providerId } });
  if (!provider) throw new DomainError("NOT_FOUND", "Provider not found");
  const met =
    (await prisma.assignment.count({ where: { providerId: provider.id, shift: { location: { clinicOrgId: orgId } } } })) +
    (await prisma.application.count({ where: { providerId: provider.id, shift: { location: { clinicOrgId: orgId } } } }));
  if (!met) throw new DomainError("FORBIDDEN", "You can request to hire providers who have applied to or worked your shifts.");
  const open = await prisma.hireRequest.findFirst({ where: { clinicOrgId: orgId, providerId: provider.id, status: { in: ["NEW", "IN_TALKS", "QUOTED"] } } });
  if (open) throw new DomainError("CONFLICT", "You already have a hire request open for this provider. We'll be in touch.");
  const org = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: orgId } });
  const r = await prisma.hireRequest.create({
    data: {
      clinicOrgId: orgId,
      providerId: provider.id,
      requestedById: actor.userId!,
      positionType: input.positionType,
      message: input.message?.trim().slice(0, 2000) || null,
      callbackPhone: input.callbackPhone?.trim().slice(0, 30) || org.phone,
      callbackTimes: input.callbackTimes?.trim().slice(0, 200) || null,
    },
  });
  await notifyAdmins(prisma, {
    template: "hire_request",
    title: `Hire request: ${org.displayName} → ${provider.displayName}`,
    body: `${POSITION_TYPES[input.positionType as keyof typeof POSITION_TYPES]} position. Call back: ${r.callbackPhone ?? "no phone given"}${r.callbackTimes ? ` (${r.callbackTimes})` : ""}.`,
    link: `/admin/hire/${r.id}`,
    email: true,
  });
  await audit(prisma, actor, "hire.requested", "HireRequest", r.id, null, { providerId: provider.id });
  return r;
}

export async function hireRequests(actor: Actor) {
  requireAdmin(actor);
  const rows = await prisma.hireRequest.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return withParties(rows);
}

export async function clinicHireRequests(actor: Actor) {
  const orgId = requireClinic(actor);
  return withParties(await prisma.hireRequest.findMany({ where: { clinicOrgId: orgId }, orderBy: { createdAt: "desc" } }));
}

async function withParties<T extends { clinicOrgId: string; providerId: string; requestedById: string }>(rows: T[]) {
  const [orgs, providers, users] = await Promise.all([
    prisma.clinicOrg.findMany({ where: { id: { in: rows.map((r) => r.clinicOrgId) } }, select: { id: true, displayName: true, legalName: true, phone: true, billingEmail: true } }),
    prisma.provider.findMany({ where: { id: { in: rows.map((r) => r.providerId) } }, select: { id: true, displayName: true, legalName: true, homeCity: true, homeState: true, user: { select: { email: true, phone: true } } } }),
    prisma.user.findMany({ where: { id: { in: rows.map((r) => r.requestedById) } }, select: { id: true, name: true, email: true } }),
  ]);
  const o = new Map(orgs.map((x) => [x.id, x]));
  const p = new Map(providers.map((x) => [x.id, x]));
  const u = new Map(users.map((x) => [x.id, x]));
  return rows.map((r) => ({ ...r, clinic: o.get(r.clinicOrgId)!, provider: p.get(r.providerId)!, requester: u.get(r.requestedById) ?? null }));
}

export async function hireRequest(actor: Actor, id: string) {
  const r = await prisma.hireRequest.findUnique({ where: { id } });
  if (!r) throw new DomainError("NOT_FOUND", "Request not found");
  if (actor.role !== "PLATFORM_ADMIN" && actor.clinicOrgId !== r.clinicOrgId) throw new DomainError("NOT_FOUND", "Request not found");
  return (await withParties([r]))[0];
}

/** Admin: the default placement terms, prefilled for this request. */
export async function draftPlacementTerms(actor: Actor, id: string, feeCents?: number) {
  requireAdmin(actor);
  const r = await hireRequest(actor, id);
  const s = await getSettings();
  const fee = feeCents ?? r.feeCents ?? s["placement.defaultFeeCents"];
  const b = brand().name;
  const co = s["agreements.companyLegalName"];
  return [
    `Placement Agreement — ${longDate(clock.now())}`,
    ``,
    `Between ${co} (“${b}”) and ${r.clinic.legalName} (“Clinic”).`,
    ``,
    `1. Placement. ${b} introduced ${r.provider.legalName} (“Provider”) to the Clinic. The Clinic wishes to engage the Provider directly in a ${POSITION_TYPES[r.positionType as keyof typeof POSITION_TYPES]?.toLowerCase() ?? "direct"} role outside the ${b} marketplace.`,
    `2. Placement fee. The Clinic will pay ${b} a one-time placement fee of ${usd(fee)}, charged to the Clinic's payment method on file when it accepts these terms. The fee is earned on acceptance and is not refundable, except that if the Provider does not start work with the Clinic within 60 days, ${b} will refund it in full on request.`,
    `3. Release. Once the fee is paid, the non-circumvention terms of the Clinic Platform Agreement no longer apply between the Clinic and the Provider, and the Clinic and Provider may work together directly. ${b} is not a party to, and has no responsibility for, the employment or contracting relationship between them.`,
    `4. Marketplace. After release, the Provider will no longer be offered the Clinic's shifts on ${b}. Shifts already booked through ${b} stay booked and are paid through ${b} as usual.`,
    `5. Other providers. This agreement covers only the Provider named above. Engaging any other provider introduced through ${b} requires its own placement.`,
    `6. General. These terms supplement the Clinic Platform Agreement, which otherwise stays in effect, and are governed by the laws of the State of ${s["agreements.governingState"]}. Accepting electronically, by typing your name, has the same effect as signing on paper.`,
  ].join("\n");
}

export async function updateHireRequest(actor: Actor, id: string, patch: { status?: "IN_TALKS" | "DECLINED" | "CANCELLED"; adminNotes?: string | null }) {
  requireAdmin(actor);
  const r = await prisma.hireRequest.findUniqueOrThrow({ where: { id } });
  if (patch.status && ["PAID", "RELEASED"].includes(r.status)) throw new DomainError("CONFLICT", "This placement is already paid.");
  await prisma.hireRequest.update({ where: { id }, data: { ...(patch.status ? { status: patch.status } : {}), ...(patch.adminNotes !== undefined ? { adminNotes: patch.adminNotes } : {}) } });
  if (patch.status === "DECLINED" || patch.status === "CANCELLED") {
    await notifyClinic(prisma, r.clinicOrgId, { template: "hire_closed", title: "Update on your hire request", body: "Our team has closed your hire request. Reply to our email or message support if you have questions.", link: "/clinic/providers" });
  }
  await audit(prisma, actor, "hire.updated", "HireRequest", id, { status: r.status }, patch);
}

/** Admin: set the fee and terms, and send the clinic the link to accept and pay. */
export async function quoteHire(actor: Actor, id: string, feeCents: number, terms: string) {
  requireAdmin(actor);
  if (!Number.isInteger(feeCents) || feeCents <= 0) throw new DomainError("VALIDATION", "Enter the placement fee.");
  if (terms.trim().length < 50) throw new DomainError("VALIDATION", "Add the placement terms.");
  const r = await prisma.hireRequest.findUniqueOrThrow({ where: { id } });
  if (["PAID", "RELEASED"].includes(r.status)) throw new DomainError("CONFLICT", "This placement is already paid.");
  await prisma.hireRequest.update({ where: { id }, data: { status: "QUOTED", feeCents, terms: terms.trim(), quotedAt: clock.now(), quotedById: actor.userId } });
  const provider = await prisma.provider.findUniqueOrThrow({ where: { id: r.providerId } });
  await notifyClinic(prisma, r.clinicOrgId, {
    template: "hire_quoted",
    title: `Your placement for ${provider.displayName} is ready`,
    body: `Review the placement terms and pay the ${usd(feeCents)} placement fee to hire ${provider.displayName} directly.`,
    link: `/clinic/hire/${id}`,
    ctaLabel: "Review & pay",
  });
  await audit(prisma, actor, "hire.quoted", "HireRequest", id, null, { feeCents });
}

/** Clinic: accept the terms (typed name) and pay; on success the provider is released. */
export async function acceptHire(actor: Actor, id: string, input: { name: string; title: string; agree: boolean }, meta: { ip: string | null }) {
  const orgId = requireClinic(actor, { ownerOnly: true });
  const r = await prisma.hireRequest.findFirst({ where: { id, clinicOrgId: orgId } });
  if (!r) throw new DomainError("NOT_FOUND", "Request not found");
  if (r.status === "PAID" || r.status === "RELEASED") return r;
  if (r.status !== "QUOTED" || !r.feeCents || !r.terms) throw new DomainError("CONFLICT", "This placement isn't ready to accept yet.");
  if (!input.agree || input.name.trim().length < 3 || input.title.trim().length < 2) throw new DomainError("VALIDATION", "Type your full name and title, and tick the box to accept.");
  const attempt = await prisma.payment.count({ where: { idempotencyKey: { startsWith: `placement-${id}-` } } });
  const provider = await prisma.provider.findUniqueOrThrow({ where: { id: r.providerId } });
  const p = await chargePlacementFee(orgId, id, r.feeCents, attempt, `Placement fee · ${provider.displayName}`);
  if (!p || p.status === "FAILED") throw new DomainError("PAYMENT_FAILED", `Your payment didn't go through${p?.failureReason ? ` (${p.failureReason})` : ""}. Update your payment method in Billing and try again.`);
  await prisma.hireRequest.update({
    where: { id },
    data: { status: "PAID", acceptedName: input.name.trim(), acceptedTitle: input.title.trim(), acceptedAt: clock.now(), acceptedIp: meta.ip?.slice(0, 64) ?? null, termsHash: sha256(r.terms), paymentId: p.id },
  });
  await audit(prisma, actor, "hire.accepted", "HireRequest", id, null, { paymentId: p.id, amountCents: r.feeCents });
  await releasePlacement(id);
  return prisma.hireRequest.findUniqueOrThrow({ where: { id } });
}

/** After payment: release the provider to the clinic and stop offering them its shifts. */
async function releasePlacement(id: string) {
  const r = await prisma.hireRequest.findUniqueOrThrow({ where: { id } });
  if (r.status === "RELEASED") return;
  const key = { fromType: "CLINIC" as const, fromId: r.clinicOrgId, toType: "PROVIDER" as const, toId: r.providerId };
  await prisma.favorite.deleteMany({ where: key });
  await prisma.block.upsert({ where: { fromType_fromId_toType_toId: key }, create: { ...key, reason: "Hired directly (placement)" }, update: { reason: "Hired directly (placement)" } });
  await prisma.standingBooking.updateMany({ where: { clinicOrgId: r.clinicOrgId, providerId: r.providerId, status: { in: ["PROPOSED", "ACTIVE"] } }, data: { status: "ENDED", endedAt: clock.now(), endedByType: "PLATFORM", endedReason: "Provider hired directly" } });
  await prisma.hireRequest.update({ where: { id }, data: { status: "RELEASED", releasedAt: clock.now() } });
  const [org, provider] = await Promise.all([prisma.clinicOrg.findUniqueOrThrow({ where: { id: r.clinicOrgId } }), prisma.provider.findUniqueOrThrow({ where: { id: r.providerId } })]);
  await notifyClinic(prisma, r.clinicOrgId, {
    template: "hire_released",
    title: `You're all set to hire ${provider.displayName}`,
    body: `Payment received — thank you. You and ${provider.displayName} are free to work together directly. Shifts already booked through ${brand().name} stay booked; new shifts won't be offered to them.`,
    link: `/clinic/hire/${id}`,
  });
  await notify(prisma, provider.userId, {
    template: "hire_released_provider",
    title: `${org.displayName} has arranged to hire you directly`,
    body: `${org.displayName} completed a placement with ${brand().name}, so you're free to work with them directly. You won't be offered their shifts here anymore; shifts already booked stay booked.`,
    link: "/provider",
  });
  await notifyAdmins(prisma, { template: "hire_paid", title: `Placement paid: ${org.displayName} → ${provider.displayName}`, body: `${usd(r.feeCents ?? 0)} placement fee received.`, link: `/admin/hire/${id}`, email: true });
  await audit(prisma, SYSTEM, "hire.released", "HireRequest", id);
}

export async function openHireCount() {
  return prisma.hireRequest.count({ where: { status: { in: ["NEW", "IN_TALKS"] } } });
}

