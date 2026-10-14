import { describe, expect, it } from "vitest";
import { standingChangeNeedsConsent, standingShiftFits, type StandingPattern } from "../src";

const base: StandingPattern = { weekdays: [2, 4], startTime: "13:00", endTime: "17:00", endsOn: null };

describe("standing booking changes", () => {
  it("new days, other hours or an earlier end need the provider's consent", () => {
    expect(standingChangeNeedsConsent(base, { ...base, weekdays: [2, 3, 4] })).toBe(true);
    expect(standingChangeNeedsConsent(base, { ...base, weekdays: [2] })).toBe(true);
    expect(standingChangeNeedsConsent(base, { ...base, endTime: "18:00" })).toBe(true);
    expect(standingChangeNeedsConsent(base, { ...base, endsOn: "2026-12-31" })).toBe(true);
    expect(standingChangeNeedsConsent({ ...base, endsOn: "2026-12-31" }, { ...base, endsOn: "2026-11-30" })).toBe(true);
  });
  it("the same pattern, a later end date or no end date apply at once", () => {
    expect(standingChangeNeedsConsent(base, { ...base, weekdays: [4, 2, 2] })).toBe(false);
    expect(standingChangeNeedsConsent({ ...base, endsOn: "2026-11-30" }, { ...base, endsOn: "2026-12-31" })).toBe(false);
    expect(standingChangeNeedsConsent({ ...base, endsOn: "2026-11-30" }, base)).toBe(false);
  });
  it("knows whether a booked day still fits, in the clinic's own time zone", () => {
    const tz = "America/New_York";
    const tue = [new Date("2026-11-10T18:00:00Z"), new Date("2026-11-10T22:00:00Z")] as const; // Tue 1–5 PM EST
    expect(standingShiftFits(base, tz, ...tue)).toBe(true);
    expect(standingShiftFits({ ...base, weekdays: [4] }, tz, ...tue)).toBe(false);
    expect(standingShiftFits({ ...base, startTime: "12:00" }, tz, ...tue)).toBe(false);
    expect(standingShiftFits({ ...base, endsOn: "2026-11-09" }, tz, ...tue)).toBe(false);
    expect(standingShiftFits({ ...base, endsOn: "2026-11-10" }, tz, ...tue)).toBe(true);
  });
});
