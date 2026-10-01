import { isSuppressed } from "./growth/engine";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "@cm/config";
import {
  ACQUISITION_SOURCES, credentialState, DAY, DomainError, EXPECTED_LICENSURE, followupAnchor, followupDue, followupKind, PROVIDER_STAGES, providerStage,
  resolveAcquisitionSource, US_STATES, type CredentialState, type FollowupKind, type ProviderStage,
} from "@cm/core";
import { prisma, type AssignmentStatus, type Prisma } from "@cm/db";
import { geoProvider, haversineMiles } from "@cm/integrations";
import { audit, clock, getSettings, requireAdmin, requireProvider, type Actor } from "./context";
import { absoluteUrl, sendEmail } from "./notify";

/**
 * Pre-licensure (students & new graduates) — the opt-in "not licensed yet"
 * path. Intake, the student toggle, the readiness summary, credential
 * follow-ups, recruitment links (/join/<slug>), and the provider funnel and
 * supply reports.
 *
 * Nothing in this file decides or relaxes shift eligibility. INV-1/INV-3 stay
 * in eligibility.ts + the provider_shift_problem trigger, which never read the
 * student fields. A student stays ONBOARDING until recomputeProviderStatus
 * says otherwise, exactly like any other provider.
 */

const LIVE_ASSIGNMENT: AssignmentStatus[] = ["CONFIRMED", "IN_PROGRESS", "COMPLETED", "DISPUTED"];
const stateCode = z.string().trim().toUpperCase().refine((s) => s in US_STATES, "Choose a state");

export const StudentInput = z.object({
  school: z.string().trim().min(2, "Enter your chiropractic school.").max(160),
  graduationDate: z.coerce.date({ message: "Enter your graduation date (or expected date)." }),
  intendedStates: z.array(stateCode).min(1, "Choose at least one state where you plan to be licensed.").max(10),
  licensureApplied: z.enum(["no", "yes"]),
  expectedLicensure: z.enum(Object.keys(EXPECTED_LICENSURE) as [string, ...string[]]),
  preferredArea: z.string().trim().max(160).optional().nullable(),
  homeZip: z.string().trim().regex(/^\d{5}$/, "Enter a 5-digit ZIP code."),
  maxDriveMinutes: z.coerce.number().int().min(10).max(600).optional(),
  smsConsent: z.boolean().default(false),
});
export type StudentInputT = z.infer<typeof StudentInput>;

export const AttributionInput = z
  .object({
    campaign: z.string().trim().toLowerCase().max(60),
    source: z.string().trim().max(40),
    sourceDetail: z.string().trim().max(160),
    referredBy: z.string().trim().max(160),
    landingPath: z.string().trim().max(300),
    utm: z.object({ source: z.string().max(100), medium: z.string().max(100), campaign: z.string().max(100), term: z.string().max(100), content: z.string().max(100) }).partial(),
  })
  .partial();
export type AttributionInputT = z.infer<typeof AttributionInput>;

function checkGraduationDate(d: Date, now: Date) {
  if (+d < +now - 15 * 365 * DAY || +d > +now + 6 * 365 * DAY) throw new DomainError("VALIDATION", "That graduation date doesn't look right.");
}

/** Provider columns for a student signup or opt-in. */
export async function studentFields(input: StudentInputT, now: Date): Promise<Prisma.ProviderUncheckedUpdateInput> {
  checkGraduationDate(input.graduationDate, now);
  // ZIP → city/county/state for reports (best effort; never blocks signup, never sets homeLat so the "home base" step stays open).
  let place: { homeCity?: string; homeState?: string; homeCounty?: string | null } = {};
  try {
    const g = await geoProvider().geocode(input.homeZip, {});
    if (g) place = { homeCity: g.city || undefined, homeState: g.state, homeCounty: g.county ?? null };
  } catch {
    /* reports fall back to the ZIP */
  }
  return {
    preLicensure: true,
    preLicensureSince: now,
    school: input.school,
    graduationDate: input.graduationDate,
    graduationYear: input.graduationDate.getUTCFullYear(),
    intendedStates: [...new Set(input.intendedStates)],
    licensureApplied: input.licensureApplied,
    expectedLicensure: input.expectedLicensure,
    preferredArea: input.preferredArea || null,
    homeZip: input.homeZip,
    ...(input.maxDriveMinutes ? { maxDriveMinutes: input.maxDriveMinutes } : {}),
    smsConsentAt: input.smsConsent ? now : null,
    ...place,
  };
}

/** Acquisition attribution (recruitment link, UTM, self-reported source) — captured for every provider signup. */
export async function attributionFields(db: Prisma.TransactionClient | typeof prisma, a: AttributionInputT | undefined): Promise<Prisma.ProviderUncheckedUpdateInput> {
  if (!a) return { acquisitionSource: "direct" };
  const campaign = a.campaign ? await db.recruitCampaign.findFirst({ where: { slug: a.campaign, active: true } }) : null;
  return {
    recruitCampaignId: campaign?.id ?? null,
    acquisitionSource: resolveAcquisitionSource({ campaignKind: campaign?.kind, utmSource: a.utm?.source, selected: a.source }),
    acquisitionDetail: campaign?.slug ?? (a.sourceDetail || null),
    referredBy: a.referredBy || null,
    landingPath: a.landingPath || null,
    utmSource: a.utm?.source || null,
    utmMedium: a.utm?.medium || null,
    utmCampaign: a.utm?.campaign || null,
    utmTerm: a.utm?.term || null,
    utmContent: a.utm?.content || null,
  };
}

/** Turn the student path on (with its details) or off from the provider's profile. */
export async function setStudentMode(actor: Actor, on: boolean, raw?: z.input<typeof StudentInput>) {
  const providerId = requireProvider(actor);
  const now = clock.now();
  if (!on) {
    await prisma.provider.update({ where: { id: providerId }, data: { preLicensure: false } });
    await audit(prisma, actor, "provider.student_off", "Provider", providerId);
    return;
  }
  const s = await getSettings();
  if (!s["features.preLicensureEnabled"]) throw new DomainError("FORBIDDEN", "The student path isn't available right now.");
  const verified = await prisma.license.count({ where: { providerId, status: "VERIFIED", expiresAt: { gt: now } } });
  if (verified) throw new DomainError("VALIDATION", "You already have a verified license, so the student path doesn't apply.");
  const data = await studentFields(StudentInput.parse(raw), now);
  const current = await prisma.provider.findUniqueOrThrow({ where: { id: providerId } });
  await prisma.provider.update({ where: { id: providerId }, data: { ...data, preLicensureSince: current.preLicensureSince ?? now, smsConsentAt: data.smsConsentAt ? current.smsConsentAt ?? now : null } });
  await audit(prisma, actor, "provider.student_on", "Provider", providerId);
}

// ---------------------------------------------------------------------------
// Readiness summary
// ---------------------------------------------------------------------------

type ProviderForSummary = Prisma.ProviderGetPayload<{
  include: { licenses: true; malpractice: true; professions: true; _count: { select: { assignments: true } } };
}>;

const summaryInclude = {
  licenses: true,
  malpractice: true,
  professions: true,
  _count: { select: { assignments: { where: { status: { in: LIVE_ASSIGNMENT } } } } },
} satisfies Prisma.ProviderInclude;

/** Mirrors matching's gates (F1 status, F3 payouts, INV-1, INV-3) for display; matching itself stays the authority. */
function isCoverageReady(p: ProviderForSummary, now: Date) {
  if (p.status !== "ACTIVE" || !p.stripePayoutsEnabled) return false;
  return p.professions.some(
    (pp) =>
      pp.status === "ACTIVE" &&
      p.licenses.some((l) => l.professionCode === pp.professionCode && l.status === "VERIFIED" && +l.expiresAt > +now) &&
      p.malpractice.some((m) => m.status === "VERIFIED" && +m.expiresAt > +now && m.coveredProfessionCodes.includes(pp.professionCode)),
  );
}

export interface ReadinessSummary {
  license: CredentialState;
  malpractice: CredentialState;
  stage: ProviderStage;
  stageLabel: string;
  coverageReady: boolean;
  followup: FollowupKind | null;
}

function summarize(p: ProviderForSummary, now: Date): ReadinessSummary {
  const license = credentialState(p.licenses, now);
  const malpractice = credentialState(p.malpractice, now);
  const coverageReady = isCoverageReady(p, now);
  const stage = providerStage({ preLicensure: p.preLicensure, graduationDate: p.graduationDate, license, malpractice, coverageReady, hasWorked: p._count.assignments > 0, now });
  return { license, malpractice, stage, stageLabel: PROVIDER_STAGES.find((s) => s.key === stage)!.label, coverageReady, followup: followupKind(license, malpractice) };
}

export async function readinessSummary(providerId: string): Promise<ReadinessSummary> {
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: providerId }, include: summaryInclude });
  return summarize(p, clock.now());
}

// ---------------------------------------------------------------------------
// Credential follow-ups (students only)
// ---------------------------------------------------------------------------

function unsubscribeToken(providerId: string) {
  return createHmac("sha256", env().SESSION_SECRET ?? "dev-secret").update(`prelicensure:${providerId}`).digest("base64url").slice(0, 22);
}

export function studentUnsubscribeUrl(providerId: string) {
  return absoluteUrl(`/unsubscribe/student?p=${encodeURIComponent(providerId)}&t=${unsubscribeToken(providerId)}`);
}

export async function unsubscribeStudent(providerId: string, token: string) {
  const want = Buffer.from(unsubscribeToken(providerId));
  const got = Buffer.from(token);
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw new DomainError("VALIDATION", "That unsubscribe link isn't valid.");
  await prisma.provider.updateMany({ where: { id: providerId }, data: { credFollowupOptOut: true } });
}

const CRED_LINK = "/provider/credentials";

export function followupEmail(kind: FollowupKind, firstName: string, s: { license: CredentialState }): { subject: string; heading: string; paragraphs: string[]; cta: { label: string; url: string } } {
  const hi = `Hi ${firstName},`;
  const reviewNote = s.license === "pending" ? "We have your license and it's being verified — nothing more is needed for it right now." : null;
  switch (kind) {
    case "license_missing":
      return {
        subject: "Have you received your chiropractic license?",
        heading: "Have you received your chiropractic license?",
        paragraphs: [hi, "Upload your license information to continue becoming coverage-ready.", "Once your license and malpractice insurance are verified, you can start accepting paid coverage shifts around your schedule. Still waiting on the board? No problem — we'll check back in a few weeks."],
        cta: { label: "I'm Licensed — Complete My Profile", url: CRED_LINK },
      };
    case "license_rejected":
      return {
        subject: "Your license needs a correction",
        heading: "Your license needs a correction",
        paragraphs: [hi, "We weren't able to verify the license you submitted. The reason is on your credentials page — please fix it and resubmit."],
        cta: { label: "Update my license", url: CRED_LINK },
      };
    case "license_expired":
      return {
        subject: "Your license on file has expired",
        heading: "Your license on file has expired",
        paragraphs: [hi, "Coverage shifts are paused until your renewed license is uploaded and verified."],
        cta: { label: "Upload my renewed license", url: CRED_LINK },
      };
    case "malpractice_missing":
      return s.license === "verified"
        ? {
            subject: "Your license is verified — add your malpractice insurance",
            heading: "License verified — one step to go",
            paragraphs: [hi, "Your chiropractic license has been received and verified. Add your malpractice insurance to complete your coverage eligibility."],
            cta: { label: "Add my malpractice insurance", url: CRED_LINK },
          }
        : {
            subject: "Add your malpractice insurance",
            heading: "Add your malpractice insurance",
            paragraphs: [hi, ...(reviewNote ? [reviewNote] : []), "Add your malpractice insurance so both credentials can be verified."],
            cta: { label: "Add my malpractice insurance", url: CRED_LINK },
          };
    case "malpractice_rejected":
      return {
        subject: "Your malpractice insurance needs a correction",
        heading: "Your malpractice insurance needs a correction",
        paragraphs: [hi, ...(reviewNote ? [reviewNote] : []), "We weren't able to verify the policy you submitted. The reason is on your credentials page — please upload a corrected certificate."],
        cta: { label: "Update my insurance", url: CRED_LINK },
      };
    case "malpractice_expired":
      return {
        subject: "Your malpractice policy on file has expired",
        heading: "Your malpractice policy on file has expired",
        paragraphs: [hi, "Upload your renewed policy so it can be verified."],
        cta: { label: "Upload my renewed policy", url: CRED_LINK },
      };
  }
}

/**
 * Daily: students who aren't coverage-ready get at most one follow-up, timed
 * from graduation (or signup, if later), naming exactly what's missing.
 * Nothing goes out while everything is submitted and under review.
 */
export async function runPreLicensureFollowups(now = clock.now()) {
  const s = await getSettings();
  if (!s["features.preLicensureEnabled"] || !s["prelicensure.followupsEnabled"]) return { sent: 0, checked: 0 };
  const students = await prisma.provider.findMany({
    where: { preLicensure: true, credFollowupOptOut: false, status: { in: ["ONBOARDING", "ACTIVE"] } },
    include: { ...summaryInclude, user: true },
  });
  let sent = 0;
  for (const p of students) {
    const sum = summarize(p, now);
    if (sum.coverageReady || !sum.followup) continue;
    // Someone who unsubscribed (or bounced) through the Growth emails gets no student follow-ups either.
    if (await isSuppressed("EMAIL", p.user.email)) continue;
    const due = followupDue({
      step: p.credFollowupStep,
      anchor: followupAnchor(p.graduationDate, p.createdAt),
      lastSentAt: p.credFollowupLastAt,
      now,
      followupDays: s["prelicensure.followupDays"],
      repeatDays: s["prelicensure.repeatDays"],
      minGapDays: s["prelicensure.minGapDays"],
    });
    if (!due.due) continue;
    const first = (p.displayName || p.user.name).split(/\s+/)[0] ?? "there";
    const email = followupEmail(sum.followup, first, sum);
    const ok = await sendEmail(p.user.email, { ...email, unsubscribeUrl: studentUnsubscribeUrl(p.id) });
    await prisma.notification.create({
      data: { userId: p.userId, channel: "in_app", template: `prelicensure_${sum.followup}`, title: email.subject, body: email.paragraphs.slice(1).join(" "), link: email.cta.url, payload: { sent: ok ? ["email"] : [] }, sentAt: ok ? now : null },
    });
    await prisma.provider.update({ where: { id: p.id }, data: { credFollowupStep: due.nextStep, credFollowupLastAt: now, credFollowupLastKind: sum.followup } });
    if (ok) sent++;
  }
  return { sent, checked: students.length };
}

// ---------------------------------------------------------------------------
// Recruitment links
// ---------------------------------------------------------------------------

export async function campaignForSlug(slug: string) {
  return prisma.recruitCampaign.findFirst({ where: { slug: slug.toLowerCase(), active: true } });
}

export const CampaignInput = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,58}$/, "Link name: 2–60 lowercase letters, numbers or dashes."),
  name: z.string().trim().min(2).max(160),
  kind: z.enum(["SCHOOL", "EVENT", "CAMPAIGN"]),
  state: stateCode.optional().nullable().or(z.literal("")),
  city: z.string().trim().max(100).optional().nullable(),
  headline: z.string().trim().max(160).optional().nullable(),
  costDollars: z.coerce.number().min(0).max(10_000_000).default(0),
  active: z.boolean().default(true),
});

export async function saveCampaign(actor: Actor, raw: z.input<typeof CampaignInput>, id?: string) {
  requireAdmin(actor);
  const i = CampaignInput.parse(raw);
  const clash = await prisma.recruitCampaign.findFirst({ where: { slug: i.slug, ...(id ? { NOT: { id } } : {}) } });
  if (clash) throw new DomainError("CONFLICT", "That link name is already used.");
  // /join/<code> is shared with Growth campaign links, so names must be unique across both.
  if (await prisma.growthCampaign.count({ where: { code: i.slug } })) throw new DomainError("CONFLICT", `"${i.slug}" is already a Growth campaign code (Admin → Growth → Campaigns). Pick another link name.`);
  const data = { slug: i.slug, name: i.name, kind: i.kind, state: i.state || null, city: i.city || null, headline: i.headline || null, costCents: Math.round(i.costDollars * 100), active: i.active };
  const c = id ? await prisma.recruitCampaign.update({ where: { id }, data }) : await prisma.recruitCampaign.create({ data });
  await audit(prisma, actor, id ? "recruit.updated" : "recruit.created", "RecruitCampaign", c.id, null, data);
  return c;
}

/** All provider rows needed for the funnel/supply/campaign reports, summarised once. */
async function providerRows(now: Date) {
  const rows = await prisma.provider.findMany({ include: { ...summaryInclude, recruitCampaign: true } });
  const ready = new Set((await prisma.digestSend.findMany({ where: { key: { startsWith: "ready:" } }, select: { key: true } })).map((d) => d.key.split(":")[1]));
  return rows.map((p) => ({ p, sum: summarize(p, now), everReady: ready.has(p.id) || isCoverageReady(p, now) }));
}

export async function campaignReport(actor: Actor) {
  requireAdmin(actor);
  const now = clock.now();
  const [campaigns, rows, visits] = await Promise.all([
    prisma.recruitCampaign.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
    providerRows(now),
    prisma.analyticsEvent.groupBy({ by: ["path"], where: { type: "PAGE_VIEW", path: { startsWith: "/join/" } }, _count: true }),
  ]);
  const visitsBySlug = new Map(visits.map((v) => [String(v.path).replace(/^\/join\//, "").replace(/\/$/, "").toLowerCase(), v._count]));
  return campaigns.map((c) => {
    const mine = rows.filter((r) => r.p.recruitCampaignId === c.id);
    return {
      ...c,
      url: absoluteUrl(`/join/${c.slug}`),
      visits: visitsBySlug.get(c.slug) ?? 0,
      signups: mine.length,
      students: mine.filter((r) => r.p.preLicensure || r.p.preLicensureSince).length,
      coverageReady: mine.filter((r) => r.everReady).length,
      firstShift: mine.filter((r) => r.p._count.assignments > 0).length,
    };
  });
}

// ---------------------------------------------------------------------------
// Provider funnel
// ---------------------------------------------------------------------------

export async function providerFunnel(actor: Actor, opts: { studentsOnly?: boolean } = {}) {
  requireAdmin(actor);
  const now = clock.now();
  const all = await providerRows(now);
  const rows = opts.studentsOnly ? all.filter((r) => r.p.preLicensureSince) : all;
  const providerEmails = new Set((await prisma.user.findMany({ where: { provider: { id: { in: rows.map((r) => r.p.id) } } }, select: { email: true } })).map((u) => u.email.toLowerCase()));
  const leadEmails = (await prisma.lead.findMany({ where: { audience: "PROVIDER", spamCategory: null }, select: { email: true } })).map((l) => l.email.toLowerCase());
  const visits = await prisma.analyticsEvent.count({ where: { type: "PAGE_VIEW", OR: [{ path: "/join" }, { path: { startsWith: "/join/" } }] } });
  const assignmentsBy = new Map(
    (await prisma.assignment.groupBy({ by: ["providerId"], where: { status: { in: LIVE_ASSIGNMENT } }, _count: true })).map((a) => [a.providerId, a._count]),
  );
  const graduated = (r: (typeof rows)[number]) => (r.p.graduationDate ? +r.p.graduationDate <= +now : !r.p.preLicensureSince);
  const lic = (r: (typeof rows)[number]) => r.p.licenses;
  const steps = [
    { key: "visits", label: "Recruitment page visits (/join)", count: visits },
    { key: "leads", label: "Provider leads (incl. sign-ups)", count: new Set([...leadEmails, ...providerEmails]).size },
    { key: "registered", label: "Accounts created", count: rows.length },
    { key: "graduated", label: "Graduated", count: rows.filter(graduated).length },
    { key: "licenseSubmitted", label: "License submitted", count: rows.filter((r) => lic(r).length > 0).length },
    { key: "licensed", label: "Licensed (verified)", count: rows.filter((r) => lic(r).some((l) => l.status === "VERIFIED" || l.status === "EXPIRED")).length },
    { key: "bothSubmitted", label: "License + malpractice submitted", count: rows.filter((r) => lic(r).length > 0 && r.p.malpractice.length > 0).length },
    { key: "coverageReady", label: "Coverage-ready (ever)", count: rows.filter((r) => r.everReady).length },
    { key: "firstShift", label: "Accepted first shift", count: rows.filter((r) => (assignmentsBy.get(r.p.id) ?? 0) >= 1).length },
    { key: "repeat", label: "Repeat providers (2+ shifts)", count: rows.filter((r) => (assignmentsBy.get(r.p.id) ?? 0) >= 2).length },
  ];
  const stages = PROVIDER_STAGES.map((s) => ({ ...s, count: rows.filter((r) => r.sum.stage === s.key).length }));
  const group = (keyOf: (r: (typeof rows)[number]) => string, labelOf: (k: string) => string) => {
    const m = new Map<string, (typeof rows)[number][]>();
    for (const r of rows) m.set(keyOf(r), [...(m.get(keyOf(r)) ?? []), r]);
    return [...m.entries()]
      .map(([k, rs]) => ({
        key: k,
        label: labelOf(k),
        registered: rs.length,
        licensed: rs.filter((r) => r.sum.license === "verified").length,
        coverageReady: rs.filter((r) => r.everReady).length,
        readyNow: rs.filter((r) => r.sum.coverageReady).length,
        firstShift: rs.filter((r) => (assignmentsBy.get(r.p.id) ?? 0) >= 1).length,
        costCents: rs[0]?.p.recruitCampaign && k.startsWith("campaign:") ? rs[0].p.recruitCampaign.costCents : null,
      }))
      .sort((a, b) => b.registered - a.registered);
  };
  return {
    headline: {
      registered: rows.length,
      coverageReady: rows.filter((r) => r.sum.coverageReady).length,
      students: rows.filter((r) => r.p.preLicensure).length,
    },
    steps,
    stages,
    bySource: group((r) => r.p.acquisitionSource ?? "direct", (k) => ACQUISITION_SOURCES[k] ?? k),
    byCampaign: group((r) => (r.p.recruitCampaign ? `campaign:${r.p.recruitCampaign.slug}` : "none"), (k) => (k === "none" ? "No recruitment link" : (all.find((r) => r.p.recruitCampaign && `campaign:${r.p.recruitCampaign.slug}` === k)?.p.recruitCampaign?.name ?? k))),
    bySchool: group((r) => (r.p.school ?? "").trim().toLowerCase() || "unknown", (k) => (k === "unknown" ? "Not given" : rows.find((r) => (r.p.school ?? "").trim().toLowerCase() === k)?.p.school ?? k)),
  };
}

// ---------------------------------------------------------------------------
// Geographic supply
// ---------------------------------------------------------------------------

/** Approximate miles a provider will drive, from their max one-way drive minutes (45 mph average). */
export const driveMinutesToMiles = (m: number) => Math.round((m * 45) / 60);

export async function providerSupply(actor: Actor, opts: { near?: string } = {}) {
  requireAdmin(actor);
  const now = clock.now();
  const rows = (await providerRows(now)).filter((r) => r.p.status !== "DEACTIVATED");
  const groupBy = (keyOf: (r: (typeof rows)[number]) => string | null) => {
    const m = new Map<string, { key: string; registered: number; pipeline: number; ready: number }>();
    for (const r of rows) {
      const k = keyOf(r) || "Unknown";
      const g = m.get(k) ?? { key: k, registered: 0, pipeline: 0, ready: 0 };
      g.registered++;
      if (r.sum.coverageReady) g.ready++;
      else g.pipeline++;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.ready - a.ready || b.registered - a.registered);
  };
  let radius: null | { label: string; lat: number; lng: number; rings: { miles: number; ready: number; readyWillDrive: number; pipeline: number }[] } = null;
  if (opts.near?.trim()) {
    const g = await geoProvider().geocode(opts.near.trim(), {});
    if (!g) throw new DomainError("VALIDATION", "Couldn't find that address or ZIP.");
    const rings = [25, 50, 75, 100].map((miles) => ({ miles, ready: 0, readyWillDrive: 0, pipeline: 0 }));
    for (const r of rows) {
      if (r.p.homeLat === null || r.p.homeLng === null) continue;
      const d = haversineMiles({ lat: g.lat, lng: g.lng }, { lat: r.p.homeLat, lng: r.p.homeLng });
      for (const ring of rings) {
        if (d > ring.miles) continue;
        if (r.sum.coverageReady) {
          ring.ready++;
          if (d <= driveMinutesToMiles(r.p.maxDriveMinutes)) ring.readyWillDrive++;
        } else ring.pipeline++;
      }
    }
    radius = { label: [g.city, g.state, g.zip].filter(Boolean).join(" "), lat: g.lat, lng: g.lng, rings };
  }
  return {
    byState: groupBy((r) => r.p.homeState),
    byCounty: groupBy((r) => (r.p.homeCounty ? `${r.p.homeCounty}, ${r.p.homeState ?? ""}`.trim() : null)),
    byCity: groupBy((r) => (r.p.homeCity ? `${r.p.homeCity}, ${r.p.homeState ?? ""}`.trim() : null)),
    byZip: groupBy((r) => r.p.homeZip),
    noLocation: rows.filter((r) => r.p.homeLat === null).length,
    radius,
  };
}

/** For the admin provider list/detail. */
export async function studentInfo(providerId: string) {
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: providerId }, include: { recruitCampaign: true } });
  return {
    preLicensure: p.preLicensure,
    wasStudent: !!p.preLicensureSince,
    graduatedOutAt: p.graduatedOutAt,
    graduationDate: p.graduationDate,
    licensureApplied: p.licensureApplied,
    expectedLicensure: p.expectedLicensure ? EXPECTED_LICENSURE[p.expectedLicensure] ?? p.expectedLicensure : null,
    intendedStates: p.intendedStates,
    preferredArea: p.preferredArea,
    homeZip: p.homeZip,
    acquisition: {
      source: p.acquisitionSource ? ACQUISITION_SOURCES[p.acquisitionSource] ?? p.acquisitionSource : null,
      detail: p.acquisitionDetail,
      campaign: p.recruitCampaign?.name ?? null,
      referredBy: p.referredBy,
      utm: [p.utmSource, p.utmMedium, p.utmCampaign].filter(Boolean).join(" / ") || null,
      landingPath: p.landingPath,
    },
    followups: { step: p.credFollowupStep, lastAt: p.credFollowupLastAt, lastKind: p.credFollowupLastKind, optOut: p.credFollowupOptOut },
    summary: await readinessSummary(providerId),
  };
}
