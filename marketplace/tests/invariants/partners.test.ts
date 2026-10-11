import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { applyToShift, createShift, invalidateSettings, partners, quoteShift, selectApplicant } from "@cm/services";
import type { Actor } from "@cm/services";
import { futureWeekday, makeClinic, makeProvider, uid } from "../factories";

async function setSetting(key: string, value: unknown) {
  await prisma.setting.upsert({ where: { key }, create: { key, value: value as object }, update: { value: value as object } });
  invalidateSettings();
}
const meta = { ip: "127.0.0.1", userAgent: "vitest" };
const admin = async (): Promise<Actor> => {
  const u = await prisma.user.create({ data: { email: `a-${uid()}@test.dev`, name: "Admin", role: "PLATFORM_ADMIN", emailVerifiedAt: new Date() } });
  return { userId: u.id, role: "PLATFORM_ADMIN", providerId: null, clinicOrgId: null };
};
async function becomePartner(clinic: Awaited<ReturnType<typeof makeClinic>>, a: Actor) {
  const offer = await partners.offerPartnership(a, clinic.org.id);
  const view = await partners.partnerAddendumForSigning(clinic.actor);
  await partners.signPartnerAddendum(clinic.actor, { id: offer.id, typedName: "Pat Owner", title: "Owner", consent: true, agree: true, viewedHash: view.hash }, meta);
  return offer.id;
}
const day = (days = 21) => futureWeekday(days);

afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: { in: ["features.partnerProgram", "promo.maxShareOfMarginPercent"] } } });
  invalidateSettings();
});

describe("partner clinic program", () => {
  beforeAll(async () => setSetting("features.partnerProgram", false));

  it("is off by default: no offers, no discount", async () => {
    const clinic = await makeClinic();
    await expect(partners.offerPartnership(await admin(), clinic.org.id)).rejects.toThrow(/Turn on the partner clinic program/);
    const q = await quoteShift(prisma, { locationId: clinic.location.id, professionCode: "DC", ...day() });
    expect(q.partner).toBeNull();
  });

  it("offer → owner signs → 5% off every shift from our margin, provider pay unchanged", async () => {
    await setSetting("features.partnerProgram", true);
    const a = await admin();
    const clinic = await makeClinic();
    const before = await quoteShift(prisma, { locationId: clinic.location.id, professionCode: "DC", ...day() });
    expect(before.partner).toBeNull();

    // Staff can't sign; a stale hash is refused.
    const offer = await partners.offerPartnership(a, clinic.org.id);
    const staffUser = await prisma.user.create({ data: { email: `s-${uid()}@test.dev`, name: "Front desk", role: "CLINIC_STAFF", emailVerifiedAt: new Date() } });
    await prisma.clinicMember.create({ data: { userId: staffUser.id, clinicOrgId: clinic.org.id, role: "CLINIC_STAFF" } });
    const staff: Actor = { userId: staffUser.id, role: "CLINIC_STAFF", providerId: null, clinicOrgId: clinic.org.id };
    await expect(partners.partnerAddendumForSigning(staff)).rejects.toThrow();
    await expect(partners.signPartnerAddendum(clinic.actor, { id: offer.id, typedName: "Pat Owner", title: "Owner", consent: true, agree: true, viewedHash: "0".repeat(64) }, meta)).rejects.toThrow(/updated while you were reading/);

    const view = await partners.partnerAddendumForSigning(clinic.actor);
    expect(view.doc.title).toContain("Partner Addendum");
    await partners.signPartnerAddendum(clinic.actor, { id: offer.id, typedName: "Pat Owner", title: "Owner", consent: true, agree: true, viewedHash: view.hash }, meta);
    const signed = await prisma.clinicPartnership.findUniqueOrThrow({ where: { id: offer.id } });
    expect(signed).toMatchObject({ status: "ACTIVE", discountPercent: 5, termMonths: 12, typedSignature: "Pat Owner", signerTitle: "Owner" });
    expect(signed.documentHash).toHaveLength(64);

    const q = await quoteShift(prisma, { locationId: clinic.location.id, professionCode: "DC", ...day() });
    expect(q.base.clinicPriceCents).toBe(before.base.clinicPriceCents);
    expect(q.base.providerPayCents).toBe(before.base.providerPayCents);
    expect(q.partner).toMatchObject({ id: offer.id, percent: 5, discountCents: Math.round(before.base.clinicPriceCents * 0.05), lockedFromCents: null });

    // Posted and booked: the shift and booking carry the discount; the provider is paid in full.
    const p = await makeProvider();
    const { shiftId } = await createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", ...day() } as never, { post: true });
    const sh = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(sh).toMatchObject({ partnershipId: offer.id, partnerDiscountCents: q.partner!.discountCents, promoDiscountCents: q.partner!.discountCents });
    await applyToShift(p.actor, shiftId, { commit: true });
    await selectApplicant(clinic.actor, shiftId, p.id);
    const as = await prisma.assignment.findFirstOrThrow({ where: { shiftId } });
    expect(as.partnerDiscountCents).toBe(q.partner!.discountCents);
    expect(as.providerPayCents).toBe(sh.providerPayCents);
    expect(as.clinicTotalCents).toBe(sh.clinicPriceCents - q.partner!.discountCents + as.mileageCents + as.lodgingEstimateCents + as.airfareCents);
    expect((await partners.discountsGiven(offer.id)).cents).toBe(q.partner!.discountCents);
    const report = await partners.partnerReport(a);
    expect(report.find((r) => r.p.id === offer.id)?.all.cents).toBe(q.partner!.discountCents);

    // Turning the program off stops partner pricing at once.
    await setSetting("features.partnerProgram", false);
    expect((await quoteShift(prisma, { locationId: clinic.location.id, professionCode: "DC", ...day() })).partner).toBeNull();
    await setSetting("features.partnerProgram", true);
  });

  it("promo + partner discounts share the margin cap", async () => {
    await setSetting("features.partnerProgram", true);
    await setSetting("promo.maxShareOfMarginPercent", 10);
    const clinic = await makeClinic();
    await becomePartner(clinic, await admin());
    const q = await quoteShift(prisma, { locationId: clinic.location.id, professionCode: "DC", ...day() });
    const cap = Math.floor((q.base.clinicPriceCents - q.base.providerPayCents) * 0.1);
    expect(q.partner!.discountCents).toBe(Math.min(Math.round(q.base.clinicPriceCents * 0.05), cap));
    await prisma.setting.deleteMany({ where: { key: "promo.maxShareOfMarginPercent" } });
    invalidateSettings();
  });

  it("locks the clinic price at the term's card; provider pay follows today's card", async () => {
    await setSetting("features.partnerProgram", true);
    const clinic = await makeClinic();
    // Own region with an old card and a newer, pricier one.
    const region = await prisma.rateRegion.create({ data: { state: clinic.location.state, name: `Lock-${uid()}`, tier: 1, zip3List: [] } });
    await prisma.clinicLocation.update({ where: { id: clinic.location.id }, data: { rateRegionId: region.id } });
    const month = 30 * 86_400_000;
    await prisma.rateCard.create({ data: { rateRegionId: region.id, professionCode: "DC", durationTier: "FULL_DAY", clinicPriceCents: 60000, providerPayCents: 50000, effectiveFrom: new Date("2020-01-01"), effectiveTo: new Date(Date.now() - month) } });
    await prisma.rateCard.create({ data: { rateRegionId: region.id, professionCode: "DC", durationTier: "FULL_DAY", clinicPriceCents: 70000, providerPayCents: 52000, effectiveFrom: new Date(Date.now() - month) } });
    await prisma.clinicPartnership.create({ data: { clinicOrgId: clinic.org.id, status: "ACTIVE", discountPercent: 5, termMonths: 12, releaseHours: 4, noticeDays: 30, startsAt: new Date(Date.now() - 2 * month) } });
    const q = await quoteShift(prisma, { locationId: clinic.location.id, professionCode: "DC", ...day() });
    expect(q.base.providerPayCents).toBe(52000);
    expect(q.base.clinicPriceCents).toBe(60000);
    expect(q.partner).toMatchObject({ lockedFromCents: 70000, discountCents: 3000 });
  });

  it("ending now stops partner pricing; ending at term end keeps it until then", async () => {
    await setSetting("features.partnerProgram", true);
    const a = await admin();
    const clinic = await makeClinic();
    const id = await becomePartner(clinic, a);
    const endsAt = await partners.endPartnership(a, id, { when: "term_end", reason: "Clinic gave notice" });
    expect(+endsAt).toBeGreaterThan(Date.now() + 300 * 86_400_000);
    expect((await quoteShift(prisma, { locationId: clinic.location.id, professionCode: "DC", ...day() })).partner).not.toBeNull();
    // A partner can't be offered again while in force.
    await expect(partners.offerPartnership(a, clinic.org.id)).rejects.toThrow(/already a partner/);

    const clinic2 = await makeClinic();
    const id2 = await becomePartner(clinic2, a);
    await partners.endPartnership(a, id2, { when: "now", reason: "Booked elsewhere" });
    expect((await quoteShift(prisma, { locationId: clinic2.location.id, professionCode: "DC", ...day() })).partner).toBeNull();
    expect((await partners.partnerClinicIds([clinic.org.id, clinic2.org.id])).has(clinic.org.id)).toBe(true);
    expect((await partners.partnerClinicIds([clinic2.org.id])).size).toBe(0);
  });
});
