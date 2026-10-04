import { describe, expect, it } from "vitest";
import { normalizeLinkedIn, providerBadges, type BadgeInput } from "../src";

const base: BadgeInput = {
  completedShifts: 0, lateCancels12m: 0, noShows12m: 0, ratingAvg: null, ratingCount: 0, punctualityAvg: null, punctualityCount: 0,
  offersReceived: 0, offersResponded: 0, medianResponseMinutes: null, maxYearsInPractice: null, favoritedByClinics: 0,
  verifiedProfessions: 1, verifiedStates: 1, licenseVerified: true, malpracticeVerified: true, npiVerified: true, onCallActive: false,
};
const keys = (i: Partial<BadgeInput>) => providerBadges({ ...base, ...i }).map((b) => b.key);

describe("provider badges", () => {
  it("new provider gets verification labels and 'new'", () => {
    expect(keys({})).toEqual(["license", "malpractice", "npi", "new"]);
    expect(keys({ licenseVerified: false, malpracticeVerified: false, npiVerified: false })).toEqual(["new"]);
  });
  it("earned badges need enough data", () => {
    expect(keys({ ratingAvg: 5, ratingCount: 4 })).not.toContain("top_rated");
    expect(keys({ ratingAvg: 4.9, ratingCount: 5 })).toContain("top_rated");
    expect(keys({ punctualityAvg: 4.8, punctualityCount: 3 })).toContain("punctual");
    expect(keys({ punctualityAvg: 4.5, punctualityCount: 10 })).not.toContain("punctual");
  });
  it("responsiveness: rate and speed", () => {
    const fast = providerBadges({ ...base, offersReceived: 10, offersResponded: 10, medianResponseMinutes: 4 }).find((b) => b.key === "responsive")!;
    expect(fast.label).toBe("Responds quickly");
    const slow = providerBadges({ ...base, offersReceived: 10, offersResponded: 9, medianResponseMinutes: 90 }).find((b) => b.key === "responsive")!;
    expect(slow.label).toBe("Responsive");
    expect(keys({ offersReceived: 10, offersResponded: 8 })).not.toContain("responsive");
    expect(keys({ offersReceived: 4, offersResponded: 4 })).not.toContain("responsive");
  });
  it("reliability and experience", () => {
    expect(keys({ completedShifts: 5 })).toContain("reliable");
    expect(keys({ completedShifts: 5, lateCancels12m: 1 })).not.toContain("reliable");
    expect(keys({ completedShifts: 12 })).toContain("experienced");
    expect(keys({ completedShifts: 60 })).toContain("veteran");
    expect(keys({ completedShifts: 60 })).not.toContain("experienced");
    expect(keys({ completedShifts: 60 })).not.toContain("new");
    expect(keys({ maxYearsInPractice: 12 })).toContain("seasoned");
  });
  it("relationship and breadth", () => {
    expect(keys({ favoritedByClinics: 3, verifiedProfessions: 2, verifiedStates: 3, onCallActive: true })).toEqual(expect.arrayContaining(["clinic_favorite", "multi_profession", "multi_state", "oncall"]));
  });
});

describe("LinkedIn URL", () => {
  it("accepts profile URLs only", () => {
    expect(normalizeLinkedIn("linkedin.com/in/jane-rivera-dc/")).toBe("https://www.linkedin.com/in/jane-rivera-dc");
    expect(normalizeLinkedIn("https://www.linkedin.com/in/jane")).toBe("https://www.linkedin.com/in/jane");
    expect(normalizeLinkedIn("https://evil.com/in/jane")).toBeNull();
    expect(normalizeLinkedIn("https://linkedin.com.evil.com/in/jane")).toBeNull();
    expect(normalizeLinkedIn("https://www.linkedin.com/company/acme")).toBeNull();
    expect(normalizeLinkedIn("")).toBeNull();
  });
});

describe("Trailblazer badge", () => {
  it("shows for the states earned, naming them", () => {
    expect(keys({})).not.toContain("trailblazer");
    const b = providerBadges({ ...base, trailblazerStates: ["Georgia"], trailblazerSpots: 25 }).find((x) => x.key === "trailblazer")!;
    expect(b.label).toBe("Trailblazer");
    expect(b.description).toMatch(/first 25 providers to join in Georgia/);
  });
});
