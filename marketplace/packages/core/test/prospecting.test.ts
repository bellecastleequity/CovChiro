import { describe, expect, it } from "vitest";
import { acceptBusinessEmail, addressKey, applyResearch, detectFranchise, groupRegistryRecords, registryIndividuals, type RegistryRecord, type ResearchFindings } from "../src";

const rec = (o: Partial<RegistryRecord>): RegistryRecord => ({
  npi: "1000000000", kind: "individual", name: "", firstName: null, lastName: null, credential: "DC", taxonomyCodes: ["111N00000X"],
  location: { line1: "100 Main Street, Suite 200", line2: null, city: "TAMPA", state: "FL", zip: "336021234", phone: "813-555-0100" }, ...o,
});

describe("address keys", () => {
  it("normalizes street words, suites and ZIP+4 so the same place matches", () => {
    expect(addressKey("100 Main Street, Suite 200", "33602-1234")).toBe(addressKey("100 MAIN ST STE 200", "33602"));
    expect(addressKey("100 Main St #200", "33602")).toBe(addressKey("100 Main St., Ste. 200", "33602"));
    expect(addressKey("100 North Main Avenue", "33602")).toBe(addressKey("100 N Main Ave", "33602"));
    expect(addressKey("100 Main St Ste 200", "33602")).not.toBe(addressKey("100 Main St Ste 300", "33602"));
  });
});

describe("grouping registry records into clinics", () => {
  it("one organization plus its doctors at the same address = one multi-DC clinic", () => {
    const out = groupRegistryRecords([
      rec({ npi: "1", kind: "organization", name: "BAYSIDE FAMILY CHIROPRACTIC LLC" }),
      rec({ npi: "2", firstName: "ANA", lastName: "RIVERA" }),
      rec({ npi: "3", firstName: "MARK", lastName: "HALE", location: { line1: "100 MAIN ST STE 200", line2: null, city: "TAMPA", state: "FL", zip: "33602", phone: null } }),
    ], "FL");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ clinicName: "Bayside Family Chiropractic", providerCount: 2, npis: ["1", "2", "3"], zip: "33602", city: "Tampa", phone: "(813) 555-0100", nameFromIndividual: false });
    expect(out[0].doctors).toEqual(["Dr. Ana Rivera", "Dr. Mark Hale"]);
  });
  it("a lone doctor becomes a solo practice named for them (to be confirmed by research)", () => {
    const [c] = groupRegistryRecords([rec({ npi: "9", firstName: "PRIYA", lastName: "NAIR", location: { line1: "5 Ocean Blvd", line2: null, city: "NAPLES", state: "FL", zip: "34102", phone: null } })], "FL");
    expect(c).toMatchObject({ clinicName: "Dr. Priya Nair, D.C.", ownerName: "Dr. Priya Nair", providerCount: 1, nameFromIndividual: true });
  });
  it("skips other states, non-chiropractic records and records without a practice address", () => {
    expect(groupRegistryRecords([
      rec({ location: { line1: "1 A St", line2: null, city: "ATLANTA", state: "GA", zip: "30303", phone: null } }),
      rec({ taxonomyCodes: ["225100000X"] }),
      rec({ location: null }),
    ], "FL")).toEqual([]);
  });
});

describe("registry individuals for provider recruitment", () => {
  it("one per NPI, with how many colleagues share the practice address", () => {
    const out = registryIndividuals([
      rec({ npi: "1", kind: "organization", name: "BAYSIDE FAMILY CHIROPRACTIC LLC" }),
      rec({ npi: "2", firstName: "ANA", lastName: "RIVERA", credential: "D.C." }),
      rec({ npi: "2", firstName: "ANA", lastName: "RIVERA", credential: "D.C." }),
      rec({ npi: "3", firstName: "MARK", lastName: "HALE", location: { line1: "100 MAIN ST STE 200", line2: null, city: "TAMPA", state: "FL", zip: "33602", phone: null } }),
      rec({ npi: "4", firstName: "SOLO", lastName: "DOC", location: { line1: "9 Bay Rd", line2: null, city: "TAMPA", state: "FL", zip: "33602", phone: null } }),
      rec({ npi: "5", firstName: "OUT", lastName: "STATE", location: { line1: "1 A St", line2: null, city: "ATLANTA", state: "GA", zip: "30303", phone: null } }),
    ], "FL");
    expect(out.map((p) => [p.npi, p.displayName, p.providersAtPractice])).toEqual([["2", "Ana Rivera, D.C.", 2], ["3", "Mark Hale, DC", 2], ["4", "Solo Doc, DC", 1]]);
  });
});

describe("grouping for other professions", () => {
  const PT = { taxonomyCodes: ["2251"], nameSuffix: "PT", practiceNoun: "physical therapy clinic" };
  it("uses the profession's taxonomy codes and naming", () => {
    const recs = [
      rec({ npi: "1", firstName: "LEE", lastName: "PARK", taxonomyCodes: ["225100000X"] }),
      rec({ npi: "2", firstName: "ANA", lastName: "RIVERA", location: { line1: "9 Bay Rd", line2: null, city: "TAMPA", state: "FL", zip: "33602", phone: null } }),
    ];
    const pt = groupRegistryRecords(recs, "FL", PT);
    expect(pt).toHaveLength(1);
    expect(pt[0].clinicName).toBe("Dr. Lee Park, PT");
    expect(groupRegistryRecords(recs, "FL")).toHaveLength(1); // chiropractic by default
    expect(groupRegistryRecords(recs, "FL", { ...PT, taxonomyCodes: [] })).toEqual([]); // no codes = nothing matches
  });
});

describe("business email acceptance (public business email only)", () => {
  it("accepts the clinic's own domain or a generic front-desk mailbox", () => {
    expect(acceptBusinessEmail("dr.rivera@baysidechiro.com", "https://www.baysidechiro.com/")).toBe(true);
    expect(acceptBusinessEmail("frontdesk@gmail.com", "https://www.baysidechiro.com")).toBe(true);
    expect(acceptBusinessEmail("Info@BaysideChiro.com", null)).toBe(true);
  });
  it("rejects personal-looking addresses and junk", () => {
    expect(acceptBusinessEmail("ana.rivera1975@gmail.com", "https://www.baysidechiro.com")).toBe(false);
    expect(acceptBusinessEmail("not-an-email", null)).toBe(false);
    expect(acceptBusinessEmail("noreply@wixpress.com", "https://baysidechiro.com")).toBe(false);
    expect(acceptBusinessEmail("sentry@sentry.io", "https://baysidechiro.com")).toBe(false);
  });
});

describe("franchise detection", () => {
  it("knows the common chiropractic franchises", () => {
    expect(detectFranchise("The Joint Chiropractic - Tampa Palms")).toBe("The Joint Chiropractic");
    expect(detectFranchise("HealthSource Chiropractic of Brandon")).toBe("HealthSource Chiropractic");
    expect(detectFranchise("Bayside Family Chiropractic")).toBeNull();
  });
});

describe("applying research findings", () => {
  const current = { clinicName: "Dr. Priya Nair, D.C.", nameFromIndividual: true, website: null, email: null, phone: "(239) 555-0100", hasContactForm: null, practiceType: null, multidisciplinary: null, ownership: null, locationsCount: null, providerCount: 1, doctors: ["Dr. Priya Nair"], socialUrls: [] as string[] };
  const f = (o: Partial<ResearchFindings>): ResearchFindings => ({
    found: true, closed: false, confidence: 0.9, practiceName: "Naples Spine & Wellness", website: "https://naplesspine.com", email: "office@naplesspine.com", emailSourceUrl: "https://naplesspine.com/contact",
    phone: null, hasContactForm: true, practiceType: "family / sports", multidisciplinary: false, franchiseName: null, locationsCount: 1, providerCount: 2, doctors: ["Dr. Priya Nair", "Dr. Leo Park"],
    socialUrls: ["https://www.facebook.com/naplesspine", "https://evil.example/x"], sources: ["https://naplesspine.com/", "https://naplesspine.com/contact"], ...o,
  });
  it("fills gaps, names the practice, keeps the registry's facts, drops unsafe values", () => {
    const r = applyResearch(current, f({}));
    expect(r.patch).toMatchObject({ clinicName: "Naples Spine & Wellness", website: "https://naplesspine.com", email: "office@naplesspine.com", hasContactForm: true, locationsCount: 1, providerCount: 2, socialUrls: ["https://www.facebook.com/naplesspine"] });
    expect(r.patch.doctors).toEqual(["Dr. Priya Nair", "Dr. Leo Park"]);
    expect(r.patch.phone).toBeUndefined(); // already known from the registry
    expect(r.rejected).toContain("socialUrls:evil.example");
  });
  it("an email without a cited source, or a personal address, is not stored", () => {
    expect(applyResearch(current, f({ emailSourceUrl: null })).patch.email).toBeUndefined();
    expect(applyResearch(current, f({ email: "priya.nair88@gmail.com" })).rejected).toContain("email:not_business");
  });
  it("never overwrites what's already there (except a placeholder name from the registry)", () => {
    const r = applyResearch({ ...current, clinicName: "Nair Chiropractic", nameFromIndividual: false, email: "hello@nair.com" }, f({}));
    expect(r.patch.clinicName).toBeUndefined();
    expect(r.patch.email).toBeUndefined();
  });
  it("franchises are marked; closed practices are paused; low confidence changes nothing", () => {
    expect(applyResearch(current, f({ franchiseName: "The Joint Chiropractic" })).patch.ownership).toBe("franchise");
    expect(applyResearch(current, f({ closed: true })).pause).toBe(true);
    const low = applyResearch(current, f({ confidence: 0.3 }));
    expect(low.patch).toEqual({});
    expect(low.rejected).toContain("low_confidence");
  });
});
