import { describe, expect, it } from "vitest";
import { apolloBudget, apolloLocation, apolloRegion, apolloSearchBody, estimateApolloCredits, isDecisionMakerTitle, mapApolloOrganization, mapApolloPerson, usableApolloEmail } from "../src";

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
