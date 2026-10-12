import { describe, expect, it } from "vitest";
import { apolloBudget, apolloTitleRole, companyAsPerson, unrelatedClinicEmail, fromApolloExport, isApolloExport, apolloLocation, apolloRegion, apolloSearchBody, estimateApolloCredits, isDecisionMakerTitle, mapApolloOrganization, mapApolloPerson, usableApolloEmail } from "../src";

describe("Apollo regions", () => {
  it("maps Apollo's state / country names to our region codes", () => {
    expect(apolloRegion("Florida", "United States")).toBe("FL");
    expect(apolloRegion("fl", "US")).toBe("FL");
    expect(apolloRegion("Ontario", "Canada")).toBe("ON");
    expect(apolloRegion("Quebec", "Canada")).toBe("QC");
    expect(apolloRegion(null, "Puerto Rico")).toBe("PR");
    expect(apolloRegion("Puerto Rico", "United States")).toBe("PR");
    expect(apolloRegion("St. Croix", "U.S. Virgin Islands")).toBe("VI");
    expect(apolloRegion("California", "United States")).toBe("CA");
    expect(apolloRegion("Bavaria", "Germany")).toBeNull();
    expect(apolloRegion(null, null)).toBeNull();
  });
  it("builds Apollo location filters for a region and city", () => {
    expect(apolloLocation("FL")).toBe("Florida, US");
    expect(apolloLocation("FL", "Orlando")).toBe("Orlando, Florida, US");
    expect(apolloLocation("ON", "Toronto")).toBe("Toronto, Ontario, Canada");
    expect(apolloLocation("PR")).toBe("Puerto Rico");
    expect(apolloLocation("VI")).toBe("U.S. Virgin Islands");
  });
});

describe("Apollo search bodies", () => {
  it("supply side looks for practitioners by title; demand side for decision-makers at clinics", () => {
    const s = apolloSearchBody("SUPPLY", { region: "GA", city: "Atlanta", titles: ["Chiropractor", "Doctor of Chiropractic"], keywords: ["chiropractic"], page: 2, perPage: 50 });
    expect(s).toEqual({ person_titles: ["Chiropractor", "Doctor of Chiropractic"], person_locations: ["Atlanta, Georgia, US"], page: 2, per_page: 50 });
    const d = apolloSearchBody("DEMAND", { region: "FL", titles: ["Owner", "Office Manager"], keywords: ["chiropractic"], page: 1, perPage: 500 });
    expect(d).toEqual({ person_titles: ["Owner", "Office Manager"], organization_locations: ["Florida, US"], q_organization_keyword_tags: ["chiropractic"], page: 1, per_page: 100 });
  });
});

describe("Apollo records", () => {
  it("maps a person without inventing anything", () => {
    const p = mapApolloPerson({ id: "p1", first_name: "Ana", last_name: "Rivera", title: "Chiropractor", state: "Georgia", city: "Atlanta", country: "United States", organization_id: "o1", organization: { id: "o1", name: "Peach Chiro", primary_domain: "peachchiro.com" }, email: "ana@peachchiro.com", email_status: "verified" });
    expect(p).toEqual({ apolloPersonId: "p1", apolloOrganizationId: "o1", firstName: "Ana", lastName: "Rivera", lastNameHidden: false, title: "Chiropractor", city: "Atlanta", region: "GA", organizationName: "Peach Chiro", organizationDomain: "peachchiro.com", email: "ana@peachchiro.com", emailStatus: "verified" });
    // Search results hide the last name and carry no email.
    const s = mapApolloPerson({ id: "p2", first_name: "Bo", last_name_obfuscated: "Ch***n", title: "DC", state: "Ontario", country: "Canada" });
    expect(s).toMatchObject({ lastName: null, lastNameHidden: true, email: null, region: "ON" });
  });
  it("only uses verified emails (or likely ones when allowed)", () => {
    expect(usableApolloEmail({ email: "a@b.com", emailStatus: "verified" }, false)).toBe("a@b.com");
    expect(usableApolloEmail({ email: "a@b.com", emailStatus: "likely to engage" }, false)).toBeNull();
    expect(usableApolloEmail({ email: "a@b.com", emailStatus: "likely to engage" }, true)).toBe("a@b.com");
    expect(usableApolloEmail({ email: "email_not_unlocked@domain.com", emailStatus: "verified" }, true)).toBeNull();
    expect(usableApolloEmail({ email: null, emailStatus: "verified" }, true)).toBeNull();
  });
  it("maps an organization", () => {
    const o = mapApolloOrganization({ id: "o9", name: "Sunshine Spine", website_url: "http://www.sunshinespine.com", primary_domain: "sunshinespine.com", phone: "+1 407-555-0100", city: "Orlando", state: "Florida", country: "United States", street_address: "1 Main St", postal_code: "32801" });
    expect(o).toEqual({ apolloOrganizationId: "o9", name: "Sunshine Spine", website: "http://www.sunshinespine.com", domain: "sunshinespine.com", phone: "+1 407-555-0100", address: "1 Main St", city: "Orlando", region: "FL", zip: "32801" });
  });
  it("recognizes clinic decision-makers", () => {
    for (const t of ["Owner", "Clinic Director", "Practice Manager", "Office Manager", "Founder & CEO", "President"]) expect(isDecisionMakerTitle(t)).toBe(true);
    for (const t of ["Massage Therapist", "Front Desk", "Chiropractic Assistant", null]) expect(isDecisionMakerTitle(t)).toBe(false);
  });
});

describe("Apollo credit budget", () => {
  const costs = { organizationSearchPage: 1, personEnrich: 1, organizationEnrich: 1 };
  it("estimates credits for a job", () => {
    expect(estimateApolloCredits({ peopleSearchPages: 3, organizationSearchPages: 2, personEnrich: 10, organizationEnrich: 1 }, costs)).toBe(13);
  });
  it("stops at the daily and monthly caps and asks for approval on large jobs", () => {
    const b = { usedToday: 40, usedMonth: 900, dailyCap: 50, monthlyCap: 1000, largeJob: 25, paused: false };
    expect(apolloBudget({ ...b, estimate: 5, approved: false })).toEqual({ ok: true, reason: null });
    expect(apolloBudget({ ...b, estimate: 11, approved: false })).toEqual({ ok: false, reason: "daily_cap" });
    expect(apolloBudget({ ...b, usedToday: 0, usedMonth: 990, estimate: 20, approved: false })).toEqual({ ok: false, reason: "monthly_cap" });
    expect(apolloBudget({ ...b, usedToday: 0, usedMonth: 0, estimate: 30, approved: false })).toEqual({ ok: false, reason: "needs_approval" });
    expect(apolloBudget({ ...b, usedToday: 0, usedMonth: 0, dailyCap: 100, estimate: 30, approved: true })).toEqual({ ok: true, reason: null });
    expect(apolloBudget({ ...b, paused: true, estimate: 0, approved: true })).toEqual({ ok: false, reason: "paused" });
    // Free calls (people search) still respect a pause but not the credit caps.
    expect(apolloBudget({ ...b, usedToday: 50, estimate: 0, approved: false })).toEqual({ ok: true, reason: null });
  });
});

describe("Apollo CSV exports", () => {
  const header = ["First Name", "Last Name", "Title", "Company Name", "Email", "Email Status", "Corporate Phone", "Website", "City", "State", "Country", "Company Address", "Company City", "Company State", "Company Country", "Company Phone"];
  const rows = [
    header,
    ["Ana", "Rivera", "Owner", "Bayside Chiropractic", "ana@baysidechiro.com", "Verified", "", "http://baysidechiro.com", "Tampa", "Florida", "United States", "100 Bay St, Tampa, Florida 33602, United States", "Tampa", "Florida", "United States", "+1 813-555-0100"],
    ["Ben", "Lee", "Office Manager", "Bayside Chiropractic", "ben@baysidechiro.com", "Unavailable", "", "http://baysidechiro.com", "Tampa", "Florida", "United States", "100 Bay St, Tampa, Florida 33602, United States", "Tampa", "Florida", "United States", "+1 813-555-0100"],
    ["Cara", "Diaz", "Associate Chiropractor", "North Spine", "cara@northspine.com", "Extrapolated", "", "", "Toronto", "Ontario", "Canada", "", "Toronto", "Ontario", "Canada", ""],
  ];
  it("recognises an export", () => {
    expect(isApolloExport(header)).toBe(true);
    expect(isApolloExport(["clinic_name", "email"])).toBe(false);
  });
  it("maps clinics: U.S. only, one row per company, verified emails only", () => {
    const r = fromApolloExport(rows, "clinic", false);
    expect(r.rows).toEqual([
      ["clinic_name", "owner_name", "email", "phone", "website", "address", "city", "state", "zip", "notes"],
      ["Bayside Chiropractic", "Ana Rivera", "ana@baysidechiro.com", "+1 813-555-0100", "http://baysidechiro.com", "100 Bay St", "Tampa", "FL", "33602", "Apollo contact: Ana Rivera, Owner"],
    ]);
    expect(r).toMatchObject({ notUs: 1, unverifiedEmails: 1, merged: 1, misplaced: 0, otherDomainEmails: 0 });
  });
  it("keeps a clinic where the contact works when Apollo attached a company in another state or country", () => {
    const r = fromApolloExport([
      header,
      ["Sam", "Cole", "Office Manager", "Mayer Chiropractic Clinic", "sam@mayerchiro.com", "Verified", "", "https://mayerchiro.com", "", "Florida", "United States", "Vancouver, Washington, United States, 98661", "Vancouver", "Washington", "United States", "+1 727-555-0100"],
      ["Ann", "Burr", "Office Manager", "Coastal Chiropractic", "ann@ccspine.com", "Verified", "", "", "Palm Bay", "Florida", "United States", "1 Christchurch Road, Bournemouth, England, United Kingdom, BH1 3JP", "Bournemouth", "England", "United Kingdom", ""],
    ], "clinic", false);
    expect(r.rows.slice(1).map((x) => x.slice(3, 9))).toEqual([["+1 727-555-0100", "https://mayerchiro.com", "", "", "FL", ""], ["", "", "", "Palm Bay", "FL", ""]]);
    expect(r.rows[1][9]).toMatch(/Vancouver, Washington, United States; location taken from the contact/);
    expect(r).toMatchObject({ misplaced: 2, notUs: 0 });
  });
  it("drops an email on another business's domain and a company filed as the person", () => {
    const r = fromApolloExport([
      header,
      ["Boynton", "Center", "Dr. Pierre Tallerie, D.C. | Business Owner", "Boynton Beach Medical Center, Inc", "smile@boyntonbeachdentalcenter.com", "Verified", "", "https://boyntonbeachmedical.com", "Boynton Beach", "Florida", "United States", "706 W Boynton Beach Blvd, Boynton Beach, Florida, United States, 33426", "Boynton Beach", "Florida", "United States", ""],
      ["Ann", "Lee", "Owner", "Lee Chiropractic", "info@leechiro.com", "Verified", "", "https://leechiropractic.com", "Tampa", "Florida", "United States", "", "Tampa", "Florida", "United States", ""],
    ], "clinic", false);
    expect(r.rows[1].slice(0, 3)).toEqual(["Boynton Beach Medical Center, Inc", "", ""]);
    expect(r.rows[2][2]).toBe("info@leechiro.com"); // a generic office mailbox is still fine
    expect(r.otherDomainEmails).toBe(1);
    expect(companyAsPerson("Boynton", "Center", "Boynton Beach Medical Center, Inc")).toBe(true);
    expect(companyAsPerson("Ana", "Rivera", "Rivera Chiropractic")).toBe(false);
    expect(companyAsPerson("Jack", "Lynady", "Jack Lynady D.C., P.A.")).toBe(false);
    expect(unrelatedClinicEmail("doctor@tswchiro.com", "Tampa Spine & Wellness")).toBe(false);
    expect(unrelatedClinicEmail("dalton@logan.edu", "Seven Bridges Chiropractic")).toBe(true);
    expect(unrelatedClinicEmail("hi@smilechiro.com", "Smile Chiropractic")).toBe(false);
    expect(unrelatedClinicEmail("dr@pierceclinicstpete.com", "Pierce Clinic Of Chiropractic")).toBe(false);
  });
  it("maps providers with a practice role from the title", () => {
    const r = fromApolloExport(rows, "provider", false);
    expect(r.rows.slice(1)).toEqual([
      ["Ana", "Rivera", "ana@baysidechiro.com", "http://baysidechiro.com", "Tampa", "FL", "33602", "owner"],
      ["Ben", "Lee", "", "http://baysidechiro.com", "Tampa", "FL", "33602", ""],
    ]);
    expect(apolloTitleRole("Associate Chiropractor")).toBe("associate");
    expect(apolloTitleRole("Chiropractor")).toBe("");
  });
});
