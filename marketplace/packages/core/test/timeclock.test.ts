import { describe, expect, it } from "vitest";
import { clockState, manualPunchProblem, milesBetween, nextPunches, punchProblem, summarizeTimesheet, type Punch } from "../src/timeclock";

const t = (hhmm: string) => new Date(`2026-03-02T${hhmm}:00Z`);
const scheduled = { startsAt: t("13:00"), endsAt: t("21:00") };
const w = { ...scheduled, earliestInMinutes: 60, latestHoursAfterEnd: 6 };
const rules = { lateGraceMinutes: 10, farMiles: 0.5 };

describe("time clock state", () => {
  it("walks in → lunch → back → out", () => {
    const ps: Punch[] = [];
    expect(nextPunches(ps)).toEqual(["IN"]);
    ps.push({ kind: "IN", at: t("12:55") });
    expect(nextPunches(ps)).toEqual(["BREAK_START", "OUT"]);
    ps.push({ kind: "BREAK_START", at: t("17:00") });
    expect(clockState(ps)).toBe("ON_BREAK");
    expect(nextPunches(ps)).toEqual(["BREAK_END"]);
    ps.push({ kind: "BREAK_END", at: t("17:30") }, { kind: "OUT", at: t("21:02") });
    expect(clockState(ps)).toBe("DONE");
    expect(nextPunches(ps)).toEqual([]);
  });

  it("checks timing", () => {
    expect(punchProblem("IN", [], t("11:30"), w)).toMatch(/60 minutes before/);
    expect(punchProblem("IN", [], t("12:10"), w)).toBeNull();
    expect(punchProblem("OUT", [], t("14:00"), w)).toMatch(/Punch in first/);
    expect(punchProblem("OUT", [{ kind: "IN", at: t("13:00") }], t("23:00"), w)).toBeNull();
    expect(punchProblem("OUT", [{ kind: "IN", at: t("13:00") }], new Date(+t("21:00") + 7 * 3_600_000), w)).toMatch(/closed/);
  });

  it("manual punches must fit in order", () => {
    const ps: Punch[] = [{ kind: "IN", at: t("13:00") }];
    expect(manualPunchProblem("OUT", t("12:00"), ps, w)).toMatch(/before your previous/);
    expect(manualPunchProblem("OUT", t("21:00"), ps, w)).toBeNull();
    expect(manualPunchProblem("BREAK_END", t("17:00"), ps, w)).toMatch(/in order/);
  });
});

describe("summarizeTimesheet", () => {
  it("totals work and lunch", () => {
    const s = summarizeTimesheet(
      [{ kind: "IN", at: t("12:58") }, { kind: "BREAK_START", at: t("17:00") }, { kind: "BREAK_END", at: t("17:30") }, { kind: "OUT", at: t("21:00") }],
      scheduled, rules,
    );
    expect(s).toMatchObject({ workedMinutes: 7 * 60 + 32, breakMinutes: 30, flags: [] });
    expect(s.firstIn).toEqual(t("12:58"));
  });

  it("flags late, early, missing out, hand-entered and far-away punches", () => {
    const s = summarizeTimesheet(
      [{ kind: "IN", at: t("13:25"), distanceMiles: 2.34 }, { kind: "OUT", at: t("20:30"), auto: true, manual: false }, { kind: "BREAK_START", at: t("16:00"), manual: true }],
      scheduled, rules,
    );
    expect(s.flags).toEqual(expect.arrayContaining(["punched in 25 min late", "punched out 30 min early", "no punch-out: closed at the scheduled end", "times added by hand", "punched 2.3 mi from the clinic"]));
    expect(summarizeTimesheet([], scheduled, rules).flags).toContain("no punch-in");
  });

  it("measures distance", () => {
    expect(milesBetween({ lat: 28.5421, lng: -81.379 }, { lat: 28.5421, lng: -81.379 })).toBe(0);
    expect(milesBetween({ lat: 28.5421, lng: -81.379 }, { lat: 28.5383, lng: -81.3792 })).toBeCloseTo(0.26, 1);
  });
});
