import { describe, expect, it } from "vitest";
import { clinicPhonesChange, formatUsPhone, maskPhone, normalizeUsPhone, phonesOnFile, providerPhoneChange, REQUIRED_PHONES } from "../src/phones";

describe("normalizeUsPhone", () => {
  it("accepts 10 digits or 1 + 10 digits in any format", () => {
    expect(normalizeUsPhone("(407) 555-0123")).toBe("+14075550123");
    expect(normalizeUsPhone("1-407-555-0123")).toBe("+14075550123");
    expect(normalizeUsPhone("+1 407.555.0123")).toBe("+14075550123");
  });
  it("rejects short, long and impossible numbers", () => {
    expect(normalizeUsPhone("555-0123")).toBeNull();
    expect(normalizeUsPhone("407555012345")).toBeNull();
    expect(normalizeUsPhone("(107) 555-0123")).toBeNull();
    expect(normalizeUsPhone("")).toBeNull();
    expect(normalizeUsPhone(null)).toBeNull();
  });
});

describe("formatting", () => {
  it("formats and masks", () => {
    expect(formatUsPhone("+14075550123")).toBe("(407) 555-0123");
    expect(maskPhone("+14075550123")).toBe("(•••) •••-0123");
    expect(formatUsPhone(null)).toBe("");
  });
});

describe("phonesOnFile", () => {
  it("providers need one valid number, clinics two different ones", () => {
    expect(REQUIRED_PHONES).toEqual({ PROVIDER: 1, CLINIC: 2 });
    expect(phonesOnFile("PROVIDER", ["+14075550123"])).toBe(true);
    expect(phonesOnFile("PROVIDER", [null])).toBe(false);
    expect(phonesOnFile("CLINIC", ["+14075550123", null])).toBe(false);
    expect(phonesOnFile("CLINIC", ["+14075550123", "407-555-0123"])).toBe(false);
    expect(phonesOnFile("CLINIC", ["+14075550123", "+14075550124"])).toBe(true);
    expect(phonesOnFile("CLINIC", ["555", "+14075550124"])).toBe(false);
  });
});

describe("providerPhoneChange", () => {
  it("saves a new valid number", () => {
    expect(providerPhoneChange("407 555 0123", false)).toEqual({ phone: "+14075550123" });
    expect(providerPhoneChange("407 555 0123", true)).toEqual({ phone: "+14075550123" });
  });
  it("can remove the number only without live bookings", () => {
    expect(providerPhoneChange("", false)).toEqual({ phone: null });
    expect(providerPhoneChange("  ", true)).toHaveProperty("problem");
  });
  it("refuses a bad number", () => {
    expect(providerPhoneChange("12345", false)).toHaveProperty("problem");
  });
});

describe("clinicPhonesChange", () => {
  it("needs two different valid numbers to save both", () => {
    expect(clinicPhonesChange("407-555-0123", "407-555-0124", true)).toEqual({ phone: "+14075550123", backupPhone: "+14075550124" });
    expect(clinicPhonesChange("407-555-0123", "(407) 555-0123", false)).toHaveProperty("problem");
    expect(clinicPhonesChange("407-555", "407-555-0124", false)).toHaveProperty("problem");
  });
  it("lets a clinic with no live shifts leave numbers empty (posting stays blocked)", () => {
    expect(clinicPhonesChange("", "", false)).toEqual({ phone: null, backupPhone: null });
    expect(clinicPhonesChange("407-555-0123", "", false)).toEqual({ phone: "+14075550123", backupPhone: null });
  });
  it("with live shifts both numbers must stay on file", () => {
    expect(clinicPhonesChange("407-555-0123", "", true)).toHaveProperty("problem");
    expect(clinicPhonesChange("", "", true)).toHaveProperty("problem");
  });
});
