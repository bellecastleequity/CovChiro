import { describe, expect, it } from "vitest";
import { providerImportHeader, providerImportRow, validNpi } from "../src";

describe("provider CSV import rows", () => {
  it("checks the NPI check digit", () => {
    expect(validNpi("1234567893")).toBe(true);
    expect(validNpi("1234567890")).toBe(false);
    expect(validNpi("12345")).toBe(false);
  });
  it("maps common header names", () => {
    expect(["NPI", "First Name", "last_name", "E-mail", "Zip Code", "Practice role", "doctors"].map(providerImportHeader)).toEqual(["npi", "firstName", "lastName", "email", "zip", "practiceRole", "providersAtPractice"]);
    expect(providerImportHeader("favorite color")).toBeNull();
  });
  it("normalizes a row", () => {
    const r = providerImportRow({ npi: "1234-567-893", firstName: "ana", lastName: "RIVERA", email: " Ana@RiveraChiro.com ", state: "fl", zip: "33602-1234", practiceRole: "owner", providersAtPractice: "1" });
    expect(r).toEqual({ ok: true, row: expect.objectContaining({ npi: "1234567893", firstName: "Ana", lastName: "Rivera", email: "ana@riverachiro.com", state: "FL", zip: "33602", practiceRole: "OWNER", providersAtPractice: 1 }) });
  });
  it("skips rows it can't place", () => {
    expect(providerImportRow({ npi: "1234567890", firstName: "A", lastName: "B", state: "FL" })).toEqual({ ok: false, reason: "bad_npi" });
    expect(providerImportRow({ firstName: "Ana", email: "a@b.com" })).toEqual({ ok: false, reason: "no_npi_or_name" });
    expect(providerImportRow({ firstName: "Ana", lastName: "Rivera", state: "ZZ" })).toEqual({ ok: false, reason: "no_npi_or_name" });
    // Without an NPI, a name and state are enough to look the person up in the registry.
    expect(providerImportRow({ firstName: "Ana", lastName: "Rivera", state: "FL" }).ok).toBe(true);
  });
});
