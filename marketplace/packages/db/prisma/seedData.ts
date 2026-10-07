import type { PrismaClient } from "@prisma/client";
import { US_STATES } from "@cm/core";

/**
 * Launch configuration (Addendum 01 §11): StateConfig(FL) enabled,
 * ProfessionStateConfig(DC, FL) enabled, everything else disabled.
 * Values marked OWNER DECISION are placeholders the owner edits in the
 * admin panel. Idempotent: safe to run repeatedly.
 */

const M1 = 100_000_000; // $1M in cents — OWNER DECISION placeholder (A4)
const M3 = 300_000_000; // $3M

export const PROFESSIONS = [
  { code: "DC", displayName: "Chiropractor", slug: "chiropractic", credentialSuffix: "DC", npiRequired: true, pricingModel: "TIERED", supervision: false, supervising: [], active: true, sortOrder: 1 },
  { code: "PT", displayName: "Physical Therapist", slug: "physical-therapy", credentialSuffix: "PT", npiRequired: true, pricingModel: "TIERED", supervision: false, supervising: [], active: false, sortOrder: 2 },
  { code: "PTA", displayName: "Physical Therapist Assistant", slug: "physical-therapist-assistant", credentialSuffix: "PTA", npiRequired: true, pricingModel: "TIERED", supervision: true, supervising: ["PT"], active: false, sortOrder: 3 },
  { code: "OT", displayName: "Occupational Therapist", slug: "occupational-therapy", credentialSuffix: "OT", npiRequired: true, pricingModel: "TIERED", supervision: false, supervising: [], active: false, sortOrder: 4 },
  { code: "OTA", displayName: "Occupational Therapy Assistant", slug: "occupational-therapy-assistant", credentialSuffix: "OTA", npiRequired: true, pricingModel: "TIERED", supervision: true, supervising: ["OT"], active: false, sortOrder: 5 },
  { code: "LMT", displayName: "Massage Therapist", slug: "massage-therapy", credentialSuffix: "LMT", npiRequired: false, pricingModel: "HOURLY", supervision: false, supervising: [], active: false, sortOrder: 6 },
  { code: "LAC", displayName: "Acupuncturist", slug: "acupuncture", credentialSuffix: "L.Ac.", npiRequired: true, pricingModel: "TIERED", supervision: false, supervising: [], active: false, sortOrder: 7 },
  { code: "ATC", displayName: "Athletic Trainer", slug: "athletic-training", credentialSuffix: "ATC", npiRequired: true, pricingModel: "HOURLY", supervision: false, supervising: [], active: false, sortOrder: 8 },
  // Only NH, NM, ND and OR license sonographers; elsewhere the credential is a national registry (ARDMS/CCI/ARRT).
  { code: "SONO", displayName: "Ultrasound Sonographer", slug: "ultrasound-sonography", credentialSuffix: "Sonographer", npiRequired: false, pricingModel: "HOURLY", supervision: false, supervising: [], active: false, sortOrder: 9 },
] as const;

const SKILLS: Record<string, string[]> = {
  DC: ["Diversified", "Gonstead", "Activator", "Thompson Drop", "Cox Flexion-Distraction", "SOT", "Logan Basic", "Upper Cervical", "Torque Release", "Webster", "Extremity Adjusting"],
  PT: ["Orthopedic/Outpatient", "Sports", "Neuro", "Vestibular", "Pelvic Health", "Pediatrics", "Geriatrics", "Manual Therapy", "Aquatic"],
  PTA: ["Orthopedic/Outpatient", "Sports", "Neuro", "Vestibular", "Pelvic Health", "Pediatrics", "Geriatrics", "Manual Therapy", "Aquatic"],
  OT: ["Hand Therapy", "Pediatrics", "Neuro Rehab", "Ergonomics"],
  OTA: ["Hand Therapy", "Pediatrics", "Neuro Rehab", "Ergonomics"],
  LMT: ["Swedish", "Deep Tissue", "Sports Massage", "Myofascial Release", "Neuromuscular", "Prenatal", "Lymphatic Drainage", "Trigger Point"],
  LAC: ["TCM Acupuncture", "Japanese Style", "Auricular", "Cupping", "Gua Sha", "Electro-Acupuncture", "Herbal Consultation"],
  ATC: ["Event Coverage", "Taping/Bracing", "Injury Evaluation", "Return-to-Play"],
};
/**
 * Sonography specialties, each backed by a registry credential, so a provider
 * uploads the certificate and an admin verifies it before the skill counts.
 */
const CERTIFIED_SKILLS: Record<string, string[]> = {
  SONO: [
    "Abdomen", // ARDMS RDMS (AB)
    "OB/GYN", // ARDMS RDMS (OB/GYN)
    "Breast", // ARDMS RDMS (BR), ARRT (BS)
    "Pediatric Sonography", // ARDMS RDMS (PS)
    "Fetal Echocardiography", // ARDMS RDMS/RDCS (FE)
    "Adult Echocardiography", // ARDMS RDCS (AE), CCI RCS
    "Pediatric Echocardiography", // ARDMS RDCS (PE)
    "Congenital Cardiac", // CCI RCCS
    "Vascular", // ARDMS RVT, CCI RVS, ARRT (VS)
    "Musculoskeletal", // ARDMS RMSKS
    "Phlebology/Venous", // CCI RPhS
  ],
};
const CROSS_SKILLS = ["Kinesio Taping", "IASTM/Graston", "Active Release Technique", "Corrective Exercise"];
/** Scope-sensitive + certification-required. No SkillStateRule is seeded, so they are not allowed anywhere until an admin adds one. */
const SCOPE_SENSITIVE: [string, string][] = [
  ["Dry Needling", "DC"],
  ["Dry Needling", "PT"],
];

/**
 * FL ZIP3 → rate region: OWNER DECISION placeholder, editable in Admin → Rates.
 * Tier 1 = major cities (higher rate): Miami, Fort Lauderdale, West Palm Beach,
 * Orlando, Tampa, St. Petersburg, Jacksonville. Tier 2 = smaller cities and
 * towns (lower rate). The public pricing page groups regions by tier.
 */
export const FL_REGIONS = [
  // [clinic, provider] cents per volume tier (Addendum 03, owner-approved Oct 2026).
  { name: "FL-Major cities", tier: 1, zip3List: ["320", "322", "327", "328", "330", "331", "332", "333", "334", "335", "336", "337", "347"], half: { LIGHT: [27500, 23500], BUSY: [37500, 29500] }, full: { LIGHT: [50000, 42000], BUSY: [62500, 50000] } },
  { name: "FL-Smaller cities", tier: 2, zip3List: ["321", "323", "324", "325", "326", "329", "338", "339", "341", "342", "344", "346", "349"], half: { LIGHT: [25000, 21500], BUSY: [32500, 26500] }, full: { LIGHT: [45000, 39000], BUSY: [57500, 46500] } },
];

/** Territories (owner-approved Oct 2026; migration 0042 adds the same rows to existing databases): PR = Florida smaller cities, VI ≈ 20% above Florida major cities. */
export const TERRITORY_REGIONS = [
  { name: "PR-All", state: "PR", tier: 2, zip3List: ["006", "007", "009"], half: { LIGHT: [25000, 21500], BUSY: [32500, 26500] }, full: { LIGHT: [45000, 39000], BUSY: [57500, 46500] } },
  { name: "VI-All", state: "VI", tier: 1, zip3List: ["008"], half: { LIGHT: [33000, 28000], BUSY: [45000, 35500] }, full: { LIGHT: [60000, 50500], BUSY: [75000, 60000] } },
] as const;

/** Sonography in a state that doesn't license it: accept the national registries (A5). */
export const SONO_NATIONAL = {
  licensedAtStateLevel: false,
  alternativeCredentialAllowed: true,
  alternativeCredentialPolicy: "ARDMS (RDMS, RDCS, RVT, RMSKS), CCI (RCS, RCCS, RVS, RPhS) or ARRT sonography (S, BS, VS)",
  scopeNotes: "Florida does not license sonographers; a verified national registry credential is required instead.",
};

export async function seedBase(prisma: PrismaClient) {
  for (const p of PROFESSIONS) {
    const data = {
      displayName: p.displayName,
      slug: p.slug,
      credentialSuffix: p.credentialSuffix,
      npiRequired: p.npiRequired,
      pricingModel: p.pricingModel,
      defaultMalpracticeMinOccurrenceCents: M1,
      defaultMalpracticeMinAggregateCents: M3,
      requiresSupervisionDefault: p.supervision,
      defaultSupervisingProfessionCodes: [...p.supervising],
      active: p.active,
      sortOrder: p.sortOrder,
      volumePricingEnabled: p.code === "DC",
    };
    await prisma.profession.upsert({ where: { code: p.code }, create: { code: p.code, ...data }, update: {} });
  }

  for (const [prof, names] of Object.entries(SKILLS)) {
    for (const name of names) {
      await prisma.skill.upsert({ where: { name_professionCode: { name, professionCode: prof } }, create: { name, professionCode: prof }, update: {} });
    }
  }
  for (const [prof, names] of Object.entries(CERTIFIED_SKILLS)) {
    for (const name of names) {
      await prisma.skill.upsert({ where: { name_professionCode: { name, professionCode: prof } }, create: { name, professionCode: prof, requiresCertification: true }, update: {} });
    }
  }
  for (const name of CROSS_SKILLS) {
    const existing = await prisma.skill.findFirst({ where: { name, professionCode: null } });
    if (!existing) await prisma.skill.create({ data: { name, professionCode: null } });
  }
  for (const [name, prof] of SCOPE_SENSITIVE) {
    await prisma.skill.upsert({
      where: { name_professionCode: { name, professionCode: prof } },
      create: { name, professionCode: prof, scopeSensitive: true, requiresCertification: true },
      update: {},
    });
  }

  for (const state of Object.keys(US_STATES)) {
    await prisma.stateConfig.upsert({ where: { state }, create: { state }, update: {} });
  }
  // Launch state.
  await prisma.stateConfig.update({
    where: { state: "FL" },
    data: {
      legalReviewComplete: true,
      legalReviewNotes: "Seeded for the launch configuration — confirm attorney review is on file before go-live.",
      boardLookupUrl: "https://mqa-internet.doh.state.fl.us/MQASearchServices/HealthCareProviders",
      enabled: true,
      enabledAt: new Date(),
    },
  });

  const regionIds: Record<string, string> = {};
  for (const r of [...FL_REGIONS.map((x) => ({ ...x, state: "FL" })), ...TERRITORY_REGIONS]) {
    const region = await prisma.rateRegion.upsert({
      where: { name: r.name },
      create: { name: r.name, state: r.state, tier: r.tier, zip3List: [...r.zip3List] },
      update: {},
    });
    regionIds[r.name] = region.id;
    for (const [durationTier, tiers] of [
      ["HALF_DAY", r.half],
      ["FULL_DAY", r.full],
    ] as const) {
      for (const volumeTier of ["LIGHT", "BUSY"] as const) {
        const [clinic, provider] = tiers[volumeTier];
        const exists = await prisma.rateCard.findFirst({ where: { rateRegionId: region.id, professionCode: "DC", durationTier, volumeTier } });
        if (!exists) {
          await prisma.rateCard.create({
            data: { rateRegionId: region.id, professionCode: "DC", durationTier, volumeTier, clinicPriceCents: clinic, providerPayCents: provider, effectiveFrom: new Date("2026-01-01T00:00:00Z") },
          });
        }
      }
    }
  }
  await prisma.stateConfig.update({ where: { state: "FL" }, data: { defaultRateRegionId: regionIds["FL-Smaller cities"] } });
  for (const r of TERRITORY_REGIONS) {
    await prisma.stateConfig.updateMany({ where: { state: r.state, defaultRateRegionId: null }, data: { defaultRateRegionId: regionIds[r.name] } });
  }

  // Profession × FL rows so the admin matrix shows every cell; only DC is enabled.
  for (const p of PROFESSIONS) {
    const isDC = p.code === "DC";
    await prisma.professionStateConfig.upsert({
      where: { professionCode_state: { professionCode: p.code, state: "FL" } },
      create: {
        professionCode: p.code,
        state: "FL",
        supervisionRequired: isDC ? false : null,
        supervisingProfessionCodes: isDC ? [] : [...p.supervising],
        credentialTitle: p.code === "LAC" ? "A.P." : p.code === "LMT" ? "LMT" : p.credentialSuffix,
        // Florida has no sonographer license, so a national registry credential is the minimum (A5).
        ...(p.code === "SONO" ? SONO_NATIONAL : {}),
        malpracticeMinOccurrenceCents: M1,
        malpracticeMinAggregateCents: M3,
        ...(isDC
          ? {
              legalReviewComplete: true,
              legalReviewNotes: "Seeded for the launch configuration — confirm attorney review is on file before go-live.",
              boardLookupUrl: "https://mqa-internet.doh.state.fl.us/MQASearchServices/HealthCareProviders",
              enabled: true,
              enabledAt: new Date(),
            }
          : {}),
      },
      update: {},
    });
  }
}
