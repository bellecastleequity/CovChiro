import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { setNppesProvider, type NppesRecord } from "@cm/integrations";
import { assertProviderEligibleForShift, clinicVerify, createShift, dispatch, getEligibleProviders, shiftBoard } from "@cm/services";
import { futureWeekday, makeClinic, makeProvider, uid } from "../factories";

const admin = async () => {
  const u = await prisma.user.create({ data: { email: `adm-${uid()}@test.dev`, name: "Owner", role: "PLATFORM_ADMIN" } });
  return { userId: u.id, role: "PLATFORM_ADMIN" as const, providerId: null, clinicOrgId: null };
};

const ORG_NPI = "1234567893";
/** A registry where the clinic's organization NPI and its owner's license check out. */
function registry(over: { official?: string; zip?: string; license?: string } = {}) {
  const org: NppesRecord = {
    npi: ORG_NPI,
    kind: "organization",
    name: "SUNSHINE CHIROPRACTIC LLC",
    firstName: null,
    lastName: null,
    credential: null,
    taxonomyCodes: ["111N00000X"],
    location: { line1: "1 Main St", line2: null, city: "Orlando", state: "FL", zip: over.zip ?? "328011234", phone: null },
    authorizedOfficial: over.official ?? "JANE DOE",
  };
  const jane: NppesRecord = { npi: "1497758544", kind: "individual", name: "", firstName: "JANE", lastName: "DOE", credential: "DC", taxonomyCodes: ["111N00000X"], location: null, licenses: [{ number: over.license ?? "CH12345", state: "FL" }] };
  setNppesProvider({ name: "fake", search: async () => [], lookup: async (n) => (n === ORG_NPI ? org : null), findPeople: async (q) => (q.lastName.toLowerCase() === "doe" ? [jane] : []) });
}
afterEach(() => setNppesProvider(null));

const form = (over: Record<string, unknown> = {}) => ({
  entityName: "Sunshine Chiropractic LLC",
  entityState: "FL",
  entityNumber: `L${uid()}`,
  orgNpi: ORG_NPI,
  owners: [{ name: "Dr. Jane Doe", percent: 100, licensed: true, professionCode: "DC", licenseState: "FL", licenseNumber: "CH 12345" }],
  facilityLicenseNumber: null,
  facilityExemptionNumber: null,
  documentKeys: [],
  attestName: "Jane Doe",
  ...over,
});

async function newClinic() {
  // Orlando ZIP to match the registry's practice address.
  // Its own street address (factory clinics share one; a suspended one elsewhere in the suite would look linked).
  const c = await makeClinic({ verification: "NOT_STARTED", zip: "32801", address: `${uid()} Orange Ave` });
  const p = await makeProvider();
  const { startsAt, endsAt } = futureWeekday(20);
  const { shiftId } = await createShift(c.actor, { locationId: c.location.id, professionCode: "DC", startsAt, endsAt }, { post: true });
  return { c, p, shiftId };
}

describe("clinic ownership verification", () => {
  it("an unverified clinic can post, but its shift isn't shown, offered or dispatched (F13)", async () => {
    const { p, shiftId } = await newClinic();
    expect((await shiftBoard(p.actor)).map((s: { id: string }) => s.id)).not.toContain(shiftId);
    const set = await getEligibleProviders(prisma, shiftId);
    expect(set.eligible.map((e) => e.providerId)).not.toContain(p.id);
    expect(set.excluded.find((e) => e.providerId === p.id)?.result.failures.map((f) => f.filter)).toEqual(["F13"]);
    expect((await dispatch.startDispatch(shiftId, "SELECTION_DEADLINE")).state).toMatch(/not verified/);
    await prisma.shift.update({ where: { id: shiftId }, data: { selectionDeadline: new Date(Date.now() - 60_000) } });
    await dispatch.runSelectionDeadlines();
    expect(await prisma.dispatch.count({ where: { shiftId } })).toBe(0);
  });

  it("a clean practitioner-owned clinic is verified at once and its held shifts go out", async () => {
    registry();
    const { c, p, shiftId } = await newClinic();
    const r = await clinicVerify.submitVerification(c.actor, form());
    expect(r).toEqual({ status: "VERIFIED", autoApproved: true });
    const org = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: c.org.id } });
    expect(org.verificationStatus).toBe("VERIFIED");
    expect(+org.verifiedUntil!).toBeGreaterThan(Date.now() + 360 * 86_400_000);
    expect((await shiftBoard(p.actor)).map((s: { id: string }) => s.id)).toContain(shiftId);
    // Posting notices go out now (to the top-ranked eligible providers).
    expect(await prisma.notification.count({ where: { template: "shift_available", link: `/provider/shifts/${shiftId}` } })).toBeGreaterThan(0);
  });

  it("an owner whose license is verified here matches without the registry", async () => {
    const { c } = await newClinic();
    const dc = await makeProvider();
    await prisma.provider.update({ where: { id: dc.id }, data: { legalName: "Jane Doe" } });
    const lic = await prisma.license.findFirstOrThrow({ where: { providerId: dc.id } });
    setNppesProvider({ name: "fake", search: async () => [], lookup: async () => ({ npi: ORG_NPI, kind: "organization", name: "X", firstName: null, lastName: null, credential: null, taxonomyCodes: [], location: { line1: "1", line2: null, city: "Orlando", state: "FL", zip: "32801", phone: null }, authorizedOfficial: "Jane Doe" }), findPeople: async () => [] });
    const r = await clinicVerify.submitVerification(c.actor, form({ owners: [{ name: "Jane Doe", percent: 100, licensed: true, professionCode: "DC", licenseState: "FL", licenseNumber: lic.licenseNumber }] }));
    expect(r.autoApproved).toBe(true);
  });

  it("form problems are refused; staff can't sign for the owner", async () => {
    const { c } = await newClinic();
    await expect(clinicVerify.submitVerification(c.actor, form({ owners: [{ name: "Jane Doe", percent: 50, licensed: true, professionCode: "DC", licenseState: "FL", licenseNumber: "CH1" }] }))).rejects.toThrow(/100%/);
    await expect(clinicVerify.submitVerification({ ...c.actor, role: "CLINIC_STAFF" }, form())).rejects.toThrow(/owner/);
  });

  it("non-practitioner owners go to a person: needs info, then approve releases the shifts", async () => {
    registry();
    const actor = await admin();
    const { c, p, shiftId } = await newClinic();
    const r = await clinicVerify.submitVerification(
      c.actor,
      form({ owners: [{ name: "Jane Doe", percent: 51, licensed: true, professionCode: "DC", licenseState: "FL", licenseNumber: "CH12345" }, { name: "Max Investor", percent: 49, licensed: false }], facilityLicenseNumber: "HCC9999", documentKeys: [`clinics/${c.org.id}/verification/a.pdf`] }),
    );
    expect(r).toMatchObject({ status: "PENDING", autoApproved: false });
    const q = await clinicVerify.listClinicVerifications(actor);
    const row = q.rows.find((x) => x.clinicOrgId === c.org.id)!;
    expect(row.checks.find((x) => x.key === "ownership")?.outcome).toBe("REVIEW");
    await expect(clinicVerify.decideClinicVerification(actor, row.id, "NEEDS_INFO", "")).rejects.toThrow(/Say what/);
    await clinicVerify.decideClinicVerification(actor, row.id, "NEEDS_INFO", "Please upload the AHCA license certificate.");
    expect((await prisma.clinicOrg.findUniqueOrThrow({ where: { id: c.org.id } })).verificationStatus).toBe("NEEDS_INFO");
    await clinicVerify.decideClinicVerification(actor, row.id, "APPROVE", null);
    expect((await prisma.clinicOrg.findUniqueOrThrow({ where: { id: c.org.id } })).verificationStatus).toBe("VERIFIED");
    expect((await shiftBoard(p.actor)).map((s: { id: string }) => s.id)).toContain(shiftId);
  });

  it("mismatches go to review: wrong authorized official, unknown license, links to a banned clinic", async () => {
    for (const [reg, why] of [
      [{ official: "BOB ROSS" }, /BOB ROSS/],
      [{ license: "CH99999" }, /wasn't found/],
    ] as const) {
      registry(reg);
      const { c } = await newClinic();
      expect((await clinicVerify.submitVerification(c.actor, form())).status).toBe("PENDING");
      const v = await prisma.clinicVerification.findFirstOrThrow({ where: { clinicOrgId: c.org.id } });
      expect(JSON.stringify(v.checks)).toMatch(why);
    }
    registry();
    const bad = await makeClinic();
    await prisma.clinicOrg.update({ where: { id: bad.org.id }, data: { status: "SUSPENDED", phone: "+14075550199" } });
    const { c } = await newClinic();
    await prisma.clinicOrg.update({ where: { id: c.org.id }, data: { phone: "(407) 555-0199" } });
    expect((await clinicVerify.submitVerification(c.actor, form())).status).toBe("PENDING");
  });

  it("existing clinics keep working through the grace period; reminders and the lapse notice go once; bookings are untouched", async () => {
    const { c, p, shiftId } = await newClinic();
    const now = Date.now();
    await prisma.clinicOrg.update({ where: { id: c.org.id }, data: { verificationGraceUntil: new Date(now + 5 * 86_400_000) } });
    expect(await clinicVerify.clinicIsCleared(prisma, c.org.id)).toBe(true);
    await clinicVerify.clinicVerifySweep();
    await clinicVerify.clinicVerifySweep();
    expect(await prisma.notification.count({ where: { userId: c.user.id, template: "clinic_verification_reminder" } })).toBe(1);
    // Booked while in grace, then the grace runs out: the booking still passes the credential re-checks.
    await expect(assertProviderEligibleForShift(prisma, p.id, shiftId)).resolves.toBeTruthy();
    await prisma.clinicOrg.update({ where: { id: c.org.id }, data: { verificationGraceUntil: new Date(now - 3_600_000) } });
    expect(await clinicVerify.clinicIsCleared(prisma, c.org.id)).toBe(false);
    await expect(assertProviderEligibleForShift(prisma, p.id, shiftId)).rejects.toThrow(/verification/);
    await expect(assertProviderEligibleForShift(prisma, p.id, shiftId, { credentialsOnly: true })).resolves.toBeTruthy();
    await clinicVerify.clinicVerifySweep();
    await clinicVerify.clinicVerifySweep();
    expect(await prisma.notification.count({ where: { userId: c.user.id, template: "clinic_verification_lapsed" } })).toBe(1);
  });

  it("admin can verify a known clinic by hand (with a note), extend, or ask again", async () => {
    const actor = await admin();
    const { c } = await newClinic();
    await expect(clinicVerify.adminSetClinicVerification(actor, c.org.id, "VERIFY", "")).rejects.toThrow(/Note/);
    await clinicVerify.adminSetClinicVerification(actor, c.org.id, "VERIFY", "Known practice; checked Sunbiz and AHCA by phone.");
    expect(await clinicVerify.clinicIsCleared(prisma, c.org.id)).toBe(true);
    await clinicVerify.adminSetClinicVerification(actor, c.org.id, "RESET", "Ownership changed.");
    expect(await clinicVerify.clinicIsCleared(prisma, c.org.id)).toBe(false);
    await clinicVerify.adminSetClinicVerification(actor, c.org.id, "EXTEND", null);
    expect(await clinicVerify.clinicIsCleared(prisma, c.org.id)).toBe(true);
  });

  it("documents by email: admin uploads them, marks items OK one by one, then verifies", async () => {
    registry({ license: "CH99999" }); // owner's license not found → needs a person
    const actor = await admin();
    const { c, p, shiftId } = await newClinic();
    const lay = form({ owners: [{ name: "Jane Doe", percent: 51, licensed: true, professionCode: "DC", licenseState: "FL", licenseNumber: "CH12345" }, { name: "Max Investor", percent: 49, licensed: false }], facilityLicenseNumber: "HCC9999" });
    await expect(clinicVerify.submitVerification(c.actor, lay)).rejects.toThrow(/email the documents/);
    const r = await clinicVerify.submitVerification(c.actor, { ...lay, documentsLater: true });
    expect(r.status).toBe("PENDING");
    const id = r.verificationId!;
    await expect(clinicVerify.approveCheck(actor, id, "owner_0", "")).rejects.toThrow(/how you checked/);
    await expect(clinicVerify.approveCheck(c.actor, id, "owner_0", "x")).rejects.toThrow();
    expect((await clinicVerify.approveCheck(actor, id, "owner_0", "Confirmed on the FL board lookup")).remaining).toBe(3);
    await expect(clinicVerify.addVerificationDocuments(actor, id, ["clinics/other/x.pdf"])).rejects.toThrow(/folder/);
    await clinicVerify.addVerificationDocuments(actor, id, [`clinics/${c.org.id}/verification/emailed.pdf`]);
    await clinicVerify.approveCheck(actor, id, "documents", "AHCA certificate received by email");
    await clinicVerify.approveCheck(actor, id, "ownership", "Investor ownership allowed with the AHCA license");
    expect((await clinicVerify.approveCheck(actor, id, "facility", "AHCA license HCC9999 active on the state lookup")).remaining).toBe(0);
    const row = await prisma.clinicVerification.findUniqueOrThrow({ where: { id } });
    expect(row.documentKeys).toEqual([`clinics/${c.org.id}/verification/emailed.pdf`]);
    expect(JSON.stringify(row.checks)).toMatch(/Confirmed on the FL board lookup/);
    await clinicVerify.decideClinicVerification(actor, id, "APPROVE", null);
    expect((await shiftBoard(p.actor)).map((s: { id: string }) => s.id)).toContain(shiftId);
  });

  it("an admin can enter the form for a clinic (with a note on how the owner gave the details)", async () => {
    registry();
    const actor = await admin();
    const { c } = await newClinic();
    await expect(clinicVerify.submitVerification(actor, form(), { clinicOrgId: c.org.id })).rejects.toThrow(/Note how/);
    const r = await clinicVerify.submitVerification(actor, form(), { clinicOrgId: c.org.id, adminNote: "Phone call with Dr. Doe" });
    expect(r.autoApproved).toBe(true);
    const row = await prisma.clinicVerification.findFirstOrThrow({ where: { clinicOrgId: c.org.id } });
    expect(row.attestName).toMatch(/entered by an admin: Phone call with Dr. Doe/);
    expect(row.submittedById).toBe(actor.userId);
    expect((await clinicVerify.adminVerificationForm(actor, c.org.id)).form.prefill.entityName).toBe("Sunshine Chiropractic LLC");
  });
});

