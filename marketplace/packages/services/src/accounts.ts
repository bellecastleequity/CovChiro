import { DomainError } from "@cm/core";
import { prisma } from "@cm/db";
import { audit, clock, requireAdmin, type Actor } from "./context";
import { notifyAdmins } from "./notify";
import { recomputeProviderStatus } from "./onboarding";
import { cancelAssignment, cancelShiftByClinic } from "./shifts";

/**
 * Admin account moderation for providers and clinics.
 *  - suspend: temporary. A suspended provider is never matched (eligibility needs ACTIVE);
 *    a suspended clinic can't post and its standing bookings stop booking. They can still sign in.
 *  - ban: permanent. Sign-in disabled, sessions ended, upcoming work released, and the
 *    account's emails can't be used to sign up again.
 *  - reinstate: undoes either.
 *  - delete: removes the account. With no history it's deleted outright; otherwise personal
 *    details are erased and the shell kept, because shifts, payments and the audit log need it.
 */
export type AccountKind = "provider" | "clinic";
export type ModerationAction = "suspend" | "ban" | "reinstate";

const LIVE = ["CONFIRMED", "IN_PROGRESS"] as const;
const OPEN_SHIFT = ["DRAFT", "OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING", "CONFIRMED"] as const;
const note = (prev: string | null, text: string) => [prev, `${clock.now().toISOString().slice(0, 10)}: ${text}`].filter(Boolean).join("\n");

export async function isEmailBanned(email: string) {
  return !!(await prisma.bannedEmail.findUnique({ where: { email: email.trim().toLowerCase() } }));
}

async function userIdsFor(kind: AccountKind, id: string) {
  if (kind === "provider") return [(await prisma.provider.findUniqueOrThrow({ where: { id } })).userId];
  return (await prisma.clinicMember.findMany({ where: { clinicOrgId: id } })).map((m) => m.userId);
}

/** Releases upcoming work: provider assignments are cancelled by the platform (clinic refunded, shift reopened); clinic shifts are cancelled. */
async function releaseUpcoming(actor: Actor, kind: AccountKind, id: string, reason: string) {
  const now = clock.now();
  let released = 0;
  if (kind === "provider") {
    const live = await prisma.assignment.findMany({ where: { providerId: id, status: { in: [...LIVE] }, startsAt: { gt: now } } });
    for (const a of live) {
      await cancelAssignment(actor, a.id, reason, { by: "PLATFORM" });
      released++;
    }
    await prisma.application.updateMany({ where: { providerId: id, status: "ACTIVE" }, data: { status: "WITHDRAWN" } });
    await prisma.offer.updateMany({ where: { providerId: id, status: { in: ["PENDING", "ACCEPTED_PENDING"] } }, data: { status: "WITHDRAWN", respondedAt: now } });
    await prisma.standingBooking.updateMany({ where: { providerId: id, status: { in: ["PROPOSED", "ACTIVE"] } }, data: { status: "ENDED", endedAt: now, endedByType: "PLATFORM", endedReason: reason.slice(0, 500) } });
  } else {
    const shifts = await prisma.shift.findMany({ where: { location: { clinicOrgId: id }, status: { in: [...OPEN_SHIFT] }, startsAt: { gt: now } } });
    for (const sh of shifts) {
      if (sh.status === "DRAFT") continue;
      await cancelShiftByClinic(actor, sh.id, reason);
      released++;
    }
    await prisma.standingBooking.updateMany({ where: { clinicOrgId: id, status: { in: ["PROPOSED", "ACTIVE"] } }, data: { status: "ENDED", endedAt: now, endedByType: "PLATFORM", endedReason: reason.slice(0, 500) } });
  }
  return released;
}

/** Counts shown before an admin acts. */
export async function accountImpact(kind: AccountKind, id: string) {
  const now = clock.now();
  const upcoming =
    kind === "provider"
      ? await prisma.assignment.count({ where: { providerId: id, status: { in: [...LIVE] }, startsAt: { gt: now } } })
      : await prisma.shift.count({ where: { location: { clinicOrgId: id }, status: { in: OPEN_SHIFT.filter((s) => s !== "DRAFT") }, startsAt: { gt: now } } });
  const userIds = await userIdsFor(kind, id);
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { email: true, disabledAt: true } });
  const banned = await prisma.bannedEmail.count({ where: { email: { in: users.map((u) => u.email.toLowerCase()) } } });
  return { upcoming, banned: banned > 0, signInDisabled: users.length > 0 && users.every((u) => u.disabledAt) };
}

export async function moderateAccount(actor: Actor, input: { kind: AccountKind; id: string; action: ModerationAction; reason: string; releaseUpcoming?: boolean }) {
  requireAdmin(actor);
  const reason = input.reason.trim();
  if (input.action !== "reinstate" && reason.length < 3) throw new DomainError("VALIDATION", "Add a short reason (kept in the admin notes and audit log).");
  const { kind, id } = input;
  const userIds = await userIdsFor(kind, id);
  const now = clock.now();
  let released = 0;

  if (input.action === "reinstate") {
    await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { disabledAt: null } });
    const emails = (await prisma.user.findMany({ where: { id: { in: userIds } }, select: { email: true } })).map((u) => u.email.toLowerCase());
    await prisma.bannedEmail.deleteMany({ where: { email: { in: emails } } });
    if (kind === "provider") {
      const p = await prisma.provider.findUniqueOrThrow({ where: { id } });
      await prisma.provider.update({ where: { id }, data: { status: "ONBOARDING", adminNotes: note(p.adminNotes, `Reinstated${reason ? `: ${reason}` : ""}`) } });
      await recomputeProviderStatus(id);
    } else {
      const c = await prisma.clinicOrg.findUniqueOrThrow({ where: { id } });
      const ready = !!c.adminApprovedAt || !!c.agreementSignedAt;
      await prisma.clinicOrg.update({ where: { id }, data: { status: ready ? "ACTIVE" : "ONBOARDING", adminNotes: note(c.adminNotes, `Reinstated${reason ? `: ${reason}` : ""}`) } });
    }
    await audit(prisma, actor, `${kind}.reinstated`, kind === "provider" ? "Provider" : "ClinicOrg", id, null, { reason });
    return "Reinstated. They can sign in and use the platform again.";
  }

  const ban = input.action === "ban";
  if (ban || input.releaseUpcoming) released = await releaseUpcoming(actor, kind, id, ban ? "Account closed by the platform" : "Account suspended by the platform");
  else if (kind === "provider") {
    // A suspended provider can't be matched, so their open applications and offers go now.
    await prisma.application.updateMany({ where: { providerId: id, status: "ACTIVE" }, data: { status: "WITHDRAWN" } });
    await prisma.offer.updateMany({ where: { providerId: id, status: { in: ["PENDING", "ACCEPTED_PENDING"] } }, data: { status: "WITHDRAWN", respondedAt: now } });
  }
  const status = ban ? "DEACTIVATED" : "SUSPENDED";
  const label = ban ? "Banned" : "Suspended";
  if (kind === "provider") {
    const p = await prisma.provider.findUniqueOrThrow({ where: { id } });
    await prisma.provider.update({ where: { id }, data: { status, adminNotes: note(p.adminNotes, `${label}: ${reason}`) } });
  } else {
    const c = await prisma.clinicOrg.findUniqueOrThrow({ where: { id } });
    await prisma.clinicOrg.update({ where: { id }, data: { status, adminNotes: note(c.adminNotes, `${label}: ${reason}`) } });
  }
  if (ban) {
    await prisma.user.updateMany({ where: { id: { in: userIds } }, data: { disabledAt: now } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { email: true } });
    for (const u of users) {
      const email = u.email.toLowerCase();
      await prisma.bannedEmail.upsert({ where: { email }, create: { email, reason: reason.slice(0, 500), createdById: actor.userId ?? null }, update: { reason: reason.slice(0, 500) } });
    }
  }
  await audit(prisma, actor, `${kind}.${input.action === "ban" ? "banned" : "suspended"}`, kind === "provider" ? "Provider" : "ClinicOrg", id, null, { reason, released });
  const rel = released ? ` ${released} upcoming shift${released === 1 ? " was" : "s were"} released${kind === "provider" ? " and reopened for other providers" : " and cancelled"}.` : "";
  return ban ? `Banned: sign-in disabled and their email can't be used to sign up again.${rel}` : `Suspended.${kind === "provider" ? " They won't be matched or offered shifts." : " They can't post shifts."}${rel}`;
}

/** Permanently delete an account (see header). Upcoming work is released first. */
export async function deleteAccount(actor: Actor, kind: AccountKind, id: string, reason: string) {
  requireAdmin(actor);
  if (reason.trim().length < 3) throw new DomainError("VALIDATION", "Add a short reason (kept in the audit log).");
  const userIds = await userIdsFor(kind, id);
  const released = await releaseUpcoming(actor, kind, id, "Account deleted");
  // Clinic drafts are discarded with the account.
  if (kind === "clinic") await prisma.shift.updateMany({ where: { location: { clinicOrgId: id }, status: "DRAFT" }, data: { status: "CANCELLED", cancelledAt: clock.now(), cancelReason: "Account deleted" } });

  let hard = false;
  try {
    await prisma.$transaction(async (db) => {
      if (kind === "provider") await db.provider.delete({ where: { id } });
      else await db.clinicOrg.delete({ where: { id } });
      await db.session.deleteMany({ where: { userId: { in: userIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    });
    hard = true;
  } catch {
    // Linked history (shifts, payments, credentials…) keeps the record: erase personal details instead.
    await prisma.$transaction(async (db) => {
      for (const uid of userIds) {
        await db.user.update({ where: { id: uid }, data: { email: `deleted-${uid}@deleted.invalid`, name: "Deleted user", phone: null, passwordHash: null, totpSecret: null, mfaEnabled: false, disabledAt: clock.now() } });
      }
      await db.session.deleteMany({ where: { userId: { in: userIds } } });
      if (kind === "provider") {
        await db.provider.update({
          where: { id },
          data: {
            status: "DEACTIVATED", legalName: "Deleted provider", displayName: "Deleted provider", photoUrl: null, npi: null, homeAddress: null, homeLat: null, homeLng: null,
            homeCity: null, homeZip: null, homeCounty: null, bio: null, headline: null, linkedinUrl: null, school: null, preferredArea: null, referredBy: null,
          },
        });
      } else {
        await db.clinicOrg.update({ where: { id }, data: { status: "DEACTIVATED", legalName: "Deleted clinic", displayName: "Deleted clinic", phone: null, billingEmail: null, logoUrl: null } });
        await db.clinicLocation.updateMany({ where: { clinicOrgId: id }, data: { active: false, phone: null, onSiteContactName: null, arrivalNotes: null, photoKeys: [] } });
      }
    });
  }
  await audit(prisma, actor, `${kind}.deleted`, kind === "provider" ? "Provider" : "ClinicOrg", id, null, { reason, hard, released });
  await notifyAdmins(prisma, { template: "account_deleted", email: false, title: `${kind === "provider" ? "Provider" : "Clinic"} account deleted`, body: `Reason: ${reason}`, link: "/admin/audit" }).catch(() => undefined);
  return hard ? "Deleted." : "Deleted. Personal details were erased; past shifts and payments stay in the records (shown as a deleted account).";
}

// ---------------- individual logins (Admin → Users) ----------------

/**
 * Users: every login. Providers and clinics are moderated as accounts (above) from their own admin
 * pages, so matching, posting and upcoming work follow. Here, any single login can also be:
 *  - suspended: sign-in disabled and sessions ended (no ban list, nothing released) — e.g. a clinic's
 *    former front-desk staff member, or another admin;
 *  - unsuspended: sign-in works again;
 *  - deleted: removed (or, with history attached, personal details erased).
 * You can't act on your own login, and the last active admin can't be suspended or deleted.
 */
export type UserStatusFilter = "active" | "suspended" | "all";

export async function listUsers(actor: Actor, f: { q?: string; role?: string; status?: UserStatusFilter } = {}) {
  requireAdmin(actor);
  const q = f.q?.trim();
  const rows = await prisma.user.findMany({
    where: {
      email: { not: { endsWith: "@deleted.invalid" } },
      ...(f.role ? { role: f.role as never } : {}),
      ...(f.status === "suspended" ? { disabledAt: { not: null } } : f.status === "active" ? { disabledAt: null } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] } : {}),
    },
    include: { provider: { select: { id: true, status: true } }, clinicMembers: { include: { clinicOrg: { select: { id: true, displayName: true, status: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const banned = new Set((await prisma.bannedEmail.findMany({ where: { email: { in: rows.map((r) => r.email.toLowerCase()) } }, select: { email: true } })).map((b) => b.email));
  return rows.map((u) => ({
    id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
    suspended: !!u.disabledAt, banned: banned.has(u.email.toLowerCase()),
    provider: u.provider, clinics: u.clinicMembers.map((m) => ({ ...m.clinicOrg, memberRole: m.role })),
  }));
}

async function guardUserAction(actor: Actor, userId: string) {
  requireAdmin(actor);
  if (actor.userId === userId) throw new DomainError("VALIDATION", "You can't do that to your own login.");
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (u.role === "PLATFORM_ADMIN" && (await prisma.user.count({ where: { role: "PLATFORM_ADMIN", disabledAt: null, id: { not: userId } } })) === 0) {
    throw new DomainError("VALIDATION", "That's the last active admin login.");
  }
  return u;
}

export async function setUserSuspended(actor: Actor, userId: string, suspended: boolean, reason: string) {
  const u = await guardUserAction(actor, userId);
  if (suspended && reason.trim().length < 3) throw new DomainError("VALIDATION", "Add a short reason (kept in the audit log).");
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { disabledAt: suspended ? clock.now() : null } }),
    ...(suspended ? [prisma.session.deleteMany({ where: { userId } })] : []),
  ]);
  await audit(prisma, actor, suspended ? "user.suspended" : "user.unsuspended", "User", userId, null, { reason, email: u.email });
  return suspended ? `${u.name} can't sign in until you unsuspend them.` : `${u.name} can sign in again.`;
}

export async function deleteUser(actor: Actor, userId: string, reason: string) {
  const u = await guardUserAction(actor, userId);
  if (reason.trim().length < 3) throw new DomainError("VALIDATION", "Add a short reason (kept in the audit log).");
  // A provider, or a clinic's only member, is a whole account: delete it from its own page so its work is released.
  if (u.role === "PROVIDER" && (await prisma.provider.findUnique({ where: { userId } }))) throw new DomainError("VALIDATION", "This is a provider account: delete it from the provider's page so their upcoming shifts are released.");
  const memberships = await prisma.clinicMember.findMany({ where: { userId } });
  for (const m of memberships) {
    if ((await prisma.clinicMember.count({ where: { clinicOrgId: m.clinicOrgId } })) === 1) throw new DomainError("VALIDATION", "This is the clinic's only login: delete the clinic from its page instead.");
    if (m.role === "CLINIC_OWNER" && (await prisma.clinicMember.count({ where: { clinicOrgId: m.clinicOrgId, role: "CLINIC_OWNER" } })) === 1) throw new DomainError("VALIDATION", "This is the clinic's only owner: make someone else the owner first, or delete the clinic.");
  }
  let hard = false;
  try {
    await prisma.$transaction(async (db) => {
      await db.clinicMember.deleteMany({ where: { userId } });
      await db.session.deleteMany({ where: { userId } });
      await db.user.delete({ where: { id: userId } });
    });
    hard = true;
  } catch {
    await prisma.$transaction(async (db) => {
      await db.clinicMember.deleteMany({ where: { userId } });
      await db.session.deleteMany({ where: { userId } });
      await db.user.update({ where: { id: userId }, data: { email: `deleted-${userId}@deleted.invalid`, name: "Deleted user", phone: null, passwordHash: null, totpSecret: null, mfaEnabled: false, disabledAt: clock.now() } });
    });
  }
  await audit(prisma, actor, "user.deleted", "User", userId, null, { reason, hard, email: u.email });
  return hard ? "Login deleted." : "Login deleted. Its name and email were erased; records it created stay (shown as a deleted user).";
}
