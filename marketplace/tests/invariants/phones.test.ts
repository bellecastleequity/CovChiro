import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { getEligibleProviders, phones, postShift, selectApplicant, updateOrg } from "@cm/services";
import { insertAssignment, makeClinic, makeProvider, makeShift } from "../factories";

/** Phone numbers on file (owner decision Oct 2026): providers 1, clinics 2; our team only. */
describe("phone numbers on file", () => {
  it("F15: a provider without a phone number isn't matched, and is again once one is saved", async () => {
    const clinic = await makeClinic();
    const p = await makeProvider({ phone: null });
    const shift = await makeShift(clinic.location.id, { days: 230 });
    let set = await getEligibleProviders(prisma, shift.id);
    expect(set.eligible.map((e) => e.providerId)).not.toContain(p.id);
    expect(set.excluded.find((e) => e.providerId === p.id)?.result.failures.map((f) => f.code)).toContain("PHONE_MISSING");

    await phones.setProviderPhone(p.actor, "(407) 555-0199");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: p.user.id } })).phone).toBe("+14075550199");
    set = await getEligibleProviders(prisma, shift.id);
    expect(set.eligible.map((e) => e.providerId)).toContain(p.id);
  });

  it("a provider with a live booking can change their number but not remove it", async () => {
    const clinic = await makeClinic();
    const p = await makeProvider();
    const shift = await makeShift(clinic.location.id, { days: 231 });
    await insertAssignment(shift.id, p.id);
    await expect(phones.setProviderPhone(p.actor, "")).rejects.toThrow(/must stay on file/);
    await phones.setProviderPhone(p.actor, "407-555-0198");
    const u = await prisma.user.findUniqueOrThrow({ where: { id: p.user.id } });
    expect(u.phone).toBe("+14075550198");
    expect(u.phoneVerifiedAt).toBeNull(); // a new number needs texting verified again
  });

  it("a provider without live bookings can remove the number (then can't apply or accept)", async () => {
    const p = await makeProvider();
    await phones.setProviderPhone(p.actor, null);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: p.user.id } })).phone).toBeNull();
    expect((await phones.phoneStatus(p.actor)).ok).toBe(false);
  });

  it("a clinic without two different numbers can't post or choose a provider", async () => {
    const clinic = await makeClinic({ phones: ["+14075550101", null] });
    const draft = await makeShift(clinic.location.id, { days: 232, status: "DRAFT" });
    await expect(postShift(clinic.actor, draft.id)).rejects.toThrow(/two phone numbers/);
    const open = await makeShift(clinic.location.id, { days: 233 });
    const p = await makeProvider();
    await expect(selectApplicant(clinic.actor, open.id, p.id)).rejects.toThrow(/two phone numbers/);
    await expect(phones.setClinicPhones(clinic.actor, "407-555-0101", "(407) 555-0101")).rejects.toThrow(/must be different/);
    await expect(phones.setClinicPhones(clinic.actor, "407-555-0101", "")).rejects.toThrow(/both phone numbers must stay/); // live shift
    await phones.setClinicPhones(clinic.actor, "407-555-0101", "407-555-0102");
    expect((await phones.phoneStatus(clinic.actor)).ok).toBe(true);
  });

  it("a clinic with live shifts can change a number but not remove one; without live shifts it can", async () => {
    const clinic = await makeClinic();
    await makeShift(clinic.location.id, { days: 234 });
    await expect(phones.setClinicPhones(clinic.actor, "", "407-555-0112")).rejects.toThrow(/must stay on file/);
    await phones.setClinicPhones(clinic.actor, "407-555-0111", "407-555-0112");
    expect(await prisma.clinicOrg.findUniqueOrThrow({ where: { id: clinic.org.id }, select: { phone: true, backupPhone: true } })).toEqual({ phone: "+14075550111", backupPhone: "+14075550112" });

    const quiet = await makeClinic();
    await phones.setClinicPhones(quiet.actor, "407-555-0121", "");
    expect((await phones.phoneStatus(quiet.actor)).ok).toBe(false);
  });

  it("staff can't change the clinic's numbers, and the clinic details form never touches them", async () => {
    const clinic = await makeClinic({ phones: ["+14075550131", "+14075550132"] });
    await expect(phones.setClinicPhones({ ...clinic.actor, role: "CLINIC_STAFF" }, "407-555-0133", "407-555-0134")).rejects.toThrow(/Only the clinic owner/);
    await updateOrg(clinic.actor, { legalName: "Renamed LLC", displayName: "Renamed", phone: null });
    expect((await prisma.clinicOrg.findUniqueOrThrow({ where: { id: clinic.org.id } })).phone).toBe("+14075550131");
  });
});
