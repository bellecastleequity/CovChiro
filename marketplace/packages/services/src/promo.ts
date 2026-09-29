import { z } from "zod";
import { DomainError, normalizeCode, personalCode, promoLabel } from "@cm/core";
import { prisma, type Prisma, type PromoCode } from "@cm/db";
import { audit, getSettings, requireAdmin, type Actor, type Db } from "./context";

/**
 * Promo library (admin). Carried over from the current site:
 *  - library codes (percent/fixed, max uses, per-clinic limit, expiry, first-shift-only, on/off)
 *  - campaign landing pages (/offer/CODE) that issue per-person codes bound to an email
 *  - custom follow-up email copy per campaign
 *  - campaign stats: visits → signups → first shifts → revenue
 * Personal copies and welcome codes are managed from Leads, not listed here.
 */

export const PromoInput = z.object({
  code: z.string().min(2).max(40),
  kind: z.enum(["PERCENT", "FIXED"]),
  value: z.coerce.number().positive(),
  description: z.string().max(300).optional().nullable(),
  startsAt: z.coerce.date().optional().nullable(),
  expiresAt: z.coerce.date().optional().nullable(),
  maxUses: z.coerce.number().int().positive().optional().nullable(),
  maxUsesPerClinic: z.coerce.number().int().positive().optional().nullable(),
  firstShiftOnly: z.boolean().default(false),
});

export async function createPromo(actor: Actor, raw: z.input<typeof PromoInput>) {
  requireAdmin(actor);
  const input = PromoInput.parse(raw);
  const code = normalizeCode(input.code).replace(/[^A-Z0-9-]/g, "");
  if (code.length < 2) throw new DomainError("VALIDATION", "Use letters, numbers and dashes.");
  if (input.kind === "PERCENT" && input.value > 100) throw new DomainError("VALIDATION", "Percent off can't exceed 100.");
  if (await prisma.promoCode.findUnique({ where: { code } })) throw new DomainError("CONFLICT", "That code already exists.");
  const value = input.kind === "FIXED" ? Math.round(input.value * 100) : Math.round(input.value);
  const row = await prisma.promoCode.create({
    data: {
      code,
      kind: input.kind,
      value,
      description: input.description ?? null,
      startsAt: input.startsAt ?? null,
      expiresAt: input.expiresAt ?? null,
      maxUses: input.maxUses ?? null,
      maxUsesPerClinic: input.maxUsesPerClinic ?? 1,
      firstShiftOnly: input.firstShiftOnly,
      createdById: actor.userId,
    },
  });
  await audit(prisma, actor, "promo.created", "PromoCode", row.id, null, row);
  return row;
}

export async function updatePromo(actor: Actor, code: string, patch: Partial<{ active: boolean; expiresAt: Date | null; maxUses: number | null; description: string | null }>) {
  requireAdmin(actor);
  const row = await prisma.promoCode.findUnique({ where: { code: normalizeCode(code) } });
  if (!row) throw new DomainError("NOT_FOUND", "Code not found");
  const updated = await prisma.promoCode.update({ where: { id: row.id }, data: patch });
  await audit(prisma, actor, "promo.updated", "PromoCode", row.id, row, updated);
  return updated;
}

export const LandingInput = z.object({
  enabled: z.boolean(),
  audience: z.enum(["CLINIC", "PROVIDER"]).default("CLINIC"),
  headline: z.string().max(200).optional().nullable(),
  description: z.string().max(1000).optional().nullable(),
});

export async function saveLanding(actor: Actor, code: string, raw: z.input<typeof LandingInput>) {
  requireAdmin(actor);
  const input = LandingInput.parse(raw);
  const row = await prisma.promoCode.findFirst({ where: { code: normalizeCode(code), parentId: null, isWelcome: false } });
  if (!row) throw new DomainError("NOT_FOUND", "Code not found");
  await prisma.promoCode.update({
    where: { id: row.id },
    data: { landingEnabled: input.enabled, landingAudience: input.audience, landingHeadline: input.headline?.trim() || null, landingDescription: input.description?.trim() || null },
  });
  await audit(prisma, actor, "promo.landing_saved", "PromoCode", row.id, null, input);
}

export const DRIP_SUBJECT_MAX = 150;
export const DRIP_INTRO_MAX = 1200;

export async function saveDripCopy(actor: Actor, code: string, emails: { subject: string; intro: string }[]) {
  requireAdmin(actor);
  const row = await prisma.promoCode.findFirst({ where: { code: normalizeCode(code), parentId: null, isWelcome: false } });
  if (!row) throw new DomainError("NOT_FOUND", "Code not found");
  const clean = emails.slice(0, 10).map((e, i) => {
    const subject = e.subject.replace(/\s+/g, " ").trim();
    const intro = e.intro.trim();
    if (subject.length > DRIP_SUBJECT_MAX) throw new DomainError("VALIDATION", `Email ${i + 1}: subject is too long.`);
    if (intro.length > DRIP_INTRO_MAX) throw new DomainError("VALIDATION", `Email ${i + 1}: opening paragraph is too long.`);
    return { subject, intro };
  });
  const any = clean.some((e) => e.subject || e.intro);
  await prisma.promoCode.update({ where: { id: row.id }, data: { dripCustom: any ? (clean as Prisma.InputJsonValue) : undefined } });
  await audit(prisma, actor, "promo.drip_saved", "PromoCode", row.id);
}

/** Library list with campaign funnel stats. */
export async function listPromos(actor: Actor) {
  requireAdmin(actor);
  const codes = await prisma.promoCode.findMany({ where: { parentId: null, isWelcome: false }, orderBy: { createdAt: "desc" } });
  const out = [];
  for (const c of codes) {
    const [signups, converted, redemptions] = await Promise.all([
      prisma.lead.count({ where: { campaignCode: c.code } }),
      prisma.lead.count({ where: { campaignCode: c.code, status: "CONVERTED" } }),
      prisma.promoRedemption.findMany({
        where: { voidedAt: null, promoCode: { OR: [{ id: c.id }, { parentId: c.id }] } },
        include: { promoCode: true },
      }),
    ]);
    const shiftIds = redemptions.map((r) => r.shiftId);
    const revenue = shiftIds.length
      ? await prisma.assignment.aggregate({ where: { shiftId: { in: shiftIds }, status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED", "DISPUTED"] } }, _sum: { clinicTotalCents: true } })
      : { _sum: { clinicTotalCents: 0 } };
    out.push({
      ...c,
      label: promoLabel(c),
      stats: {
        visits: c.landingVisits,
        signups,
        converted,
        redemptions: redemptions.length,
        discountCents: redemptions.reduce((x, r) => x + r.discountCents, 0),
        revenueCents: revenue._sum.clinicTotalCents ?? 0,
      },
    });
  }
  return out;
}

/** An active library code with its landing page on. */
export async function activeCampaign(db: Db, code: string): Promise<PromoCode | null> {
  const now = new Date();
  return db.promoCode.findFirst({
    where: {
      code: normalizeCode(code),
      landingEnabled: true,
      active: true,
      parentId: null,
      isWelcome: false,
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, { OR: [{ startsAt: null }, { startsAt: { lte: now } }] }],
    },
  });
}

/** Public landing data; counts a visit unless it's an admin preview. */
export async function campaignForLanding(code: string, preview = false) {
  const c = await activeCampaign(prisma, code);
  if (!c) return null;
  if (!preview) await prisma.promoCode.update({ where: { id: c.id }, data: { landingVisits: { increment: 1 } } });
  const s = await getSettings();
  return { code: c.code, audience: c.landingAudience, headline: c.landingHeadline, description: c.landingDescription, offer: promoLabel(c), expiresAt: personalExpiry(c, s["promo.welcomeOfferDays"]) };
}

export function personalExpiry(campaign: Pick<PromoCode, "expiresAt">, days: number): Date {
  const d = new Date(Date.now() + days * 86_400_000);
  return campaign.expiresAt && campaign.expiresAt < d ? campaign.expiresAt : d;
}

async function uniqueCode(db: Db, prefix: string) {
  for (;;) {
    const code = personalCode(prefix);
    if (!(await db.promoCode.findUnique({ where: { code } }))) return code;
  }
}

/** Per-person, single-use copy of a campaign code bound to an email. */
export async function issuePersonalCode(db: Db, campaign: PromoCode, email: string) {
  const s = await getSettings(db);
  return db.promoCode.create({
    data: {
      code: await uniqueCode(db, campaign.code),
      kind: campaign.kind,
      value: campaign.value,
      maxUses: 1,
      maxUsesPerClinic: 1,
      firstShiftOnly: campaign.firstShiftOnly,
      expiresAt: personalExpiry(campaign, s["promo.welcomeOfferDays"]),
      assignedEmail: email,
      parentId: campaign.id,
    },
  });
}

/** Homepage welcome offer for clinics: X% off the first shift, bound to the email. */
export async function issueWelcomeCode(db: Db, email: string) {
  const s = await getSettings(db);
  return db.promoCode.create({
    data: {
      code: await uniqueCode(db, "WELCOME"),
      kind: "PERCENT",
      value: s["promo.welcomeOfferPercent"],
      maxUses: 1,
      maxUsesPerClinic: 1,
      firstShiftOnly: true,
      expiresAt: new Date(Date.now() + s["promo.welcomeOfferDays"] * 86_400_000),
      assignedEmail: email,
      isWelcome: true,
    },
  });
}

export function codeStillGood(p: PromoCode | null): p is PromoCode {
  return !!p && p.active && (!p.expiresAt || p.expiresAt > new Date()) && (p.maxUses === null || p.usedCount < p.maxUses);
}
