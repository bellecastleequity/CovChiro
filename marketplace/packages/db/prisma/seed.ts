import { randomBytes } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { PrismaClient } from "@prisma/client";
import { seedBase } from "./seedData";

/**
 *   pnpm db:seed                    launch configuration + owner admin account
 *   SEED_DEMO=1 pnpm db:seed        also demo clinic + providers (local dev only)
 *
 * Owner admin: SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (a random password is
 * generated and printed if unset). MFA is enforced at first login.
 */

const prisma = new PrismaClient();

async function user(email: string, name: string, role: "PLATFORM_ADMIN" | "CLINIC_OWNER" | "PROVIDER", password: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  return prisma.user.create({
    data: { email, name, role, passwordHash: await hash(password), emailVerifiedAt: new Date() },
  });
}

async function seedDemo() {
  const far = new Date("2028-01-31T00:00:00Z");
  const clinicOwner = await user("clinic@demo.test", "Casey Morgan", "CLINIC_OWNER", "demo-password-1");
  let org = await prisma.clinicOrg.findFirst({ where: { members: { some: { userId: clinicOwner.id } } } });
  if (!org) {
    const region = await prisma.rateRegion.findUniqueOrThrow({ where: { name: "FL-Smaller cities" } });
    const diversified = await prisma.skill.findFirstOrThrow({ where: { name: "Diversified", professionCode: "DC" } });
    org = await prisma.clinicOrg.create({
      data: {
        legalName: "Sunrise Family Chiropractic LLC",
        displayName: "Sunrise Family Chiropractic",
        billingEmail: "clinic@demo.test",
        status: "ACTIVE",
        hasPaymentMethod: true,
        paymentMethodLabel: "Visa •••• 4242 (test)",
        stripeCustomerId: "cus_fake_demo",
        agreementSignedAt: new Date(),
        agreementVersion: 1,
        members: { create: { user: { connect: { id: clinicOwner.id } }, role: "CLINIC_OWNER" } },
        locations: {
          create: {
            name: "Downtown Orlando",
            addressLine1: "100 N Orange Ave",
            city: "Orlando",
            state: "FL",
            zip: "32801",
            lat: 28.5421,
            lng: -81.3790,
            timeZone: "America/New_York",
            geocodedAt: new Date(),
            rateRegion: { connect: { id: region.id } },
            professionCodes: ["DC"],
            patientsPerDay: 45,
            ehr: "ChiroTouch",
            onSiteContactName: "Pat (front desk)",
            arrivalNotes: "Park in the rear lot; staff entrance is the blue door. Arrive 20 minutes early.",
            skills: { create: [{ skill: { connect: { id: diversified.id } } }] },
          },
        },
      },
    });
  }

  async function provider(email: string, name: string, homeZip: string, lat: number, lng: number, city: string, homeState: string, licenseStates: string[]) {
    const u = await user(email, name, "PROVIDER", "demo-password-1");
    const existing = await prisma.provider.findUnique({ where: { userId: u.id } });
    if (existing) return existing;
    const skills = await prisma.skill.findMany({ where: { professionCode: "DC", name: { in: ["Diversified", "Activator", "Thompson Drop"] } } });
    return prisma.provider.create({
      data: {
        user: { connect: { id: u.id } },
        legalName: name.replace(/^Dr\.\s*/, ""),
        displayName: name,
        npi: String(1000000000 + Math.floor(Math.random() * 899999999)),
        npiVerifiedAt: new Date(),
        homeAddress: `${city}, ${homeState} ${homeZip}`,
        homeCity: city,
        homeState,
        homeLat: lat,
        homeLng: lng,
        maxDriveMinutes: 90,
        stripeAccountId: `acct_fake_${u.id}`,
        stripePayoutsEnabled: true,
        agreementSignedAt: new Date(),
        agreementVersion: 1,
        profileCompleteAt: new Date(),
        status: "ACTIVE",
        bio: "Diversified and Activator; comfortable with high-volume family practices.",
        professions: { create: { profession: { connect: { code: "DC" } }, status: "ACTIVE", yearsInPractice: 9, profileCompleteAt: new Date() } },
        licenses: {
          create: licenseStates.map((state) => ({
            profession: { connect: { code: "DC" } },
            state,
            licenseNumber: `CH${Math.floor(10000 + Math.random() * 89999)}`,
            credentialTitle: "DC",
            expiresAt: far,
            status: "VERIFIED" as const,
            verifiedAt: new Date(),
            verificationMethod: "seed",
          })),
        },
        malpractice: {
          create: {
            carrier: "NCMIC",
            policyNumber: "DEMO-123",
            perOccurrenceCents: 100_000_000,
            aggregateCents: 300_000_000,
            coveredProfessionCodes: ["DC"],
            expiresAt: far,
            documentUrl: "demo/malpractice.pdf",
            status: "VERIFIED",
            verifiedAt: new Date(),
          },
        },
        skills: { create: skills.map((s) => ({ skill: { connect: { id: s.id } }, proficiency: 3 })) },
        availability: {
          create: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMin: 6 * 60, endMin: 20 * 60, timeZone: "America/New_York" })),
        },
        stats: { create: {} },
      },
    });
  }

  await provider("provider@demo.test", "Dr. Jane Rivera", "34741", 28.2919, -81.4076, "Kissimmee", "FL", ["FL"]);
  // Lives near Orlando but licensed only in GA — must never see FL shifts (INV-1).
  await provider("ga-provider@demo.test", "Dr. Sam Okafor", "32803", 28.5550, -81.3450, "Orlando", "FL", ["GA"]);
  console.log("Demo accounts (password demo-password-1): clinic@demo.test, provider@demo.test, ga-provider@demo.test");
}

async function main() {
  await seedBase(prisma);
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@coverageoncall.com";
  const exists = await prisma.user.findUnique({ where: { email } });
  if (!exists) {
    const password = process.env.SEED_ADMIN_PASSWORD ?? randomBytes(12).toString("base64url");
    await user(email, "Platform Admin", "PLATFORM_ADMIN", password);
    console.log(`Admin created: ${email}${process.env.SEED_ADMIN_PASSWORD ? "" : ` / temporary password: ${password}`} (MFA setup required at first login)`);
  }
  if (process.env.SEED_DEMO === "1") await seedDemo();
  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
