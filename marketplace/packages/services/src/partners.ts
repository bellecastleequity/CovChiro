import { brand } from "@cm/config";
import { DomainError, partnerTermAt, type PartnershipFacts } from "@cm/core";
import { prisma, type Prisma } from "@cm/db";
import { agreementText, renderPartnerAddendum, type AgreementDoc } from "./agreement-text";
import { longDate, sha256 } from "./agreements";
import { audit, getSettings, requireAdmin, requireClinic, type Actor, type Db } from "./context";
import { notify, notifyAdmins, sendEmail } from "./notify";

/**
 * Partner clinic program (owner request Oct 2026). An admin offers a partnership to a clinic; the
 * clinic owner e-signs the Partner Addendum and it's active from that moment, renewing every term
 * until an admin ends it. While in force (and while Settings → Features → Partner clinic program
 * is on) each new quote gets the partner discount (from our margin only) and the rate lock; see
 * pricing.quoteShift. Exclusivity is contractual: nothing here blocks a clinic from anything.
 */

const facts = (p: { status: PartnershipFacts["status"]; startsAt: Date | null; endedAt: Date | null; termMonths: number; discountPercent: number }): PartnershipFacts => p;

export async function programOn(db: Db = prisma) {
  return (await getSettings(db))["features.partnerProgram"];
}

/** The partnership in force for a clinic at `at` (and its current term), or null. Null whenever the program is off. */
export async function activePartnership(db: Db, clinicOrgId: string, at: Date) {
  if (!(await programOn(db))) return null;
  const rows = await db.clinicPartnership.findMany({ where: { clinicOrgId, status: { in: ["ACTIVE", "ENDED"] }, startsAt: { lte: at } }, orderBy: { startsAt: "desc" }, take: 3 });
  for (const p of rows) {
    const term = partnerTermAt(facts(p), at);
    if (term) return { ...p, term };
  }
  return null;
}

/** For the clinic: the open offer or the partnership in force (null when the program is off). */
export async function partnershipForClinic(actor: Actor) {
  const orgId = requireClinic(actor);
  if (!(await programOn())) return null;
  const now = new Date();
  const active = await activePartnership(prisma, orgId, now);
  if (active) return { kind: "ACTIVE" as const, p: active, discountsCents: await discountsGiven(active.id, active.term.termStart) };
  const offer = await prisma.clinicPartnership.findFirst({ where: { clinicOrgId: orgId, status: "OFFERED" }, orderBy: { offeredAt: "desc" } });
  return offer ? { kind: "OFFERED" as const, p: offer } : null;
}

/** Partner discounts on bookings that stand (cancelled bookings are refunded and don't count), optionally since a date. */
export async function discountsGiven(partnershipId: string, since?: Date) {
  const r = await prisma.assignment.aggregate({
    _sum: { partnerDiscountCents: true },
    _count: true,
    where: { shift: { partnershipId, ...(since ? { startsAt: { gte: since } } : {}) }, status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED", "DISPUTED"] }, partnerDiscountCents: { gt: 0 } },
  });
  return { cents: r._sum.partnerDiscountCents ?? 0, bookings: r._count };
}

// ---------------- admin ----------------

export async function offerPartnership(actor: Actor, clinicOrgId: string) {
  requireAdmin(actor);
  const s = await getSettings();
  if (!s["features.partnerProgram"]) throw new DomainError("VALIDATION", "Turn on the partner clinic program first (Settings → Features).");
  const org = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: clinicOrgId }, include: { members: { where: { role: "CLINIC_OWNER" }, include: { user: true } } } });
  if (await activePartnership(prisma, clinicOrgId, new Date())) throw new DomainError("CONFLICT", "This clinic is already a partner.");
  // One open offer at a time: a new offer replaces an unsigned one (with today's settings).
  await prisma.clinicPartnership.updateMany({ where: { clinicOrgId, status: "OFFERED" }, data: { status: "WITHDRAWN", endedAt: new Date(), endedById: actor.userId, endReason: "Replaced by a new offer" } });
  const p = await prisma.clinicPartnership.create({
    data: { clinicOrgId, discountPercent: s["partner.discountPercent"], termMonths: s["partner.termMonths"], releaseHours: s["partner.releaseHours"], noticeDays: s["partner.noticeDays"], offeredById: actor.userId },
  });
  await audit(prisma, actor, "partner.offered", "ClinicPartnership", p.id, null, { clinicOrgId, discountPercent: p.discountPercent, termMonths: p.termMonths });
  for (const m of org.members)
    await notify(prisma, m.userId, {
      template: "partner.offered",
      title: `${p.discountPercent}% off every shift: become a ${brand().name} partner`,
      body: `Book all your temporary coverage with us and get ${p.discountPercent}% off every shift, with your rates locked for ${p.termMonths} months. Review and sign the Partner Addendum to start.`,
      link: "/clinic/partner",
      ctaLabel: "Review the offer",
    });
  return p;
}

export async function withdrawOffer(actor: Actor, id: string) {
  requireAdmin(actor);
  const p = await prisma.clinicPartnership.findUniqueOrThrow({ where: { id } });
  if (p.status !== "OFFERED") throw new DomainError("CONFLICT", "Only an unsigned offer can be withdrawn.");
  await prisma.clinicPartnership.update({ where: { id }, data: { status: "WITHDRAWN", endedAt: new Date(), endedById: actor.userId, endReason: "Offer withdrawn" } });
  await audit(prisma, actor, "partner.withdrawn", "ClinicPartnership", id, { status: p.status }, { status: "WITHDRAWN" });
}

/** End now, or at the end of the current term ("notice given"). Partner pricing stops for quotes after the end. */
export async function endPartnership(actor: Actor, id: string, input: { when: "now" | "term_end"; reason: string }) {
  requireAdmin(actor);
  const reason = input.reason.trim();
  if (reason.length < 3) throw new DomainError("VALIDATION", "Add a short reason (it's kept in the audit log).");
  const p = await prisma.clinicPartnership.findUniqueOrThrow({ where: { id } });
  const now = new Date();
  const term = partnerTermAt(facts(p), now);
  if (p.status !== "ACTIVE" || !term) throw new DomainError("CONFLICT", "This partnership isn't in force.");
  const endedAt = input.when === "now" ? now : term.termEnd;
  await prisma.clinicPartnership.update({ where: { id }, data: { status: "ENDED", endedAt, endedById: actor.userId, endReason: reason } });
  await audit(prisma, actor, "partner.ended", "ClinicPartnership", id, { status: p.status }, { status: "ENDED", endedAt, reason });
  const owners = await prisma.clinicMember.findMany({ where: { clinicOrgId: p.clinicOrgId, role: "CLINIC_OWNER" } });
  for (const m of owners)
    await notify(prisma, m.userId, {
      template: "partner.ended",
      title: input.when === "now" ? "Your partnership has ended" : `Your partnership ends ${longDate(endedAt)}`,
      body: input.when === "now" ? "Partner pricing no longer applies to new shifts. Shifts already booked keep their price." : `Partner pricing continues until ${longDate(endedAt)}, then stops for new shifts. Shifts already booked keep their price.`,
      link: "/clinic/partner",
    });
  return endedAt;
}

/** Admin report: every partnership with its discounts given (all time and this term). */
export async function partnerReport(actor: Actor) {
  requireAdmin(actor);
  const rows = await prisma.clinicPartnership.findMany({ where: { status: { not: "WITHDRAWN" } }, include: { clinicOrg: { select: { id: true, displayName: true } } }, orderBy: [{ status: "asc" }, { offeredAt: "desc" }] });
  const now = new Date();
  return Promise.all(
    rows.map(async (p) => {
      const term = partnerTermAt(facts(p), now);
      const [all, current] = await Promise.all([discountsGiven(p.id), term ? discountsGiven(p.id, term.termStart) : Promise.resolve(null)]);
      return { p, term, all, current };
    }),
  );
}

// ---------------- signing (clinic owner) ----------------

async function addendumFor(p: { clinicOrgId: string; discountPercent: number; termMonths: number; releaseHours: number; noticeDays: number }, signer: { name: string; email: string; title?: string | null }, on: Date) {
  const s = await getSettings();
  const org = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: p.clinicOrgId }, include: { locations: { where: { active: true }, orderBy: { createdAt: "asc" }, take: 1 } } });
  const l = org.locations[0];
  const address = l ? `${l.addressLine1}${l.addressLine2 ? `, ${l.addressLine2}` : ""}, ${l.city}, ${l.state} ${l.zip}` : null;
  const doc = renderPartnerAddendum(brand().name, { legalName: org.legalName, address, signerName: signer.name, signerEmail: signer.email, signerTitle: signer.title ?? null }, p, s, longDate(on));
  const text = agreementText(doc);
  return { doc, text, hash: sha256(text) };
}

/** The offer as the owner will sign it today. */
export async function partnerAddendumForSigning(actor: Actor) {
  const orgId = requireClinic(actor, { ownerOnly: true });
  if (!(await programOn())) throw new DomainError("NOT_FOUND", "No partner offer");
  const p = await prisma.clinicPartnership.findFirst({ where: { clinicOrgId: orgId, status: "OFFERED" }, orderBy: { offeredAt: "desc" } });
  if (!p) throw new DomainError("NOT_FOUND", "No partner offer");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId! } });
  return { p, user, ...(await addendumFor(p, { name: user.name, email: user.email }, new Date())) };
}

export async function signPartnerAddendum(
  actor: Actor,
  raw: { id: string; typedName: string; title: string | null; consent: boolean; agree: boolean; viewedHash: string },
  meta: { ip: string | null; userAgent: string | null },
) {
  const orgId = requireClinic(actor, { ownerOnly: true });
  if (!(await programOn())) throw new DomainError("NOT_FOUND", "No partner offer");
  const typedName = raw.typedName.trim();
  const title = raw.title?.trim() ?? "";
  if (typedName.length < 3) throw new DomainError("VALIDATION", "Type your full legal name to sign.");
  if (!title) throw new DomainError("VALIDATION", "Add your title (for example Owner or Office Manager).");
  if (!raw.consent) throw new DomainError("VALIDATION", "Please agree to sign electronically.");
  if (!raw.agree) throw new DomainError("VALIDATION", "Please confirm you have read and agree to the addendum.");
  const p = await prisma.clinicPartnership.findUnique({ where: { id: raw.id } });
  if (!p || p.clinicOrgId !== orgId || p.status !== "OFFERED") throw new DomainError("NOT_FOUND", "This offer is no longer open.");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId! } });
  const now = new Date();
  const { doc, text, hash } = await addendumFor(p, { name: user.name, email: user.email, title }, now);
  // The hash covers the signer's title, so compare against what they saw (rendered without it).
  const shown = await addendumFor(p, { name: user.name, email: user.email }, now);
  if (shown.hash !== raw.viewedHash) throw new DomainError("CONFLICT", "The addendum was updated while you were reading it. Please review it again and sign.");
  const updated = await prisma.clinicPartnership.updateMany({
    where: { id: p.id, status: "OFFERED" },
    data: {
      status: "ACTIVE",
      startsAt: now,
      signerUserId: user.id,
      typedSignature: typedName.slice(0, 120),
      signerTitle: title.slice(0, 80),
      signerEmail: user.email,
      signerIp: meta.ip?.slice(0, 64) ?? null,
      signerAgent: meta.userAgent?.slice(0, 400) ?? null,
      consentAt: now,
      document: doc as unknown as Prisma.InputJsonValue,
      documentText: text,
      documentHash: hash,
    },
  });
  if (!updated.count) throw new DomainError("CONFLICT", "This offer was just signed or withdrawn.");
  await audit(prisma, actor, "partner.signed", "ClinicPartnership", p.id, { status: "OFFERED" }, { status: "ACTIVE", startsAt: now });
  const org = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: orgId }, select: { displayName: true } });
  await notifyAdmins(prisma, { template: "partner.signed", title: `New partner clinic: ${org.displayName}`, body: `${org.displayName} signed the Partner Addendum (${p.discountPercent}% off, ${p.termMonths}-month terms).`, link: `/admin/clinics/${orgId}` }).catch(() => undefined);
  await sendEmail(user.email, {
    subject: `Your signed ${doc.title}`,
    heading: "Welcome, partner",
    paragraphs: [
      `Thanks for signing. From today, every shift you post gets ${p.discountPercent}% off coverage, and your rates are locked for the next ${p.termMonths} months.`,
      `Signed by ${typedName}, ${title} (${user.email}) on ${now.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "long", timeStyle: "long" })}. Document fingerprint (SHA-256): ${hash}.`,
      ...doc.sections.flatMap((x) => [x.heading.toUpperCase(), ...x.paragraphs]),
    ],
    cta: { label: "View your partnership", url: "/clinic/partner" },
  }).catch(() => undefined);
  return p.id;
}

/** The signed addendum (clinic members of that clinic, and admins). */
export async function signedPartnerAddendum(actor: Actor, id: string) {
  const p = await prisma.clinicPartnership.findUnique({ where: { id } });
  if (!p || !p.documentText || (actor.role !== "PLATFORM_ADMIN" && actor.clinicOrgId !== p.clinicOrgId)) throw new DomainError("NOT_FOUND", "Addendum not found");
  return { p, doc: p.document as unknown as AgreementDoc, intact: sha256(p.documentText) === p.documentHash };
}

/** Clinic ids with a partnership in force now (for the "Partner clinic" chip shown to providers and in admin lists). */
export async function partnerClinicIds(clinicOrgIds: string[]): Promise<Set<string>> {
  if (!clinicOrgIds.length || !(await programOn())) return new Set();
  const now = new Date();
  const rows = await prisma.clinicPartnership.findMany({ where: { clinicOrgId: { in: clinicOrgIds }, status: { in: ["ACTIVE", "ENDED"] }, startsAt: { lte: now } } });
  return new Set(rows.filter((p) => partnerTermAt(facts(p), now)).map((p) => p.clinicOrgId));
}
