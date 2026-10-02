import { brand, env, validateSetting, SETTINGS } from "@cm/config";
import { DomainError, NATIONAL_CREDENTIAL, nextReverifyAt, US_STATES } from "@cm/core";
import { prisma, type Prisma } from "@cm/db";
import { checkGoogleServerKey, mailProvider, smsProvider, TWILIO_ERROR_HELP } from "@cm/integrations";
import { audit, getSettings, invalidateSettings, requireAdmin, type Actor } from "./context";
import { notify, sendEmail } from "./notify";
import { recomputeProviderStatus } from "./onboarding";
import { ensureSchools } from "./schools";

// ======================================================================
// Verification queue (SPEC §4.3, admin-assisted)
// ======================================================================

export async function verificationQueue(actor: Actor) {
  requireAdmin(actor);
  const [licenses, policies, certs, npi] = await Promise.all([
    prisma.license.findMany({ where: { status: "PENDING_VERIFICATION" }, include: { provider: { select: { id: true, displayName: true, legalName: true, npi: true, preLicensure: true } }, profession: true }, orderBy: { createdAt: "asc" } }),
    prisma.malpracticePolicy.findMany({ where: { status: "PENDING_VERIFICATION" }, include: { provider: { select: { id: true, displayName: true, legalName: true, preLicensure: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.providerSkill.findMany({ where: { certificationStatus: "PENDING_VERIFICATION" }, include: { provider: { select: { id: true, displayName: true } }, skill: true } }),
    prisma.provider.findMany({ where: { npiMismatch: true, npiVerifiedAt: null }, select: { id: true, displayName: true, legalName: true, npi: true } }),
  ]);
  const boards = await prisma.professionStateConfig.findMany({ where: { boardLookupUrl: { not: null } } });
  const stateBoards = await prisma.stateConfig.findMany({ where: { boardLookupUrl: { not: null } } });
  const boardUrl = (prof: string, state: string) =>
    boards.find((b) => b.professionCode === prof && b.state === state)?.boardLookupUrl ?? stateBoards.find((s) => s.state === state)?.boardLookupUrl ?? null;
  return { licenses: licenses.map((l) => ({ ...l, boardLookupUrl: boardUrl(l.professionCode, l.state) })), policies, certs, npi };
}

export async function reviewLicense(actor: Actor, licenseId: string, input: { approve: boolean; expiresAt?: Date; evidenceUrl?: string | null; reason?: string | null; method?: string }) {
  requireAdmin(actor);
  const l = await prisma.license.findUniqueOrThrow({ where: { id: licenseId }, include: { provider: true } });
  const now = new Date();
  const expiresAt = input.expiresAt ?? l.expiresAt;
  const updated = await prisma.license.update({
    where: { id: licenseId },
    data: input.approve
      ? { status: "VERIFIED", verifiedById: actor.userId, verifiedAt: now, verificationMethod: input.method ?? "board-lookup", verificationEvidenceUrl: input.evidenceUrl ?? null, expiresAt, nextReverifyAt: nextReverifyAt(now, expiresAt), rejectionReason: null }
      : { status: "REJECTED", rejectionReason: input.reason?.slice(0, 300) || "Could not verify", verifiedById: actor.userId, verifiedAt: now },
  });
  await audit(prisma, actor, input.approve ? "license.verified" : "license.rejected", "License", licenseId, { status: l.status }, { status: updated.status, expiresAt, reason: input.reason });
  await prisma.adminTask.updateMany({ where: { kind: "REVERIFY", entityId: licenseId, resolvedAt: null }, data: { resolvedAt: now, resolvedById: actor.userId } });
  await recomputeProviderStatus(l.providerId);
  const profession = await prisma.profession.findUnique({ where: { code: l.professionCode } });
  const credName =
    l.state === NATIONAL_CREDENTIAL
      ? `${profession?.displayName ?? l.professionCode} national registry credential`
      : `${US_STATES[l.state] ?? l.state} ${(profession?.displayName ?? l.professionCode).toLowerCase()} license`;
  const providerReady = (await prisma.digestSend.count({ where: { key: { startsWith: `ready:${l.providerId}:` } } })) > 0;
  // Students: say exactly what's next (scope copy). Read before recompute may have graduated them out.
  const studentNeedsMalpractice =
    input.approve && l.provider.preLicensure && !(await prisma.malpracticePolicy.count({ where: { providerId: l.providerId, status: "VERIFIED", expiresAt: { gt: now } } }));
  await notify(prisma, l.provider.userId, {
    template: input.approve ? "license_verified" : "license_rejected",
    title: input.approve ? `Your ${credName} is verified` : `We couldn't verify your ${credName}`,
    body: input.approve
      ? studentNeedsMalpractice
        ? "Your chiropractic license has been received and verified. Add your malpractice insurance to complete your coverage eligibility."
        : `We've confirmed it's active and marked it verified on your profile.${providerReady ? "" : " Finish the remaining setup steps on your dashboard and we'll let you know when you can start taking shifts."}`
      : (input.reason ?? "Please check the details and resubmit."),
    link: "/provider/credentials",
  });
}

export async function reviewMalpractice(actor: Actor, id: string, input: { approve: boolean; reason?: string | null }) {
  requireAdmin(actor);
  const m = await prisma.malpracticePolicy.findUniqueOrThrow({ where: { id }, include: { provider: true } });
  await prisma.malpracticePolicy.update({
    where: { id },
    data: input.approve ? { status: "VERIFIED", verifiedAt: new Date(), verifiedById: actor.userId, rejectionReason: null } : { status: "REJECTED", rejectionReason: input.reason?.slice(0, 300) || "Could not verify" },
  });
  await audit(prisma, actor, input.approve ? "malpractice.verified" : "malpractice.rejected", "MalpracticePolicy", id, { status: m.status }, input);
  await recomputeProviderStatus(m.providerId);
  await notify(prisma, m.provider.userId, {
    template: "malpractice_reviewed",
    title: input.approve ? "Your malpractice policy is verified" : "We couldn't verify your malpractice policy",
    body: input.approve ? "We've marked it verified on your profile for the professions listed on the policy." : (input.reason ?? "Please upload a current certificate of insurance."),
    link: "/provider/credentials",
  });
}

export async function reviewCertification(actor: Actor, providerId: string, skillId: string, input: { approve: boolean; expiresAt?: Date | null }) {
  requireAdmin(actor);
  await prisma.providerSkill.update({
    where: { providerId_skillId: { providerId, skillId } },
    data: input.approve
      ? { certificationStatus: "VERIFIED", certificationVerifiedAt: new Date(), certificationVerifiedById: actor.userId, ...(input.expiresAt ? { certificationExpiresAt: input.expiresAt } : {}) }
      : { certificationStatus: "REJECTED" },
  });
  await audit(prisma, actor, input.approve ? "certification.verified" : "certification.rejected", "ProviderSkill", `${providerId}:${skillId}`);
}

export async function resolveNpi(actor: Actor, providerId: string, approve: boolean) {
  requireAdmin(actor);
  await prisma.provider.update({ where: { id: providerId }, data: approve ? { npiVerifiedAt: new Date(), npiMismatch: false } : { npi: null, npiMismatch: false } });
  await audit(prisma, actor, approve ? "npi.approved" : "npi.rejected", "Provider", providerId);
  await recomputeProviderStatus(providerId);
}

// ======================================================================
// State × profession matrix (SPEC §14, Addendum 01 §3.2 / §11)
// ======================================================================

export async function stateMatrix(actor: Actor) {
  requireAdmin(actor);
  const [states, professions, pscs, regions, verified] = await Promise.all([
    prisma.stateConfig.findMany({ orderBy: { state: "asc" } }),
    prisma.profession.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.professionStateConfig.findMany(),
    prisma.rateRegion.findMany({ include: { rateCards: { where: { effectiveTo: null } } } }),
    prisma.license.groupBy({ by: ["professionCode", "state"], where: { status: "VERIFIED", expiresAt: { gt: new Date() } }, _count: true }),
  ]);
  const cells = states.map((st) => ({
    state: st,
    cells: professions.map((p) => {
      const psc = pscs.find((x) => x.professionCode === p.code && x.state === st.state) ?? null;
      const checklist = pairChecklist(p, psc, st, regions);
      const ready = Object.values(checklist).every(Boolean);
      return {
        professionCode: p.code,
        psc,
        checklist,
        verifiedProviders: verified.find((v) => v.professionCode === p.code && v.state === st.state)?._count ?? 0,
        status: psc?.enabled ? "ENABLED" : ready ? "READY" : "DISABLED",
      };
    }),
  }));
  return { professions, rows: cells };
}

type Region = Awaited<ReturnType<typeof prisma.rateRegion.findMany<{ include: { rateCards: true } }>>>[number];

function pairChecklist(
  p: { code: string; pricingModel: "TIERED" | "HOURLY" },
  psc: { legalReviewComplete: boolean; licensedAtStateLevel: boolean; alternativeCredentialAllowed: boolean; boardLookupUrl: string | null; supervisionRequired: boolean | null; supervisingProfessionCodes: string[] } | null,
  st: { enabled: boolean; state: string },
  regions: Region[],
) {
  const stateRegions = regions.filter((r) => r.state === st.state);
  const tiers = p.pricingModel === "HOURLY" ? ["HOURLY"] : ["HALF_DAY", "FULL_DAY"];
  return {
    stateEnabled: st.enabled,
    legalReview: !!psc?.legalReviewComplete,
    stateLicensed: !!psc && (psc.licensedAtStateLevel || psc.alternativeCredentialAllowed),
    boardLookupUrl: !!psc?.boardLookupUrl,
    supervisionConfigured: psc?.supervisionRequired !== null && psc?.supervisionRequired !== undefined && (!psc.supervisionRequired || psc.supervisingProfessionCodes.length > 0),
    rateCards: stateRegions.length > 0 && stateRegions.every((r) => tiers.every((t) => r.rateCards.some((c) => c.professionCode === p.code && c.durationTier === t))),
  };
}

export async function updateStateConfig(
  actor: Actor,
  state: string,
  patch: Partial<{ legalReviewComplete: boolean; legalReviewNotes: string; contractorModelNotes: string; staffingRegistrationRequired: boolean; salesTaxOnStaffing: boolean; boardLookupUrl: string | null; defaultRateRegionId: string | null; enabled: boolean }>,
) {
  requireAdmin(actor);
  const before = await prisma.stateConfig.findUniqueOrThrow({ where: { state } });
  const next = { ...before, ...patch };
  if (patch.enabled) {
    const regions = await prisma.rateRegion.findMany({ where: { state }, include: { rateCards: { where: { effectiveTo: null } } } });
    if (!next.legalReviewComplete) throw new DomainError("VALIDATION", "Mark legal review complete before enabling the state.");
    if (!next.boardLookupUrl) throw new DomainError("VALIDATION", "Add the board lookup URL before enabling the state.");
    if (!regions.length) throw new DomainError("VALIDATION", "Create at least one rate region (with rate cards) before enabling the state.");
  }
  const updated = await prisma.stateConfig.update({
    where: { state },
    data: { ...patch, ...(patch.enabled === true && !before.enabled ? { enabledAt: new Date(), enabledById: actor.userId } : {}) },
  });
  await audit(prisma, actor, patch.enabled !== undefined && patch.enabled !== before.enabled ? (patch.enabled ? "state.enabled" : "state.disabled") : "state.updated", "StateConfig", state, before, updated);
  let affected: { id: string }[] = [];
  if (patch.enabled === false && before.enabled) {
    // Disabling blocks new postings but does not cancel confirmed work; give the admin the list.
    affected = await prisma.assignment.findMany({ where: { state, status: { in: ["CONFIRMED", "IN_PROGRESS"] } }, select: { id: true } });
  }
  return { updated, confirmedAssignmentsToReview: affected.map((a) => a.id) };
}

/**
 * Sends a test text and reports exactly what happened: missing settings,
 * Twilio's rejection, or — since Twilio accepts first and delivers later —
 * the delivery result a few seconds on (where registration problems show up).
 */
export async function sendTestText(actor: Actor, toRaw: string) {
  requireAdmin(actor);
  const e = env();
  const missing: string[] = (["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"] as const).filter((k) => !e[k]);
  if (!e.TWILIO_MESSAGING_SERVICE_SID && !e.TWILIO_FROM_NUMBER) missing.push("TWILIO_FROM_NUMBER (or TWILIO_MESSAGING_SERVICE_SID)");
  if (missing.length) throw new DomainError("VALIDATION", `Texting is off — the site is in email-only mode (text alerts go by email). To turn texting on, set ${missing.join(", ")} in cPanel → Setup Node.js App → Environment variables, then restart the app.`);
  const shape: string[] = [];
  if (!e.TWILIO_ACCOUNT_SID!.startsWith("AC")) shape.push("TWILIO_ACCOUNT_SID should start with AC");
  if (e.TWILIO_MESSAGING_SERVICE_SID && !e.TWILIO_MESSAGING_SERVICE_SID.startsWith("MG")) shape.push("TWILIO_MESSAGING_SERVICE_SID should start with MG (a Messaging Service SID, not a phone number) — or remove it and use TWILIO_FROM_NUMBER");
  if (!e.TWILIO_MESSAGING_SERVICE_SID && !/^\+1\d{10}$/.test(e.TWILIO_FROM_NUMBER!.replace(/[\s()-]/g, ""))) shape.push("TWILIO_FROM_NUMBER should be your Twilio number like +14075550123");
  if (shape.length) throw new DomainError("VALIDATION", `Check your Twilio settings: ${shape.join("; ")}.`);
  const digits = toRaw.replace(/\D/g, "");
  const to = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : null;
  if (!to) throw new DomainError("VALIDATION", "Enter a 10-digit US mobile number.");
  const sms = smsProvider();
  if (!(await sms.send(to, `${brand().name} test text — texting works.`))) {
    const help = sms.lastErrorCode ? TWILIO_ERROR_HELP[sms.lastErrorCode] : null;
    throw new DomainError("VALIDATION", `${sms.lastError ?? "Twilio rejected the text."}${help ? ` — ${help}` : ""}`);
  }
  // Accepted; now watch delivery for up to ~12 seconds.
  let last: Awaited<ReturnType<NonNullable<typeof sms.status>>> = null;
  for (let i = 0; i < 6 && sms.lastId && sms.status; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    last = await sms.status(sms.lastId);
    if (last && ["delivered", "undelivered", "failed"].includes(last.status)) break;
  }
  if (last?.status === "delivered") return `Delivered to ${to}. Texting works.`;
  if (last && (last.status === "undelivered" || last.status === "failed")) {
    const help = last.errorCode ? TWILIO_ERROR_HELP[last.errorCode] : null;
    throw new DomainError("VALIDATION", `Twilio accepted the text but it was ${last.status}${last.errorCode ? ` (error ${last.errorCode})` : ""}. ${help ?? last.errorMessage ?? ""}`.trim());
  }
  return `Twilio accepted the text (status: ${last?.status ?? "queued"}). If it doesn't arrive within a minute, open Twilio Console → Monitor → Logs → Messaging to see why — or run this check again.`;
}

/** Tests the server Maps key against each API it needs and explains the usual fixes. */
export async function checkGoogle(actor: Actor) {
  requireAdmin(actor);
  const key = env().GOOGLE_MAPS_API_KEY;
  if (!key) throw new DomainError("VALIDATION", "GOOGLE_MAPS_API_KEY isn't set (the site uses a stand-in address lookup). Add it in cPanel → Setup Node.js App → Environment variables, then restart the app.");
  const results = await checkGoogleServerKey(key);
  const lines = results.map((r) => `${r.ok ? "✓" : "✗"} ${r.api}: ${r.detail}`);
  if (results.every((r) => r.ok)) return `Server key works. ${lines.join(" · ")}`;
  const all = results.map((r) => r.detail).join(" ");
  const hint = /referer|referrer/i.test(all)
    ? "This key has a Websites restriction — set Application restrictions to None for the server key."
    : /not authorized to use this API|not been used in project|is disabled|SERVICE_DISABLED|API_KEY_SERVICE_BLOCKED/i.test(all)
      ? "An API is either not enabled (APIs & Services → Library) or not ticked in this key's API restrictions."
      : /IP address|not authorized/i.test(all)
        ? "The key's IP-address restriction doesn't match your server. Set Application restrictions to None."
        : /billing/i.test(all)
          ? "Billing isn't enabled for this Google Cloud project."
          : /invalid/i.test(all)
            ? "The key itself isn't valid — re-copy it into GOOGLE_MAPS_API_KEY and restart."
            : "";
  throw new DomainError("VALIDATION", `${lines.join(" · ")}${hint ? ` — Fix: ${hint}` : ""}`);
}

/** Sends a test email and reports exactly what the email service said. */
export async function sendTestEmail(actor: Actor, to: string) {
  requireAdmin(actor);
  const mailer = mailProvider();
  const ok = await sendEmail(to, {
    subject: `${brand().name} test email`,
    heading: "Email is working",
    paragraphs: [`This test was sent from ${brand().domain} via ${mailer.name}. Signup confirmations, booking emails and notifications use the same path.`],
  });
  if (mailer.name !== "sendgrid") {
    throw new DomainError("VALIDATION", "SENDGRID_API_KEY isn't set, so email is only written to the server's outbox log. Add the key in Setup Node.js App → Environment variables and restart.");
  }
  if (!ok) throw new DomainError("VALIDATION", mailer.lastError ?? "The email service rejected the message.");
  return `Sent to ${to} from ${brand().emailFrom}. If it doesn't arrive in a few minutes, check spam.`;
}

export async function updateProfessionState(
  actor: Actor,
  professionCode: string,
  state: string,
  patch: Partial<{
    enabled: boolean;
    legalReviewComplete: boolean;
    legalReviewNotes: string | null;
    licensedAtStateLevel: boolean;
    alternativeCredentialAllowed: boolean;
    alternativeCredentialPolicy: string | null;
    credentialTitle: string | null;
    boardLookupUrl: string | null;
    supervisionRequired: boolean;
    supervisingProfessionCodes: string[];
    supervisionNotes: string | null;
    malpracticeMinOccurrenceCents: number | null;
    malpracticeMinAggregateCents: number | null;
    scopeNotes: string | null;
  }>,
) {
  requireAdmin(actor);
  const profession = await prisma.profession.findUniqueOrThrow({ where: { code: professionCode } });
  const before = await prisma.professionStateConfig.findUnique({ where: { professionCode_state: { professionCode, state } } });
  // A5: a national registry credential is the minimum only where the state issues no license.
  if ((patch.alternativeCredentialAllowed ?? before?.alternativeCredentialAllowed) && (patch.licensedAtStateLevel ?? before?.licensedAtStateLevel ?? true)) {
    throw new DomainError("VALIDATION", "National registry credentials can only be accepted where the state doesn't license this profession. Untick \"Licensed at the state level\" first, or turn off national credentials.");
  }
  // Resolve profession-level minimums into the row so the DB trigger reads one place (Addendum §5.4).
  const resolved = {
    malpracticeMinOccurrenceCents: patch.malpracticeMinOccurrenceCents ?? before?.malpracticeMinOccurrenceCents ?? profession.defaultMalpracticeMinOccurrenceCents,
    malpracticeMinAggregateCents: patch.malpracticeMinAggregateCents ?? before?.malpracticeMinAggregateCents ?? profession.defaultMalpracticeMinAggregateCents,
  };
  if (patch.enabled) {
    const [st, regions] = await Promise.all([
      prisma.stateConfig.findUniqueOrThrow({ where: { state } }),
      prisma.rateRegion.findMany({ where: { state }, include: { rateCards: { where: { effectiveTo: null } } } }),
    ]);
    const next = { ...before, ...patch } as NonNullable<typeof before>;
    const check = pairChecklist(profession, next, st, regions);
    const missing = Object.entries(check).filter(([, ok]) => !ok).map(([k]) => k);
    if (missing.length) throw new DomainError("VALIDATION", `Checklist incomplete: ${missing.join(", ")}`, { missing });
  }
  const data = { ...patch, ...resolved, ...(patch.enabled === true && !before?.enabled ? { enabledAt: new Date(), enabledById: actor.userId } : {}) };
  // Not an upsert: Postgres checks psc_enable_checklist against the proposed
  // insert row (all defaults) before it detects the conflict.
  const updated = before
    ? await prisma.professionStateConfig.update({ where: { professionCode_state: { professionCode, state } }, data })
    : await prisma.professionStateConfig.create({ data: { professionCode, state, ...data } });
  // A profession is "live" (public pages, signup) while any state has it enabled.
  if (patch.enabled !== undefined && patch.enabled !== before?.enabled) {
    const live = patch.enabled || (await prisma.professionStateConfig.count({ where: { professionCode, enabled: true } })) > 0;
    if (live !== profession.active) await prisma.profession.update({ where: { code: professionCode }, data: { active: live } });
  }
  // Turning a profession on adds its built-in school list to the student sign-up dropdown.
  if (patch.enabled) await ensureSchools([professionCode]);
  await audit(prisma, actor, patch.enabled !== undefined && patch.enabled !== before?.enabled ? (patch.enabled ? "profession_state.enabled" : "profession_state.disabled") : "profession_state.updated", "ProfessionStateConfig", `${professionCode}:${state}`, before, updated);
  return updated;
}

export async function setSkillStateRule(actor: Actor, skillId: string, professionCode: string, state: string, allowed: boolean, notes?: string) {
  requireAdmin(actor);
  const r = await prisma.skillStateRule.upsert({
    where: { skillId_professionCode_state: { skillId, professionCode, state } },
    create: { skillId, professionCode, state, allowed, notes },
    update: { allowed, notes },
  });
  await audit(prisma, actor, "skill_rule.set", "SkillStateRule", `${skillId}:${professionCode}:${state}`, null, r);
}

// ======================================================================
// Rates (INV-7: only admins set rates; every change is audit-logged)
// ======================================================================

export async function ratesOverview(actor: Actor, state?: string) {
  requireAdmin(actor);
  return prisma.rateRegion.findMany({
    where: state ? { state } : {},
    include: { rateCards: { orderBy: [{ professionCode: "asc" }, { durationTier: "asc" }, { effectiveFrom: "desc" }] } },
    orderBy: [{ state: "asc" }, { name: "asc" }],
  });
}

export async function saveRateRegion(actor: Actor, input: { id?: string; state: string; name: string; tier: number; zip3List: string[] }) {
  requireAdmin(actor);
  const zips = [...new Set(input.zip3List.map((z) => z.trim()).filter((z) => /^\d{3}$/.test(z)))];
  const clash = await prisma.rateRegion.findFirst({ where: { state: input.state, id: input.id ? { not: input.id } : undefined, zip3List: { hasSome: zips } } });
  if (clash) throw new DomainError("CONFLICT", `Some ZIP3s are already mapped to ${clash.name}.`);
  const data = { state: input.state.toUpperCase(), name: input.name.trim(), tier: input.tier, zip3List: zips };
  const r = input.id ? await prisma.rateRegion.update({ where: { id: input.id }, data }) : await prisma.rateRegion.create({ data });
  await audit(prisma, actor, "rate_region.saved", "RateRegion", r.id, null, r);
  // Newly mapped ZIPs resolve their pending admin tasks.
  await prisma.adminTask.updateMany({ where: { kind: "UNMAPPED_ZIP3", entityId: { in: zips.map((z) => `${data.state}:${z}`) }, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: actor.userId } });
  return r;
}

/** New effective-dated card; closes the previous one. Existing shifts keep their priced snapshot. */
export async function setRateCard(actor: Actor, input: { rateRegionId: string; professionCode: string; durationTier: "HALF_DAY" | "FULL_DAY" | "HOURLY"; volumeTier?: "LIGHT" | "BUSY" | null; clinicPriceCents: number; providerPayCents: number; minHours?: number | null; effectiveFrom?: Date }) {
  requireAdmin(actor);
  if (input.providerPayCents > input.clinicPriceCents) throw new DomainError("VALIDATION", "Provider pay can't exceed the clinic price.");
  if (input.clinicPriceCents <= 0 || input.providerPayCents <= 0) throw new DomainError("VALIDATION", "Enter positive amounts.");
  const prof = await prisma.profession.findUniqueOrThrow({ where: { code: input.professionCode } });
  if ((prof.pricingModel === "HOURLY") !== (input.durationTier === "HOURLY")) throw new DomainError("VALIDATION", `${prof.displayName} is priced ${prof.pricingModel.toLowerCase()}.`);
  const volumeTier = input.volumeTier ?? null;
  if (volumeTier && input.durationTier === "HOURLY") throw new DomainError("VALIDATION", "Light / Busy tiers apply to half and full days only.");
  const from = input.effectiveFrom ?? new Date();
  const card = await prisma.$transaction(async (db) => {
    await db.rateCard.updateMany({ where: { rateRegionId: input.rateRegionId, professionCode: input.professionCode, durationTier: input.durationTier, volumeTier, effectiveTo: null }, data: { effectiveTo: from } });
    const created = await db.rateCard.create({
      data: { rateRegionId: input.rateRegionId, professionCode: input.professionCode, durationTier: input.durationTier, volumeTier, clinicPriceCents: input.clinicPriceCents, providerPayCents: input.providerPayCents, minHours: input.minHours ?? null, effectiveFrom: from },
    });
    // A Light day must stay cheaper than a Busy day in the same region and length.
    if (volumeTier) {
      const other = await db.rateCard.findFirst({ where: { rateRegionId: input.rateRegionId, professionCode: input.professionCode, durationTier: input.durationTier, volumeTier: volumeTier === "LIGHT" ? "BUSY" : "LIGHT", effectiveTo: null } });
      if (other) {
        const [light, busy] = volumeTier === "LIGHT" ? [created, other] : [other, created];
        if (light.clinicPriceCents >= busy.clinicPriceCents) throw new DomainError("VALIDATION", "A Light day must cost the clinic less than a Busy day.");
      }
    }
    return created;
  });
  await audit(prisma, actor, "rate_card.set", "RateCard", card.id, null, card);
  return card;
}

/** Admin reprice of a not-yet-confirmed shift (INV-7 override, logged). */
export async function repriceShift(actor: Actor, shiftId: string, input: { clinicPriceCents: number; providerPayCents: number; reason: string }) {
  requireAdmin(actor);
  const s = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
  if (!["DRAFT", "OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING"].includes(s.status)) throw new DomainError("CONFLICT", "Only unfilled shifts can be repriced.");
  if (!input.reason.trim()) throw new DomainError("VALIDATION", "Give a reason for the override.");
  const discount = Math.min(s.promoDiscountCents, Math.max(0, input.clinicPriceCents - input.providerPayCents));
  const updated = await prisma.shift.update({ where: { id: shiftId }, data: { clinicPriceCents: input.clinicPriceCents, providerPayCents: input.providerPayCents, promoDiscountCents: discount } });
  await audit(prisma, actor, "shift.repriced", "Shift", shiftId, { clinicPriceCents: s.clinicPriceCents, providerPayCents: s.providerPayCents }, { ...input, promoDiscountCents: discount });
  return updated;
}

// ======================================================================
// Settings
// ======================================================================

export async function settingsView(actor: Actor) {
  requireAdmin(actor);
  const values = await getSettings(undefined, true);
  return Object.entries(SETTINGS).map(([key, d]) => ({ key, group: d.group, label: d.label, help: d.help ?? null, flag: d.flag, value: values[key as keyof typeof values], default: d.default }));
}

export async function updateSetting(actor: Actor, key: string, value: unknown) {
  requireAdmin(actor);
  const v = validateSetting(key, value);
  if (!v.ok) throw new DomainError("VALIDATION", v.error);
  const before = await prisma.setting.findUnique({ where: { key } });
  await prisma.setting.upsert({ where: { key }, create: { key, value: v.value as Prisma.InputJsonValue, updatedById: actor.userId }, update: { value: v.value as Prisma.InputJsonValue, updatedById: actor.userId } });
  invalidateSettings();
  await audit(prisma, actor, "setting.updated", "Setting", key, before?.value, v.value);
}

// ======================================================================
// Users, tasks, audit
// ======================================================================

export async function setProviderStatus(actor: Actor, providerId: string, status: "ACTIVE" | "PAUSED" | "SUSPENDED" | "DEACTIVATED", note?: string) {
  requireAdmin(actor);
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: providerId } });
  await prisma.provider.update({ where: { id: providerId }, data: { status, ...(note ? { adminNotes: [p.adminNotes, `${new Date().toISOString().slice(0, 10)}: ${note}`].filter(Boolean).join("\n") } : {}) } });
  await audit(prisma, actor, "provider.status", "Provider", providerId, { status: p.status }, { status, note });
}

/**
 * Push a provider through onboarding now. Their dashboard still lists any
 * unfinished steps; matching still requires verified credentials and payouts.
 */
export async function approveProvider(actor: Actor, providerId: string, approve = true) {
  requireAdmin(actor);
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: providerId } });
  await prisma.provider.update({ where: { id: providerId }, data: approve ? { adminApprovedAt: new Date(), adminApprovedById: actor.userId } : { adminApprovedAt: null, adminApprovedById: null } });
  await audit(prisma, actor, approve ? "provider.admin_approved" : "provider.admin_approval_removed", "Provider", providerId, { adminApprovedAt: p.adminApprovedAt }, { approve });
  if (approve) await recomputeProviderStatus(providerId);
  return approve ? "Approved. Remaining steps stay on their dashboard; credentials and payouts are still needed before they're matched to shifts." : "Approval removed (their current status is unchanged).";
}

/** Push a clinic through onboarding now (a payment method is still needed to post, since posting takes a deposit). */
export async function approveClinic(actor: Actor, clinicOrgId: string) {
  requireAdmin(actor);
  const c = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: clinicOrgId } });
  await prisma.clinicOrg.update({ where: { id: clinicOrgId }, data: { adminApprovedAt: new Date(), adminApprovedById: actor.userId, ...(c.status === "ONBOARDING" ? { status: "ACTIVE" } : {}) } });
  await audit(prisma, actor, "clinic.admin_approved", "ClinicOrg", clinicOrgId, { status: c.status }, { status: c.status === "ONBOARDING" ? "ACTIVE" : c.status });
  return c.hasPaymentMethod ? "Approved — they can post shifts now." : "Approved. They still need to add a payment method before posting (posting takes a deposit).";
}

export async function setClinicStatus(actor: Actor, clinicOrgId: string, status: "ACTIVE" | "SUSPENDED" | "DEACTIVATED", note?: string) {
  requireAdmin(actor);
  const c = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: clinicOrgId } });
  await prisma.clinicOrg.update({ where: { id: clinicOrgId }, data: { status, ...(note ? { adminNotes: [c.adminNotes, `${new Date().toISOString().slice(0, 10)}: ${note}`].filter(Boolean).join("\n") } : {}) } });
  await audit(prisma, actor, "clinic.status", "ClinicOrg", clinicOrgId, { status: c.status }, { status, note });
}

export async function openTasks(actor: Actor) {
  requireAdmin(actor);
  return prisma.adminTask.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: "desc" }, take: 200 });
}

export async function resolveTask(actor: Actor, id: string) {
  requireAdmin(actor);
  await prisma.adminTask.update({ where: { id }, data: { resolvedAt: new Date(), resolvedById: actor.userId } });
}

export async function searchAudit(actor: Actor, f: { q?: string; entityType?: string; take?: number }) {
  requireAdmin(actor);
  return prisma.auditLog.findMany({
    where: {
      ...(f.entityType ? { entityType: f.entityType } : {}),
      ...(f.q ? { OR: [{ action: { contains: f.q, mode: "insensitive" } }, { entityId: { contains: f.q } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: f.take ?? 200,
  });
}

export async function adminDashboard(actor: Actor) {
  requireAdmin(actor);
  const now = new Date();
  const [openByState, pendingVerifications, tasks, disputes, upcoming, flagged] = await Promise.all([
    prisma.shift.groupBy({ by: ["state", "professionCode"], where: { status: { in: ["OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING"] }, startsAt: { gt: now } }, _count: true }),
    prisma.license.count({ where: { status: "PENDING_VERIFICATION" } }).then(async (l) => l + (await prisma.malpracticePolicy.count({ where: { status: "PENDING_VERIFICATION" } }))),
    prisma.adminTask.count({ where: { resolvedAt: null } }),
    prisma.dispute.count({ where: { status: "OPEN" } }),
    prisma.shift.findMany({
      where: { status: { in: ["OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING"] }, startsAt: { gt: now, lt: new Date(+now + 72 * 3_600_000) } },
      include: { location: { include: { clinicOrg: true } }, _count: { select: { applications: { where: { status: "ACTIVE" } } } } },
      orderBy: { startsAt: "asc" },
      take: 20,
    }),
    prisma.message.count({ where: { flagged: true } }),
  ]);
  return { openByState, pendingVerifications, tasks, disputes, urgentUnfilled: upcoming, flaggedMessages: flagged };
}
