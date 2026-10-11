import { clinicPhonesChange, DomainError, phonesOnFile, providerPhoneChange, normalizeUsPhone } from "@cm/core";
import { prisma } from "@cm/db";
import { audit, requireClinic, requireProvider, type Actor, type Db } from "./context";

/**
 * Phone numbers on file (owner decision Oct 2026; rules in core phones.ts): providers keep one
 * number, clinics two different numbers. Without them a provider fails eligibility F15 (can't apply
 * or accept) and a clinic can't post, pick providers or invite. With live shifts a number can be
 * changed but never removed. The numbers are for our team only: never shown to the other side.
 */

/** Shifts that are posted or booked and not over yet. */
const LIVE_SHIFT_STATUSES = ["OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING", "CONFIRMED", "IN_PROGRESS"] as const;

export async function providerHasLiveBookings(providerId: string, db: Db = prisma) {
  return (await db.assignment.count({ where: { providerId, status: { in: ["CONFIRMED", "IN_PROGRESS"] } } })) > 0;
}

export async function clinicHasLiveShifts(orgId: string, db: Db = prisma) {
  return (await db.shift.count({ where: { location: { clinicOrgId: orgId }, status: { in: [...LIVE_SHIFT_STATUSES] } } })) > 0;
}

export function clinicPhonesOk(org: { phone: string | null; backupPhone: string | null }) {
  return phonesOnFile("CLINIC", [org.phone, org.backupPhone]);
}

export const CLINIC_PHONES_MESSAGE = "Add your clinic's two phone numbers in Settings first. We need them on file before you can post shifts or choose providers.";

/** Posting, picking and inviting all stop here when the clinic's two numbers aren't on file. */
export async function assertClinicPhones(orgId: string, db: Db = prisma) {
  const org = await db.clinicOrg.findUniqueOrThrow({ where: { id: orgId }, select: { phone: true, backupPhone: true } });
  if (!clinicPhonesOk(org)) throw new DomainError("FORBIDDEN", CLINIC_PHONES_MESSAGE);
}

/** A provider (or an admin for them) saves or clears their number. A new number needs texting verified again. */
export async function setProviderPhone(actor: Actor, raw: string | null | undefined, opts: { providerId?: string } = {}) {
  const providerId = opts.providerId && actor.role === "PLATFORM_ADMIN" ? opts.providerId : requireProvider(actor);
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: providerId }, include: { user: true } });
  const r = providerPhoneChange(raw, await providerHasLiveBookings(providerId));
  if ("problem" in r) throw new DomainError("VALIDATION", r.problem);
  if (p.user.phone === r.phone) return r.phone;
  const changed = normalizeUsPhone(p.user.phone) !== r.phone;
  await prisma.user.update({ where: { id: p.userId }, data: { phone: r.phone, ...(changed ? { phoneVerifiedAt: null } : {}) } });
  await audit(prisma, actor, r.phone ? "user.phone_changed" : "user.phone_removed", "User", p.userId, { hadPhone: !!p.user.phone }, { hasPhone: !!r.phone });
  return r.phone;
}

/** Clinic owner (or an admin) saves the clinic's two numbers. */
export async function setClinicPhones(actor: Actor, main: string | null | undefined, backup: string | null | undefined, opts: { clinicOrgId?: string } = {}) {
  const orgId = opts.clinicOrgId && actor.role === "PLATFORM_ADMIN" ? opts.clinicOrgId : requireClinic(actor, { ownerOnly: true });
  const r = clinicPhonesChange(main, backup, await clinicHasLiveShifts(orgId));
  if ("problem" in r) throw new DomainError("VALIDATION", r.problem);
  const before = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: orgId }, select: { phone: true, backupPhone: true } });
  await prisma.clinicOrg.update({ where: { id: orgId }, data: r });
  await audit(prisma, actor, "clinic.phones_changed", "ClinicOrg", orgId, { phones: [before.phone, before.backupPhone].filter(Boolean).length }, { phones: [r.phone, r.backupPhone].filter(Boolean).length });
  return r;
}

/** For banners and the setup checklist. */
export async function phoneStatus(actor: Actor) {
  if (actor.providerId) {
    const p = await prisma.provider.findUniqueOrThrow({ where: { id: actor.providerId }, include: { user: { select: { phone: true } } } });
    return { ok: phonesOnFile("PROVIDER", [p.user.phone]) };
  }
  if (actor.clinicOrgId) {
    const org = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: actor.clinicOrgId }, select: { phone: true, backupPhone: true } });
    return { ok: clinicPhonesOk(org) };
  }
  return { ok: true };
}
