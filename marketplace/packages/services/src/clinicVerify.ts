import { brand } from "@cm/config";
import {
  autoApprovable,
  clinicCleared,
  openChecks,
  overrideCheck,
  clinicVerifyDeadline,
  DomainError,
  namesMatch,
  nameTokens,
  sameLicenseNumber,
  selectionDeadline,
  urgencyTier,
  verificationChecks,
  verificationInputProblems,
  verifyReminderDue,
  type ClinicClearFacts,
  type ClinicVerificationStatus,
  type OwnerInput,
  type StateOwnershipRule,
  type VerificationCheck,
  type VerificationFacts,
  type VerificationInput,
} from "@cm/core";
import { prisma, Prisma } from "@cm/db";
import { nppesProvider } from "@cm/integrations";
import { audit, clock, getSettings, requireAdmin, requireClinic, SYSTEM, type Actor, type Db } from "./context";
import { notifyAdmins, notifyClinic } from "./notify";

/**
 * Clinic ownership verification (owner decision Oct 2026; core/clinicVerify.ts has the rules).
 *  - The clinic owner fills in the form (Settings → Verification): legal entity, owners and their
 *    licenses, organization NPI, the state's facility license where needed, uploads, sworn statement.
 *  - Automatic checks: owners' licenses against verified licenses here or the NPI registry, the
 *    organization NPI (active, same ZIP, authorized official is an owner), links to blocked clinics.
 *    All clean + clinicVerify.autoApprove → verified at once; otherwise Admin → Verification → Clinics.
 *  - Until cleared, the clinic can post but its shifts aren't shown or offered to providers
 *    (eligibility F13; Smart Dispatch and selection deadlines skip them). Verifying releases them.
 *  - Clinics on the platform before this started have a grace period (migration 0046); verification
 *    lasts clinicVerify.renewMonths (+ graceDays to renew); daily sweep sends reminders.
 */

const DAY = 86_400_000;
const UNFILLED = ["OPEN", "FAVORITES_ONLY", "SELECTING"] as const;

export const ATTEST_TEXT =
  "I am an owner or officer of this clinic and authorized to act for it. The ownership information above is true and complete, and the clinic's ownership and licensing comply with the laws of the state where it operates. I will tell CoverageOnCall within 10 days of any change in ownership, licensing or the clinic's status with the state.";

const clearFacts = (o: { verificationStatus: string; verifiedUntil: Date | null; verificationGraceUntil: Date | null }): ClinicClearFacts => ({
  status: o.verificationStatus as ClinicVerificationStatus,
  verifiedUntil: o.verifiedUntil,
  graceUntil: o.verificationGraceUntil,
});

/** Prisma filter for clinics whose shifts may go to providers right now. */
export function clearedOrgWhere(now: Date): Prisma.ClinicOrgWhereInput {
  return {
    verificationStatus: { not: "REJECTED" },
    OR: [{ verificationStatus: "VERIFIED", OR: [{ verifiedUntil: null }, { verifiedUntil: { gt: now } }] }, { verificationGraceUntil: { gt: now } }],
  };
}

export async function clinicIsCleared(db: Db, clinicOrgId: string, now = clock.now()): Promise<boolean> {
  const s = await getSettings(db);
  if (!s["clinicVerify.enabled"]) return true;
  const o = await db.clinicOrg.findUnique({ where: { id: clinicOrgId }, select: { verificationStatus: true, verifiedUntil: true, verificationGraceUntil: true } });
  return !!o && clinicCleared(clearFacts(o), now);
}

const ruleFor = (s: Awaited<ReturnType<typeof getSettings>>, state: string | null | undefined): StateOwnershipRule | null =>
  (state ? (s["clinicVerify.stateRules"] as Record<string, StateOwnershipRule>)[state] : undefined) ?? null;

/** What the clinic sees on its Verification page. */
export async function myVerification(actor: Actor) {
  const orgId = requireClinic(actor);
  const s = await getSettings();
  const now = clock.now();
  const org = await prisma.clinicOrg.findUniqueOrThrow({
    where: { id: orgId },
    include: { locations: { where: { active: true }, orderBy: { createdAt: "asc" }, take: 1 }, verifications: { orderBy: { submittedAt: "desc" }, take: 1 } },
  });
  const f = clearFacts(org);
  const state = org.locations[0]?.state ?? null;
  const last = org.verifications[0] ?? null;
  return {
    enabled: s["clinicVerify.enabled"],
    status: org.verificationStatus as ClinicVerificationStatus,
    cleared: !s["clinicVerify.enabled"] || clinicCleared(f, now),
    deadline: clinicVerifyDeadline(f, now),
    verifiedAt: org.verifiedAt,
    verifiedUntil: org.verifiedUntil,
    graceUntil: org.verificationGraceUntil,
    note: org.verificationNote,
    renewalPending: org.verificationStatus === "VERIFIED" && last?.status === "PENDING",
    state,
    rule: ruleFor(s, state),
    attestText: ATTEST_TEXT,
    prefill: last
      ? {
          entityName: last.entityName,
          entityState: last.entityState,
          entityNumber: last.entityNumber,
          orgNpi: last.orgNpi,
          owners: last.owners as unknown as OwnerInput[],
          facilityLicenseNumber: last.facilityLicenseNumber,
          facilityExemptionNumber: last.facilityExemptionNumber,
          documentKeys: last.documentKeys,
        }
      : { entityName: org.legalName, entityState: state ?? "", entityNumber: "", orgNpi: null, owners: [] as OwnerInput[], facilityLicenseNumber: null, facilityExemptionNumber: null, documentKeys: [] as string[] },
  };
}

/** Banner text for clinic pages (null = nothing to say). */
export async function verificationBanner(clinicOrgId: string) {
  const s = await getSettings();
  if (!s["clinicVerify.enabled"]) return null;
  const now = clock.now();
  const o = await prisma.clinicOrg.findUnique({ where: { id: clinicOrgId }, select: { verificationStatus: true, verifiedUntil: true, verificationGraceUntil: true, verificationNote: true } });
  if (!o) return null;
  const f = clearFacts(o);
  const cleared = clinicCleared(f, now);
  const deadline = clinicVerifyDeadline(f, now);
  const status = o.verificationStatus as ClinicVerificationStatus;
  if (cleared && status === "VERIFIED" && (!deadline || +deadline - +now > s["clinicVerify.graceDays"] * DAY)) return null;
  return { status, cleared, deadline, note: o.verificationNote };
}

/** Owners' licenses: a verified license here first, else the NPI registry. */
async function ownerFacts(owners: OwnerInput[]): Promise<{ facts: VerificationFacts["owners"]; registryDown: boolean }> {
  const reg = nppesProvider();
  let registryDown = false;
  const facts: VerificationFacts["owners"] = [];
  for (const o of owners) {
    if (!o.licensed || !o.licenseNumber || !o.licenseState) {
      facts.push({ license: null, nameMatches: false });
      continue;
    }
    const ours = await prisma.license.findMany({
      where: { state: o.licenseState, status: { in: ["VERIFIED", "SUSPENDED", "REVOKED"] }, ...(o.professionCode ? { professionCode: o.professionCode } : {}) },
      select: { licenseNumber: true, status: true, boardStatus: true, provider: { select: { legalName: true, displayName: true } } },
    });
    const mine = ours.find((l) => sameLicenseNumber(l.licenseNumber, o.licenseNumber!));
    if (mine) {
      facts.push({
        license: "PLATFORM",
        nameMatches: namesMatch(o.name, mine.provider.legalName || mine.provider.displayName),
        boardInactive: mine.status !== "VERIFIED",
      });
      continue;
    }
    try {
      const tokens = nameTokens(o.name);
      const people = o.npi && reg.lookup
        ? [await reg.lookup(o.npi)].filter((x): x is NonNullable<typeof x> => !!x)
        : reg.findPeople && tokens.length >= 2
          ? await reg.findPeople({ firstName: tokens[0], lastName: tokens[tokens.length - 1], state: o.licenseState })
          : [];
      const hit = people.find((p) => p.kind === "individual" && (p.licenses ?? []).some((l) => l.state === o.licenseState && sameLicenseNumber(l.number, o.licenseNumber!)));
      facts.push(hit ? { license: "NPPES", nameMatches: namesMatch(o.name, `${hit.firstName ?? ""} ${hit.lastName ?? ""}`) } : { license: "NOT_FOUND", nameMatches: false });
    } catch {
      registryDown = true;
      facts.push({ license: null, nameMatches: false });
    }
  }
  return { facts, registryDown };
}

async function gatherFacts(orgId: string, input: VerificationInput, rule: StateOwnershipRule | null): Promise<VerificationFacts> {
  const org = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: orgId }, include: { locations: { where: { active: true }, orderBy: { createdAt: "asc" } } } });
  const loc = org.locations[0] ?? null;
  const owners = await ownerFacts(input.owners);
  let orgNpi: VerificationFacts["orgNpi"] = null;
  let registryDown = owners.registryDown;
  if (input.orgNpi) {
    try {
      const r = await nppesProvider().lookup?.(input.orgNpi);
      orgNpi = r && r.kind === "organization"
        ? { found: true, name: r.name, state: r.location?.state ?? null, zip: r.location?.zip ?? null, authorizedOfficial: r.authorizedOfficial ?? null }
        : { found: false, name: "", state: null, zip: null, authorizedOfficial: null };
    } catch {
      registryDown = true;
    }
  }
  // Same phone or street address as a suspended / deactivated clinic.
  const phones = [org.phone, ...org.locations.map((l) => l.phone)].filter((p): p is string => !!p).map((p) => p.replace(/\D/g, "").slice(-10)).filter((p) => p.length === 10);
  const blocked = await prisma.clinicOrg.findMany({
    where: { id: { not: orgId }, OR: [{ status: { in: ["SUSPENDED", "DEACTIVATED"] } }, { verificationStatus: "REJECTED" }] },
    select: { phone: true, locations: { select: { phone: true, addressLine1: true, zip: true } } },
  });
  const addr = (a: string, z: string) => `${a.toLowerCase().replace(/[^a-z0-9]/g, "")}|${z.slice(0, 5)}`;
  const mine = new Set(org.locations.map((l) => addr(l.addressLine1, l.zip)));
  const linkedToBlocked = blocked.some(
    (b) =>
      [b.phone, ...b.locations.map((l) => l.phone)].some((p) => p && phones.includes(p.replace(/\D/g, "").slice(-10))) ||
      b.locations.some((l) => mine.has(addr(l.addressLine1, l.zip))),
  );
  return { rule, locationState: loc?.state ?? null, locationZip: loc?.zip ?? null, orgNpi, registryDown, owners: owners.facts, linkedToBlocked };
}

function cleanInput(raw: VerificationInput): VerificationInput {
  const t = (s: string | null | undefined) => (s ?? "").trim();
  return {
    entityName: t(raw.entityName),
    entityState: t(raw.entityState).toUpperCase(),
    entityNumber: t(raw.entityNumber).toUpperCase(),
    orgNpi: t(raw.orgNpi).replace(/\D/g, "") || null,
    owners: raw.owners
      .filter((o) => t(o.name) || o.percent)
      .map((o) => ({
        name: t(o.name),
        percent: Number(o.percent),
        licensed: !!o.licensed,
        professionCode: o.licensed ? t(o.professionCode) || null : null,
        licenseState: o.licensed ? t(o.licenseState).toUpperCase() || null : null,
        licenseNumber: o.licensed ? t(o.licenseNumber).toUpperCase() || null : null,
        npi: t(o.npi).replace(/\D/g, "") || null,
      })),
    facilityLicenseNumber: t(raw.facilityLicenseNumber) || null,
    facilityExemptionNumber: t(raw.facilityExemptionNumber) || null,
    documentKeys: raw.documentKeys.filter(Boolean),
    documentsLater: !!raw.documentsLater,
    attestName: t(raw.attestName),
  };
}

/**
 * The clinic owner submits (or renews) verification. An admin can also enter it for a clinic that
 * couldn't (meta.clinicOrgId + meta.adminNote saying how the owner gave the details and confirmed
 * the statement); it then goes through the same checks.
 */
export async function submitVerification(actor: Actor, raw: VerificationInput, meta: { ip?: string | null; clinicOrgId?: string; adminNote?: string | null } = {}) {
  const byAdmin = actor.role === "PLATFORM_ADMIN";
  if (byAdmin && (!meta.clinicOrgId || !meta.adminNote?.trim())) throw new DomainError("VALIDATION", "Note how the owner gave you these details and confirmed the ownership statement (e.g. \"Phone call with Dr. Doe, Oct 9\").");
  const orgId = byAdmin ? meta.clinicOrgId! : requireClinic(actor, { ownerOnly: true });
  const s = await getSettings();
  const input = cleanInput(raw);
  const org = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: orgId }, include: { locations: { where: { active: true }, orderBy: { createdAt: "asc" }, take: 1 } } });
  if (org.verificationStatus === "REJECTED" && !byAdmin) throw new DomainError("FORBIDDEN", "Your clinic's verification was declined. Please contact us.");
  if (!org.locations.length) throw new DomainError("VALIDATION", "Add your clinic location first (Locations), then verify.");
  const rule = ruleFor(s, org.locations[0].state);
  const problems = verificationInputProblems(input, rule);
  if (problems.length) throw new DomainError("VALIDATION", problems.join(" "), { problems });
  const facts = await gatherFacts(orgId, input, rule);
  const checks = verificationChecks(input, facts);
  const auto = autoApprovable(checks);
  const now = clock.now();
  await prisma.clinicVerification.updateMany({ where: { clinicOrgId: orgId, status: { in: ["PENDING", "NEEDS_INFO"] } }, data: { status: "SUPERSEDED" } });
  const row = await prisma.clinicVerification.create({
    data: {
      clinicOrgId: orgId,
      entityName: input.entityName,
      entityState: input.entityState,
      entityNumber: input.entityNumber,
      orgNpi: input.orgNpi,
      owners: input.owners as unknown as Prisma.InputJsonValue,
      facilityLicenseNumber: input.facilityLicenseNumber,
      facilityExemptionNumber: input.facilityExemptionNumber,
      documentKeys: input.documentKeys,
      attestName: byAdmin ? `${input.attestName} (entered by an admin: ${meta.adminNote!.trim()})`.slice(0, 500) : input.attestName,
      attestText: ATTEST_TEXT,
      attestIp: byAdmin ? null : (meta.ip ?? null),
      submittedById: actor.userId,
      submittedAt: now,
      checks: checks as unknown as Prisma.InputJsonValue,
    },
  });
  await audit(prisma, actor, byAdmin ? "clinic.verification_entered_by_admin" : "clinic.verification_submitted", "ClinicVerification", row.id, null, { clinicOrgId: orgId, auto: auto.approve, note: meta.adminNote ?? null });
  if (auto.approve && s["clinicVerify.autoApprove"]) {
    await approve(SYSTEM, row.id, null, true);
    return { status: "VERIFIED" as const, autoApproved: true };
  }
  // A verified clinic renewing stays verified while its renewal is reviewed.
  const stillVerified = org.verificationStatus === "VERIFIED" && clinicCleared(clearFacts(org), now);
  if (!stillVerified) await prisma.clinicOrg.update({ where: { id: orgId }, data: { verificationStatus: "PENDING", verificationNote: null } });
  if (!byAdmin) await notifyAdmins(prisma, {
    template: "clinic_verification_review",
    title: `Clinic to verify: ${org.displayName}`,
    body: `${org.displayName} sent its ownership details. ${auto.reasons.length} item(s) need a look: ${auto.reasons.slice(0, 3).join(" ")}`.slice(0, 600),
    link: `/admin/verification/clinics/${row.id}`,
    ctaLabel: "Review",
  }).catch(() => undefined);
  return { status: stillVerified ? ("VERIFIED" as const) : ("PENDING" as const), autoApproved: false, verificationId: row.id };
}

async function openSubmission(id: string) {
  const row = await prisma.clinicVerification.findUnique({ where: { id } });
  if (!row) throw new DomainError("NOT_FOUND", "Verification not found");
  if (!["PENDING", "NEEDS_INFO"].includes(row.status)) throw new DomainError("CONFLICT", "This submission has already been decided.");
  return row;
}

/** Admin approves one item by hand (e.g. checked the license by phone), with how they checked. */
export async function approveCheck(actor: Actor, verificationId: string, key: string, note: string | null) {
  requireAdmin(actor);
  if (!note?.trim()) throw new DomainError("VALIDATION", "Note how you checked this item (kept with the record).");
  const row = await openSubmission(verificationId);
  const by = actor.userId ? ((await prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } }))?.name ?? "Admin") : "Admin";
  let checks: VerificationCheck[];
  try {
    checks = overrideCheck(row.checks as unknown as VerificationCheck[], key, by, note.trim(), clock.now());
  } catch {
    throw new DomainError("NOT_FOUND", "That item isn't on this submission.");
  }
  await prisma.clinicVerification.update({ where: { id: row.id }, data: { checks: checks as unknown as Prisma.InputJsonValue } });
  await audit(prisma, actor, "clinic.verification_item_approved", "ClinicVerification", row.id, null, { key, note: note.trim() });
  return { remaining: openChecks(checks).length };
}

/** Admin adds documents the clinic sent another way (email, fax). */
export async function addVerificationDocuments(actor: Actor, verificationId: string, keys: string[]) {
  requireAdmin(actor);
  if (!keys.length) throw new DomainError("VALIDATION", "Choose a file to upload.");
  const row = await openSubmission(verificationId);
  const bad = keys.find((k) => !k.startsWith(`clinics/${row.clinicOrgId}/`));
  if (bad) throw new DomainError("VALIDATION", "Upload the file to this clinic's folder.");
  await prisma.clinicVerification.update({ where: { id: row.id }, data: { documentKeys: [...row.documentKeys, ...keys] } });
  await audit(prisma, actor, "clinic.verification_documents_added", "ClinicVerification", row.id, null, { count: keys.length });
}

/** The form's prefill for an admin entering it for a clinic. */
export async function adminVerificationForm(actor: Actor, clinicOrgId: string) {
  requireAdmin(actor);
  const owner = await prisma.clinicMember.findFirst({ where: { clinicOrgId, role: "CLINIC_OWNER" }, select: { userId: true } });
  if (!owner) throw new DomainError("NOT_FOUND", "This clinic has no owner login.");
  const org = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: clinicOrgId }, select: { displayName: true } });
  return { org, form: await myVerification({ userId: owner.userId, role: "CLINIC_OWNER", clinicOrgId }) };
}

async function approve(actor: Actor, verificationId: string, note: string | null, auto = false) {
  const s = await getSettings();
  const now = clock.now();
  const row = await prisma.clinicVerification.findUniqueOrThrow({ where: { id: verificationId }, include: { clinicOrg: true } });
  const wasCleared = clinicCleared(clearFacts(row.clinicOrg), now);
  const until = new Date(+now + (s["clinicVerify.renewMonths"] * 30.44 + s["clinicVerify.graceDays"]) * DAY);
  await prisma.clinicVerification.update({ where: { id: row.id }, data: { status: "APPROVED", autoApproved: auto, decidedAt: now, decidedById: actor.userId, decisionNote: note } });
  await prisma.clinicOrg.update({ where: { id: row.clinicOrgId }, data: { verificationStatus: "VERIFIED", verifiedAt: now, verifiedUntil: until, verificationGraceUntil: null, verificationNote: null } });
  await audit(prisma, actor, "clinic.verified", "ClinicOrg", row.clinicOrgId, { verificationStatus: row.clinicOrg.verificationStatus }, { verificationStatus: "VERIFIED", auto, verifiedUntil: until });
  await notifyClinic(prisma, row.clinicOrgId, {
    template: "clinic_verified",
    title: "Your clinic is verified",
    body: wasCleared
      ? `Thanks. Your clinic's ownership details are verified through ${until.toLocaleDateString("en-US", { month: "long", year: "numeric" })}.`
      : "Thanks. Your clinic's ownership details are verified, and your posted shifts are now going out to providers.",
    link: "/clinic/settings/verification",
    email: true,
  }).catch(() => undefined);
  if (!wasCleared) await releaseHeldShifts(row.clinicOrgId);
}

/** Shifts posted while the clinic wasn't cleared go out now: fresh selection window, notices or dispatch. */
export async function releaseHeldShifts(clinicOrgId: string) {
  const s = await getSettings();
  const now = clock.now();
  const shifts = await prisma.shift.findMany({
    where: { location: { clinicOrgId }, status: { in: [...UNFILLED] }, postedAt: { not: null }, startsAt: { gt: now }, dispatches: { none: { status: "ACTIVE" } } },
    select: { id: true, startsAt: true, selectionDeadline: true, rateMode: true, releasedAt: true },
    orderBy: { startsAt: "asc" },
  });
  const { notifyEligibleProvidersOfShift } = await import("./shifts");
  const { startDispatch } = await import("./dispatch");
  for (const sh of shifts) {
    const held = sh.rateMode === "CLINIC" && !sh.releasedAt;
    if (!held && (!sh.selectionDeadline || sh.selectionDeadline <= now)) {
      await prisma.shift.update({ where: { id: sh.id }, data: { selectionDeadline: selectionDeadline(s["matching.deadlineTiers"], now, sh.startsAt).deadline } });
    }
    const tier = urgencyTier(now, sh.startsAt);
    if (!held && (tier === "SAME_DAY" || tier === "SHORT")) await startDispatch(sh.id, "URGENT_POST").catch((e) => console.error("release dispatch failed", sh.id, e));
    else await notifyEligibleProvidersOfShift(sh.id, "posted").catch((e) => console.error("release notice failed", sh.id, e));
  }
  return shifts.length;
}

// ---------------- admin ----------------

export async function listClinicVerifications(actor: Actor, filter: "open" | "all" = "open") {
  requireAdmin(actor);
  const now = clock.now();
  const rows = await prisma.clinicVerification.findMany({
    where: filter === "open" ? { status: { in: ["PENDING", "NEEDS_INFO"] } } : { status: { not: "SUPERSEDED" } },
    include: { clinicOrg: { select: { id: true, displayName: true, verificationStatus: true } } },
    orderBy: { submittedAt: filter === "open" ? "asc" : "desc" },
    take: 200,
  });
  // Clinics that haven't started, with their deadline.
  const notStarted = filter === "open"
    ? await prisma.clinicOrg.findMany({
        where: { verificationStatus: "NOT_STARTED", status: { in: ["ONBOARDING", "ACTIVE"] } },
        select: { id: true, displayName: true, verificationGraceUntil: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      })
    : [];
  return {
    rows: rows.map((r) => ({ ...r, checks: r.checks as unknown as VerificationCheck[] })),
    notStarted: notStarted.map((o) => ({ ...o, graceActive: !!o.verificationGraceUntil && o.verificationGraceUntil > now })),
  };
}

export async function clinicVerificationDetail(actor: Actor, id: string) {
  requireAdmin(actor);
  const s = await getSettings();
  const row = await prisma.clinicVerification.findUnique({
    where: { id },
    include: { clinicOrg: { include: { locations: { where: { active: true } }, members: { include: { user: { select: { email: true, name: true } } } } } } },
  });
  if (!row) throw new DomainError("NOT_FOUND", "Verification not found");
  const history = await prisma.clinicVerification.findMany({ where: { clinicOrgId: row.clinicOrgId, id: { not: id } }, orderBy: { submittedAt: "desc" }, select: { id: true, status: true, submittedAt: true, decidedAt: true, decisionNote: true, autoApproved: true } });
  return {
    row,
    owners: row.owners as unknown as OwnerInput[],
    checks: row.checks as unknown as VerificationCheck[],
    rule: ruleFor(s, row.clinicOrg.locations[0]?.state ?? row.entityState),
    history,
  };
}

/** Admin decision on a submission. NEEDS_INFO and REJECT need a note (the clinic sees it). */
export async function decideClinicVerification(actor: Actor, id: string, decision: "APPROVE" | "NEEDS_INFO" | "REJECT", note: string | null) {
  requireAdmin(actor);
  const row = await prisma.clinicVerification.findUnique({ where: { id }, include: { clinicOrg: true } });
  if (!row) throw new DomainError("NOT_FOUND", "Verification not found");
  if (!["PENDING", "NEEDS_INFO"].includes(row.status)) throw new DomainError("CONFLICT", "This submission has already been decided.");
  const text = note?.trim() || null;
  if (decision === "APPROVE") return approve(actor, id, text);
  if (!text) throw new DomainError("VALIDATION", decision === "REJECT" ? "Say why it's declined (the clinic sees this)." : "Say what the clinic needs to send (they see this).");
  const now = clock.now();
  const verifiedNow = row.clinicOrg.verificationStatus === "VERIFIED" && clinicCleared(clearFacts(row.clinicOrg), now);
  await prisma.clinicVerification.update({ where: { id }, data: { status: decision === "REJECT" ? "REJECTED" : "NEEDS_INFO", decidedAt: now, decidedById: actor.userId, decisionNote: text } });
  await prisma.clinicOrg.update({
    where: { id: row.clinicOrgId },
    data: decision === "REJECT" ? { verificationStatus: "REJECTED", verificationNote: text } : { verificationStatus: verifiedNow ? "VERIFIED" : "NEEDS_INFO", verificationNote: text },
  });
  await audit(prisma, actor, decision === "REJECT" ? "clinic.verification_rejected" : "clinic.verification_needs_info", "ClinicOrg", row.clinicOrgId, null, { note: text });
  await notifyClinic(prisma, row.clinicOrgId, {
    template: decision === "REJECT" ? "clinic_verification_rejected" : "clinic_verification_needs_info",
    title: decision === "REJECT" ? "We couldn't verify your clinic" : "We need a little more to verify your clinic",
    body: decision === "REJECT" ? `${text} Your shifts won't be shown to providers. If you think this is a mistake, reply to us.` : `${text} Update your details on the Verification page and send them again.`,
    link: "/clinic/settings/verification",
    email: true,
  }).catch(() => undefined);
}

/** Admin: verify a clinic they know without the form (logged), or give it more time. */
export async function adminSetClinicVerification(actor: Actor, clinicOrgId: string, action: "VERIFY" | "EXTEND" | "RESET", note: string | null) {
  requireAdmin(actor);
  const s = await getSettings();
  const now = clock.now();
  const org = await prisma.clinicOrg.findUnique({ where: { id: clinicOrgId } });
  if (!org) throw new DomainError("NOT_FOUND", "Clinic not found");
  const wasCleared = clinicCleared(clearFacts(org), now);
  if (action === "VERIFY") {
    if (!note?.trim()) throw new DomainError("VALIDATION", "Note how you verified this clinic (kept in the audit log).");
    const until = new Date(+now + (s["clinicVerify.renewMonths"] * 30.44 + s["clinicVerify.graceDays"]) * DAY);
    await prisma.clinicOrg.update({ where: { id: clinicOrgId }, data: { verificationStatus: "VERIFIED", verifiedAt: now, verifiedUntil: until, verificationGraceUntil: null, verificationNote: null } });
    await audit(prisma, actor, "clinic.verified_by_admin", "ClinicOrg", clinicOrgId, { verificationStatus: org.verificationStatus }, { verificationStatus: "VERIFIED", note: note.trim() });
    if (!wasCleared) await releaseHeldShifts(clinicOrgId);
    return;
  }
  if (action === "EXTEND") {
    const from = Math.max(+now, +(org.verificationGraceUntil ?? 0));
    const graceUntil = new Date(from + s["clinicVerify.graceDays"] * DAY);
    await prisma.clinicOrg.update({ where: { id: clinicOrgId }, data: { verificationGraceUntil: graceUntil, ...(org.verificationStatus === "REJECTED" ? { verificationStatus: "NOT_STARTED" } : {}) } });
    await audit(prisma, actor, "clinic.verification_extended", "ClinicOrg", clinicOrgId, { graceUntil: org.verificationGraceUntil }, { graceUntil, note });
    if (!wasCleared) await releaseHeldShifts(clinicOrgId);
    return;
  }
  // RESET: ask the clinic to verify again now (e.g. ownership changed).
  await prisma.clinicOrg.update({ where: { id: clinicOrgId }, data: { verificationStatus: "NOT_STARTED", verifiedUntil: null, verificationGraceUntil: null, verificationNote: note?.trim() || null } });
  await audit(prisma, actor, "clinic.verification_reset", "ClinicOrg", clinicOrgId, { verificationStatus: org.verificationStatus }, { verificationStatus: "NOT_STARTED", note });
  await notifyClinic(prisma, clinicOrgId, {
    template: "clinic_verification_needs_info",
    title: "Please verify your clinic again",
    body: `${note?.trim() ? `${note.trim()} ` : ""}Your shifts will go out to providers again once you've confirmed your clinic's ownership details.`,
    link: "/clinic/settings/verification",
    email: true,
  }).catch(() => undefined);
}

// ---------------- daily sweep ----------------

/** Reminders before a clinic's deadline (grace or renewal), and one notice when it lapses. */
export async function clinicVerifySweep(now = clock.now()) {
  const s = await getSettings();
  const out = { reminded: 0, lapsed: 0 };
  if (!s["clinicVerify.enabled"]) return out;
  const days = s["clinicVerify.reminderDays"];
  const horizon = new Date(+now + Math.max(0, ...days) * DAY);
  const orgs = await prisma.clinicOrg.findMany({
    where: {
      status: { in: ["ONBOARDING", "ACTIVE"] },
      verificationStatus: { not: "REJECTED" },
      OR: [{ verificationGraceUntil: { gt: new Date(+now - 2 * DAY), lte: horizon } }, { verificationStatus: "VERIFIED", verifiedUntil: { gt: new Date(+now - 2 * DAY), lte: horizon } }],
    },
    include: { verifications: { where: { status: "PENDING" }, take: 1 }, members: { where: { role: "CLINIC_OWNER" }, take: 1 } },
  });
  for (const o of orgs) {
    if (o.verifications.length) continue; // waiting on us
    const f = clearFacts(o);
    const userId = o.members[0]?.userId ?? null;
    const dateOf = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric" });
    const deadline = clinicVerifyDeadline(f, now);
    if (!deadline) {
      // Lapsed in the last two days: tell them once.
      const lapsedAt = [o.verificationGraceUntil, o.verificationStatus === "VERIFIED" ? o.verifiedUntil : null].filter((d): d is Date => !!d && d <= now).sort((a, b) => +b - +a)[0];
      if (!lapsedAt || clinicCleared(f, now)) continue;
      const claimed = await prisma.digestSend.createMany({ data: [{ key: `clinicverify-lapsed:${o.id}:${lapsedAt.toISOString().slice(0, 10)}`, userId }], skipDuplicates: true });
      if (!claimed.count) continue;
      await notifyClinic(prisma, o.id, {
        template: "clinic_verification_lapsed",
        title: "Your shifts are paused until your clinic is verified",
        body: "New and open shifts aren't being shown to providers until you confirm your clinic's ownership details. Your booked shifts aren't affected. It takes a few minutes.",
        link: "/clinic/settings/verification",
        email: true,
        sms: true,
      }).catch(() => undefined);
      out.lapsed++;
      continue;
    }
    const i = verifyReminderDue(deadline, now, days);
    if (i === null) continue;
    const claimed = await prisma.digestSend.createMany({ data: [{ key: `clinicverify:${o.id}:${deadline.toISOString().slice(0, 10)}:${i}`, userId }], skipDuplicates: true });
    if (!claimed.count) continue;
    const renewing = o.verificationStatus === "VERIFIED";
    await notifyClinic(prisma, o.id, {
      template: "clinic_verification_reminder",
      title: renewing ? `Time to renew your clinic verification (by ${dateOf(deadline)})` : `Please verify your clinic by ${dateOf(deadline)}`,
      body: `${brand().name} confirms who owns each clinic on the platform, to protect providers and patients. ${renewing ? "Your yearly renewal is due" : "Please confirm your clinic's ownership details"} by ${dateOf(deadline)} so your shifts keep going out to providers. It takes a few minutes.`,
      link: "/clinic/settings/verification",
      email: true,
    }).catch(() => undefined);
    out.reminded++;
  }
  return out;
}

/** State license check (boardcheck.ts): owners of clinics listed in the state's file who aren't active → admin task. */
export async function checkClinicOwnersInBoardFile(found: (numbers: string[]) => Map<string, { status: string }>, state: string, professionCode: string, verdict: (status: string) => "ACTIVE" | "REVIEW" | "INACTIVE") {
  const rows = await prisma.clinicVerification.findMany({
    where: { status: "APPROVED", clinicOrg: { verificationStatus: "VERIFIED" } },
    select: { id: true, clinicOrgId: true, owners: true, clinicOrg: { select: { displayName: true } } },
    orderBy: { submittedAt: "desc" },
  });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.clinicOrgId)) latest.set(r.clinicOrgId, r);
  const wanted: { org: string; orgId: string; owner: string; number: string }[] = [];
  for (const r of latest.values()) {
    for (const o of r.owners as unknown as OwnerInput[]) {
      if (o.licensed && o.licenseState === state && o.professionCode === professionCode && o.licenseNumber) wanted.push({ org: r.clinicOrg.displayName, orgId: r.clinicOrgId, owner: o.name, number: o.licenseNumber });
    }
  }
  if (!wanted.length) return { checked: 0, problems: 0 };
  const map = found(wanted.map((w) => w.number));
  let problems = 0;
  for (const w of wanted) {
    const row = map.get(w.number);
    const v = row ? verdict(row.status) : "REVIEW";
    if (v === "ACTIVE") continue;
    problems++;
    const title = `${w.org}: owner ${w.owner}'s ${state} license ${w.number} ${row ? `shows "${row.status}"` : "isn't in the state's file"}. Check the clinic's ownership`;
    const open = await prisma.adminTask.findFirst({ where: { kind: "CLINIC_OWNER_LICENSE", entityId: w.orgId, resolvedAt: null, title } });
    if (!open) await prisma.adminTask.create({ data: { kind: "CLINIC_OWNER_LICENSE", title, entityType: "ClinicOrg", entityId: w.orgId } });
  }
  return { checked: wanted.length, problems };
}
