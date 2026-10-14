import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { FakeIdentity, identityProvider, setExclusionListFetcher } from "@cm/integrations";
import { admin as adminSvc, applyToShift, exclusions, getEligibleProviders, idcheck, invalidateSettings, selectApplicant, setClock } from "@cm/services";
import { makeClinic, makeProvider, makeShift } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };

/** A one-file .zip (stored, no compression), the way the app reads uploads. */
function zipOne(name: string, data: Buffer) {
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4);
  head.writeUInt32LE(data.length, 18);
  head.writeUInt32LE(data.length, 22);
  head.writeUInt16LE(Buffer.byteLength(name), 26);
  return Buffer.concat([head, Buffer.from(name), data]);
}
async function setting(key: string, value: unknown) {
  await adminSvc.updateSetting(admin, key, value);
  invalidateSettings();
}
const fake = () => identityProvider() as FakeIdentity;
const failures = async (shiftId: string, providerId: string) =>
  (await getEligibleProviders(prisma, shiftId)).excluded.find((e) => e.providerId === providerId)?.result.failures.map((f) => f.code) ?? [];

async function book(days: number) {
  const clinic = await makeClinic();
  const p = await makeProvider();
  const shift = await makeShift(clinic.location.id, { days });
  await applyToShift(p.actor, shift.id, { commit: true });
  const { assignmentId } = await selectApplicant(clinic.actor, shift.id, p.id);
  return { clinic, p, shift, assignmentId };
}

describe("photo ID check (Stripe Identity)", () => {
  beforeAll(async () => {
    await setting("idcheck.enabled", true);
  });
  afterAll(async () => {
    await setting("idcheck.enabled", false);
    setClock(null);
  });

  it("F17: an unverified provider can't take a shift starting within 48 hours, but can book later ones", async () => {
    const clinic = await makeClinic();
    const p = await makeProvider();
    const soon = await makeShift(clinic.location.id, { days: 239 });
    const later = await makeShift(clinic.location.id, { days: 250 });
    setClock(() => new Date(+soon.startsAt - 20 * 3_600_000));
    try {
      expect(await failures(soon.id, p.id)).toContain("ID_NOT_VERIFIED");
      expect((await getEligibleProviders(prisma, later.id)).eligible.map((e) => e.providerId)).toContain(p.id);
      await prisma.provider.update({ where: { id: p.id }, data: { idStatus: "VERIFIED" } });
      expect((await getEligibleProviders(prisma, soon.id)).eligible.map((e) => e.providerId)).toContain(p.id);
    } finally {
      setClock(null);
    }
  });

  it("a booking made while unverified gets a deadline, cleared once the ID checks out", async () => {
    const { p, assignmentId, shift } = await book(241);
    const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(a.idDueAt?.toISOString()).toBe(new Date(+shift.startsAt - 24 * 3_600_000).toISOString());
    const { url } = await idcheck.startIdCheck(p.actor);
    expect(url).toMatch(/\/provider\/verify-id\?done=1&session=vs_fake_/);
    expect(await idcheck.refreshIdCheck(p.id)).toBe("VERIFIED");
    expect((await prisma.provider.findUniqueOrThrow({ where: { id: p.id } })).idVerifiedAt).not.toBeNull();
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } })).idDueAt).toBeNull();
    await expect(idcheck.startIdCheck(p.actor)).rejects.toThrow(/already verified/);
  });

  it("at the deadline an unverified provider's booking is released; one waiting on review is escalated instead", async () => {
    const released = await book(242);
    const waiting = await book(242);
    await prisma.provider.update({ where: { id: waiting.p.id }, data: { idStatus: "NEEDS_REVIEW" } });
    const due = (await prisma.assignment.findUniqueOrThrow({ where: { id: released.assignmentId } })).idDueAt!;
    setClock(() => new Date(+due + 60_000));
    try {
      const out = await idcheck.idCheckSweep();
      expect(out.released).toBeGreaterThanOrEqual(1);
      const r = await prisma.assignment.findUniqueOrThrow({ where: { id: released.assignmentId } });
      expect(r.status).toBe("CANCELLED");
      expect(r.flags).toContain("ID_CHECK_MISSED");
      const w = await prisma.assignment.findUniqueOrThrow({ where: { id: waiting.assignmentId } });
      expect(w.status).toBe("CONFIRMED");
      expect(w.flags).toContain("ID_REVIEW_AT_DEADLINE");
      expect(await prisma.adminTask.count({ where: { kind: "ID_CHECK", entityId: waiting.assignmentId } })).toBe(1);
    } finally {
      setClock(null);
    }
  });

  it("failed tries are capped, a name mismatch goes to a person, and an admin can verify by hand", async () => {
    const p = await makeProvider();
    fake().nextOutcome = { status: "requires_input", errorCode: "selfie_face_mismatch" };
    await idcheck.startIdCheck(p.actor);
    expect(await idcheck.refreshIdCheck(p.id)).toBe("FAILED");
    expect((await idcheck.idCheckState(p.actor)).note).toMatch(/selfie/);
    fake().nextOutcome = { status: "requires_input", errorCode: "document_expired" };
    await idcheck.startIdCheck(p.actor);
    expect(await idcheck.refreshIdCheck(p.id)).toBe("NEEDS_REVIEW");
    await expect(idcheck.startIdCheck(p.actor)).rejects.toThrow(/being reviewed/);
    await idcheck.adminIdDecision(admin, p.id, "verify", "Called them and compared the ID on video");
    expect((await prisma.provider.findUniqueOrThrow({ where: { id: p.id } })).idStatus).toBe("VERIFIED");

    const q = await makeProvider();
    fake().nextOutcome = { firstName: "Someone", lastName: "Else" };
    await idcheck.startIdCheck(q.actor);
    expect(await idcheck.refreshIdCheck(q.id)).toBe("NEEDS_REVIEW");
    const row = await prisma.provider.findUniqueOrThrow({ where: { id: q.id } });
    expect(row.idNote).toMatch(/doesn't match/);
    expect(row.idNote).not.toMatch(/Someone|Else/);
  });

  it("a webhook from Stripe records the result", async () => {
    const p = await makeProvider();
    const { url } = await idcheck.startIdCheck(p.actor);
    const sessionId = new URL(url).searchParams.get("session")!;
    await idcheck.handleIdentityEvent({ id: sessionId, metadata: { providerId: p.id } });
    expect((await prisma.provider.findUniqueOrThrow({ where: { id: p.id } })).idStatus).toBe("VERIFIED");
  });
});

describe("federal exclusion lists", () => {
  const HEAD = "LASTNAME,FIRSTNAME,MIDNAME,BUSNAME,GENERAL,SPECIALTY,UPIN,NPI,DOB,ADDRESS,CITY,STATE,ZIP,EXCLTYPE,EXCLDATE,REINDATE,WAIVERDATE,WVRSTATE";
  const row = (last: string, first: string, npi: string, state: string, spec = "NURSE") => `"${last}","${first}","","","IND- LIC HC SERV PRO","${spec}","","${npi}","","","","${state}","","1128b4","20210301","00000000","00000000",""`;
  const filler = Array.from({ length: 1200 }, (_, i) => row(`FILLER${i}`, "PERSON", "0000000000", "TX"));
  let list: string[] = [];
  beforeAll(() => setExclusionListFetcher(async () => [HEAD, ...filler, ...list].join("\n")));
  afterAll(() => setExclusionListFetcher(null));

  it("an NPI on the OIG list is excluded at once: no new shifts and booked ones are released", async () => {
    const { p, assignmentId, clinic } = await book(243);
    await prisma.provider.update({ where: { id: p.id }, data: { npi: "1234567893" } });
    const named = await makeProvider();
    await prisma.provider.update({ where: { id: named.id }, data: { legalName: "Maria Exampleton" } });
    list = [row("NOBODY", "ELSE", "1234567893", "GA"), row("EXAMPLETON", "MARIA", "0000000000", "FL", "CHIROPRACTOR")];
    await exclusions.refreshLeie({ force: true });
    await exclusions.checkProviders({ all: true });

    const pr = await prisma.provider.findUniqueOrThrow({ where: { id: p.id } });
    expect(pr.exclusionStatus).toBe("EXCLUDED");
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } })).status).not.toBe("CONFIRMED");
    const other = await makeShift(clinic.location.id, { days: 244 });
    expect(await failures(other.id, p.id)).toContain("EXCLUDED_PROVIDER");

    // Same name in their state: flagged for a person, nothing blocked; "not the same person" sticks.
    expect((await prisma.provider.findUniqueOrThrow({ where: { id: named.id } })).exclusionStatus).toBe("POSSIBLE_MATCH");
    expect(await failures(other.id, named.id)).not.toContain("EXCLUDED_PROVIDER");
    await exclusions.adminExclusionDecision(admin, named.id, "not_same_person", "Different date of birth on her ID");
    await exclusions.checkProviders({ all: true });
    expect((await prisma.provider.findUniqueOrThrow({ where: { id: named.id } })).exclusionStatus).toBe("CLEAR");
  });

  it("an excluded provider who drops off the list isn't cleared automatically", async () => {
    const p = await makeProvider();
    await prisma.provider.update({ where: { id: p.id }, data: { npi: "1245319599" } });
    list = [row("GONE", "SOON", "1245319599", "FL")];
    await exclusions.refreshLeie({ force: true });
    await exclusions.checkProviders({ providerId: p.id });
    expect((await prisma.provider.findUniqueOrThrow({ where: { id: p.id } })).exclusionStatus).toBe("EXCLUDED");
    list = [];
    await exclusions.refreshLeie({ force: true });
    await exclusions.checkProviders({ providerId: p.id });
    expect((await prisma.provider.findUniqueOrThrow({ where: { id: p.id } })).exclusionStatus).toBe("EXCLUDED");
    expect(await prisma.adminTask.count({ where: { kind: "EXCLUSION", entityId: p.id, title: { contains: "no longer" } } })).toBe(1);
  });

  it("a SAM.gov extract can be uploaded", async () => {
    const p = await makeProvider();
    await prisma.provider.update({ where: { id: p.id }, data: { legalName: "Robert Samlisted" } });
    const sam = [
      '"Classification","Name","Prefix","First","Middle","Last","Suffix","Address 1","Address 2","Address 3","Address 4","City","State / Province","Country","Zip Code","Open Data Flag","Blank (Deprecated)","Unique Entity ID","Exclusion Program","Excluding Agency","CT Code","Exclusion Type","Additional Comments","Active Date","Termination Date","Record Status","Cross-Reference","SAM Number","CAGE","NPI","Creation_Date"',
      '"Individual","","","ROBERT","","SAMLISTED","","","","","","ORLANDO","FL","USA","","","","","Reciprocal","HHS","","Prohibition/Restriction","","01/02/2020","Indefinite","Active","","S4MR","","","01/02/2020"',
    ].join("\n");
    // Uploaded as SAM ships it (a .zip), queued, then loaded by the background job.
    await exclusions.queueExclusionFile(admin, zipOne("SAM_Exclusions_Public_Extract_V2.CSV", Buffer.from(sam)), "SAM_Exclusions_Public_Extract_V2.ZIP");
    expect((await exclusions.exclusionOverview(admin)).pending).toMatchObject({ kind: "file" });
    const r = await exclusions.exclusionImportSweep();
    expect(r).toMatchObject({ ok: true, message: expect.stringMatching(/Loaded 1 SAM\.gov listings/) });
    const o = await exclusions.exclusionOverview(admin);
    expect(o.pending).toBeNull();
    expect(o.running).toBeNull();
    expect(o.lastImport?.ok).toBe(true);
    expect((await prisma.provider.findUniqueOrThrow({ where: { id: p.id } })).exclusionStatus).toBe("POSSIBLE_MATCH");
    expect(await exclusions.exclusionImportSweep()).toEqual({ idle: true });
  });
});
