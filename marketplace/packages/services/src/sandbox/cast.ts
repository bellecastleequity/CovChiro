import { isSandbox } from "@cm/config";
import { storageProvider } from "@cm/integrations";
import { DomainError } from "@cm/core";
import { prisma } from "@cm/db";
import { moderateAccount } from "../accounts";
import { AGREEMENT_VERSION } from "../agreements";
import { hashPassword } from "../auth";
import { invalidateSettings, type Actor } from "../context";
import { recomputeProviderStatus } from "../onboarding";
import { savePayFloor } from "../payfloors";
import { saveOnCallRule } from "../oncall";
import { CLINICS, DEMO_DOMAIN, DEMO_PASSWORD, PROVIDERS, type DemoClinic, type DemoProvider } from "./data";
import { avatarPng } from "./avatar";
import { realNow } from "./time";

/** Configuration tables a reset keeps (states, professions, rates, settings, growth setup, schools, blog). */
const KEEP = new Set([
  "_prisma_migrations", "spatial_ref_sys", "User", "Session", "PushSubscription",
  "Profession", "Skill", "SkillStateRule", "StateConfig", "ProfessionStateConfig", "RateRegion", "RateCard", "Setting",
  "School", "GrowthProfession", "GrowthTarget", "GrowthMarket", "PromptTemplate", "KbArticle", "RecruitCampaign", "GrowthCampaign",
  "BlogPost", "BlockedSender", "BannedEmail", "BackupRun",
]);

export const demoEmail = (key: string, kind: "clinic" | "provider" | "staff") => `${kind}.${key}@${DEMO_DOMAIN}`;

export function assertSandbox() {
  if (!isSandbox()) throw new DomainError("FORBIDDEN", "This only works on the test site (SANDBOX_MODE=1).");
}

/**
 * Refuses to touch a database with real-looking accounts: the first build needs
 * an empty marketplace, and later resets only run where a build already happened.
 */
export async function assertSafeDatabase() {
  assertSandbox();
  const built = await prisma.setting.findUnique({ where: { key: "sandbox.builtAt" } });
  if (built) return;
  const realUsers = await prisma.user.count({ where: { role: { not: "PLATFORM_ADMIN" }, NOT: { email: { endsWith: `@${DEMO_DOMAIN}` } } } });
  if (realUsers > 0) {
    throw new DomainError("CONFLICT", `This database already has ${realUsers} clinic/provider login(s) that aren't demo accounts. The test site must use its own empty database: never point it at the live one.`);
  }
}

/** Empties every activity table (shifts, bookings, payments, messages, people). Admin logins and configuration stay. */
export async function wipe() {
  await assertSafeDatabase();
  const rows = await prisma.$queryRawUnsafe<{ t: string }[]>(`SELECT tablename::text AS t FROM pg_tables WHERE schemaname = 'public'`);
  const wipeList = rows.map((r) => r.t).filter((t) => !KEEP.has(t));
  if (wipeList.length) await prisma.$executeRawUnsafe(`TRUNCATE ${wipeList.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await prisma.user.deleteMany({ where: { role: { not: "PLATFORM_ADMIN" } } });
  await prisma.setting.deleteMany({ where: { key: { startsWith: "sandbox." }, NOT: { key: { in: ["sandbox.queue", "sandbox.builtAt"] } } } });
  // Saved menu orders, per-person prefs and leases of removed people.
  await prisma.setting.deleteMany({ where: { key: { startsWith: "nav.order." } } });
  return wipeList.length;
}

const setSetting = (key: string, value: unknown) =>
  prisma.setting.upsert({ where: { key }, create: { key, value: value as object, updatedAt: new Date() }, update: { value: value as object, updatedAt: new Date() } });

/**
 * Test-site configuration: the clinic-set rate beta on (so it can be tried),
 * outbound marketing paused, and rate cards valid back far enough for the
 * demo history (a fresh database dates them to the day it was created).
 */
export async function configure() {
  assertSandbox();
  await setSetting("clinicRate.enabled", true);
  await setSetting("growth.pausedOutbound", true);
  const old = new Date(realNow() - 400 * 86_400_000);
  const older = new Date(realNow() - 500 * 86_400_000);
  // Superseded cards end before the history starts; current cards start before it.
  await prisma.rateCard.updateMany({ where: { effectiveTo: { not: null, gt: old } }, data: { effectiveTo: old } });
  await prisma.rateCard.updateMany({ where: { effectiveTo: { not: null }, effectiveFrom: { gt: older } }, data: { effectiveFrom: older } });
  await prisma.rateCard.updateMany({ where: { effectiveTo: null, effectiveFrom: { gt: old } }, data: { effectiveFrom: old } });
  invalidateSettings();
}

const FAR = () => new Date(realNow() + 3 * 365 * 86_400_000);
const npiFor = (i: number) => `1${String(902_000_000 + i * 7_919).padStart(9, "0")}`.slice(0, 10);

async function makeUser(email: string, name: string, role: "CLINIC_OWNER" | "CLINIC_STAFF" | "PROVIDER", passwordHash: string, phone?: string) {
  return prisma.user.create({ data: { email, name, role, passwordHash, emailVerifiedAt: new Date(), phone: phone ?? null, phoneVerifiedAt: phone ? new Date() : null } });
}

export async function createClinic(c: DemoClinic, passwordHash: string, i: number) {
  const user = await makeUser(demoEmail(c.key, "clinic"), c.owner, "CLINIC_OWNER", passwordHash, `+1407555${String(2000 + i).padStart(4, "0")}`);
  const org = await prisma.clinicOrg.create({
    data: {
      legalName: c.legal,
      displayName: c.name,
      billingEmail: user.email,
      phone: `+1407555${String(3000 + i).padStart(4, "0")}`,
      status: c.noPayment ? "ONBOARDING" : "ACTIVE",
      hasPaymentMethod: !c.noPayment,
      paymentMethodLabel: c.noPayment ? null : "Visa •••• 4242 (test)",
      stripeCustomerId: c.noPayment ? null : `cus_fake_${c.key}`,
      agreementSignedAt: new Date(),
      agreementVersion: AGREEMENT_VERSION.CLINIC,
      minYearsExperience: c.minYears ?? 0,
      relaxExperienceInEmergency: c.relaxInEmergency ?? true,
      members: { create: { userId: user.id, role: "CLINIC_OWNER" } },
    },
  });
  if (c.staff) {
    const staff = await makeUser(demoEmail(c.key, "staff"), c.staff, "CLINIC_STAFF", passwordHash);
    await prisma.clinicMember.create({ data: { clinicOrgId: org.id, userId: staff.id, role: "CLINIC_STAFF" } });
  }
  const regions = await prisma.rateRegion.findMany({ where: { state: "FL" } });
  const skills = await prisma.skill.findMany({ where: { professionCode: "DC" } });
  for (const l of c.locations) {
    const region = regions.find((r) => r.zip3List.includes(l.zip.slice(0, 3))) ?? null;
    await prisma.clinicLocation.create({
      data: {
        clinicOrgId: org.id,
        name: l.name,
        addressLine1: l.address,
        city: l.city,
        state: "FL",
        zip: l.zip,
        lat: l.lat,
        lng: l.lng,
        timeZone: l.lng < -85 ? "America/Chicago" : "America/New_York",
        geocodedAt: new Date(),
        rateRegionId: region?.id ?? null,
        professionCodes: ["DC"],
        patientsPerDay: l.patientsPerDay,
        ehr: l.ehr,
        onSiteContactName: `${c.owner.split(" ")[0]} (front desk)`,
        arrivalNotes: l.arrival,
        dressCode: "Business casual or scrubs",
        equipment: ["Drop tables", "X-ray on site"],
        skills: { create: skills.filter((s) => ["Diversified", "Activator"].includes(s.name)).map((s) => ({ skillId: s.id })) },
      },
    });
  }
  return org;
}

export async function createProvider(p: DemoProvider, passwordHash: string, i: number, admin: Actor) {
  const user = await makeUser(demoEmail(p.key, "provider"), `${p.first} ${p.last}`, "PROVIDER", passwordHash, `+1321555${String(4000 + i).padStart(4, "0")}`);
  const skills = await prisma.skill.findMany({ where: { professionCode: "DC" } });
  const licensed = p.kind !== "student";
  const licenseStatus = p.kind === "pendingLicense" ? "PENDING_VERIFICATION" : "VERIFIED";
  const licenseExpires = p.kind === "expiringLicense" ? new Date(realNow() + 20 * 86_400_000) : FAR();
  const days = p.days ?? [1, 2, 3, 4, 5, 6];
  const tz = p.lng < -85 ? "America/Chicago" : "America/New_York";
  const provider = await prisma.provider.create({
    data: {
      userId: user.id,
      legalName: `${p.first} ${p.last}`,
      displayName: p.kind === "student" ? `${p.first} ${p.last}` : `Dr. ${p.first} ${p.last}`,
      npi: licensed ? npiFor(i) : null,
      npiVerifiedAt: licensed ? new Date() : null,
      homeCity: p.city,
      homeZip: p.zip,
      homeLat: p.lat,
      homeLng: p.lng,
      homeState: "FL",
      homeTimeZone: tz,
      maxDriveMinutes: p.drive ?? 60,
      willingOvernight: p.overnight ?? false,
      bio: p.bio,
      headline: p.kind === "student" ? "Chiropractic student" : `Chiropractor, ${new Date().getFullYear() - p.grad} years`,
      school: ["Palmer College of Chiropractic", "Life University", "Logan University", "Sherman College", "Parker University"][i % 5],
      graduationYear: p.grad,
      graduationDate: p.kind === "student" ? new Date(`${p.grad}-12-15T00:00:00Z`) : null,
      languages: ["English", ...(p.langs ?? [])],
      ehrSystems: [["ChiroTouch", "Jane"], ["ECLIPSE"], ["Genesis", "ChiroFusion"]][i % 3],
      xrayComfort: i % 3 !== 0,
      personalInjuryExperience: p.pi ?? false,
      maxPatientsPerDay: 40 + (i % 4) * 10,
      stripeAccountId: p.kind === "noPayouts" ? null : `acct_fake_${p.key}`,
      stripePayoutsEnabled: p.kind !== "noPayouts",
      agreementSignedAt: new Date(),
      agreementVersion: AGREEMENT_VERSION.PROVIDER,
      profileCompleteAt: new Date(),
      smsConsentAt: new Date(),
      preLicensure: p.kind === "student",
      preLicensureSince: p.kind === "student" ? new Date() : null,
      isStudent: p.kind === "student",
      expectedLicensure: p.kind === "student" ? "1-3" : null,
      intendedStates: p.kind === "student" ? ["FL"] : [],
      acquisitionSource: ["Referral", "Instagram", "Google search", "School event"][i % 4],
      professions: { create: [{ professionCode: "DC", status: "ACTIVE", yearsInPractice: p.kind === "student" ? 0 : Math.max(0, new Date().getFullYear() - p.grad) }] },
      licenses: licensed
        ? { create: [{ professionCode: "DC", state: "FL", licenseNumber: `CH${String(10_000 + i * 37).padStart(6, "0")}`, expiresAt: licenseExpires, status: licenseStatus, ...(licenseStatus === "VERIFIED" ? { verifiedAt: new Date(), verifiedById: admin.userId } : {}) }] }
        : undefined,
      malpractice: licensed
        ? {
          create: [{
            carrier: ["NCMIC", "OUM Chiropractor Program", "ChiroSecure"][i % 3],
            policyNumber: `POL-${100_000 + i}`,
            perOccurrenceCents: 100_000_000,
            aggregateCents: 300_000_000,
            coveredProfessionCodes: ["DC"],
            expiresAt: FAR(),
            documentUrl: "sandbox/malpractice.pdf",
            status: p.kind === "pendingMalpractice" ? "PENDING_VERIFICATION" : "VERIFIED",
          }],
        }
        : undefined,
      skills: { create: skills.filter((s) => (p.skills ?? ["Diversified"]).includes(s.name)).map((s, k) => ({ skillId: s.id, proficiency: k === 0 ? 3 : 2 })) },
      availability: { create: days.map((weekday) => ({ weekday, startMin: 6 * 60, endMin: 20 * 60, timeZone: tz })) },
      stats: { create: {} },
    },
  });
  const actor: Actor = { userId: user.id, role: "PROVIDER", providerId: provider.id, clinicOrgId: null };
  // A profile photo is part of a complete profile.
  const photo = await storageProvider().put(`photos/${provider.id}`, avatarPng(i * 3 + p.last.length), "image/png");
  await prisma.provider.update({ where: { id: provider.id }, data: { photoUrl: photo } });
  if (p.floor) await savePayFloor(actor, { professionCode: "DC", minFullDayCents: p.floor * 100 }).catch(() => undefined);
  if (p.onCall) {
    await saveOnCallRule(actor, {
      professionCodes: ["DC"],
      recurringWindows: days.map((weekday) => ({ weekday, startMin: 7 * 60, endMin: 19 * 60 })),
      maxDriveMinutes: p.drive ?? 60,
      minNoticeMinutes: 120,
    }).catch(() => undefined);
  }
  await recomputeProviderStatus(provider.id).catch(() => undefined);
  if (p.kind === "suspended") await moderateAccount(admin, { kind: "provider", id: provider.id, action: "suspend", reason: "Demo: suspended account (late cancellations)" }).catch(() => undefined);
  return provider;
}

/** All demo clinics and providers. */
export async function createCast(admin: Actor) {
  assertSandbox();
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const [i, c] of CLINICS.entries()) {
    if (await prisma.user.findUnique({ where: { email: demoEmail(c.key, "clinic") } })) continue;
    await createClinic(c, passwordHash, i);
  }
  for (const [i, p] of PROVIDERS.entries()) {
    if (await prisma.user.findUnique({ where: { email: demoEmail(p.key, "provider") } })) continue;
    await createProvider(p, passwordHash, i, admin);
  }
}

export interface CastClinic {
  key: string;
  yours: boolean;
  orgId: string;
  ownerName: string;
  locationIds: string[];
  actor: Actor;
  spec: DemoClinic;
}
export interface CastProvider {
  key: string;
  yours: boolean;
  id: string;
  userId: string;
  name: string;
  actor: Actor;
  spec: DemoProvider;
}

/** Look the demo people up again (each step runs on its own, maybe in a later request). */
export async function loadCast() {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: `@${DEMO_DOMAIN}` } },
    include: { provider: true, clinicMembers: { include: { clinicOrg: { include: { locations: { orderBy: { createdAt: "asc" } } } } } } },
  });
  const clinics = new Map<string, CastClinic>();
  const providers = new Map<string, CastProvider>();
  for (const u of users) {
    const [kind, key] = u.email.split("@")[0].split(".");
    if (kind === "clinic") {
      const spec = CLINICS.find((c) => c.key === key);
      const m = u.clinicMembers[0];
      if (!spec || !m) continue;
      clinics.set(key, {
        key,
        yours: !!spec.yours,
        orgId: m.clinicOrgId,
        ownerName: u.name,
        locationIds: m.clinicOrg.locations.filter((l) => l.active).map((l) => l.id),
        actor: { userId: u.id, role: "CLINIC_OWNER", providerId: null, clinicOrgId: m.clinicOrgId },
        spec,
      });
    } else if (kind === "provider" && u.provider) {
      const spec = PROVIDERS.find((p) => p.key === key);
      if (!spec) continue;
      providers.set(key, { key, yours: !!spec.yours, id: u.provider.id, userId: u.id, name: u.provider.displayName, actor: { userId: u.id, role: "PROVIDER", providerId: u.provider.id, clinicOrgId: null }, spec });
    }
  }
  return { clinics, providers };
}
export type Cast = Awaited<ReturnType<typeof loadCast>>;

/**
 * Test site: when an agreement version is bumped, the demo accounts (@sandbox.test) would be locked out
 * (clinics can't post, providers aren't matched) until someone re-signed each one. They're test data, so
 * keep them on the current version. Real logins on the test site still sign for themselves.
 */
export async function keepDemoAgreementsCurrent() {
  const now = new Date();
  const orgs = await prisma.clinicOrg.updateMany({
    where: { OR: [{ agreementVersion: null }, { agreementVersion: { lt: AGREEMENT_VERSION.CLINIC } }], agreementSignedAt: { not: null }, members: { some: { user: { email: { endsWith: "@sandbox.test" } } } } },
    data: { agreementVersion: AGREEMENT_VERSION.CLINIC, agreementSignedAt: now },
  });
  const providers = await prisma.provider.updateMany({
    where: { OR: [{ agreementVersion: null }, { agreementVersion: { lt: AGREEMENT_VERSION.PROVIDER } }], agreementSignedAt: { not: null }, user: { email: { endsWith: "@sandbox.test" } } },
    data: { agreementVersion: AGREEMENT_VERSION.PROVIDER, agreementSignedAt: now },
  });
  return { clinics: orgs.count, providers: providers.count };
}
