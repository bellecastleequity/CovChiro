import { describe, expect, it } from "vitest";
import { clockState, manualPunchProblem, milesBetween, nextPunches, punchProblem, punchRemindersDue, summarizeTimesheet, type Punch } from "../src/timeclock";

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

describe("punch reminders", () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 14, h, m));
  const shift: { startsAt: Date; endsAt: Date; lunchStartsAt: Date | null; lunchMinutes: number } = { startsAt: at(12), endsAt: at(21), lunchStartsAt: at(16), lunchMinutes: 60 }; // 8–5 ET, lunch 12–1
  const o = { afterMinutes: 5 };
  const due = (p: Punch[], now: Date, sh = shift) => punchRemindersDue(p, sh, now, o);

  it("clock in: after the start plus the slack, until it's stale", () => {
    expect(due([], at(12, 4))).toEqual([]);
    expect(due([], at(12, 5))).toEqual(["IN"]);
    expect(due([], at(15, 6))).toEqual([]); // more than 3 h late: no point
    expect(due([{ kind: "IN", at: at(11, 55) }], at(12, 10))).toEqual([]);
  });

  it("lunch: start it when it's due, come back when it should be over", () => {
    const inn: Punch[] = [{ kind: "IN", at: at(11, 55) }];
    expect(due(inn, at(16, 3))).toEqual([]);
    expect(due(inn, at(16, 5))).toEqual(["BREAK_START"]);
    expect(due(inn, at(17, 1))).toEqual([]); // lunch time has passed
    const onBreak: Punch[] = [...inn, { kind: "BREAK_START", at: at(16) }];
    expect(due(onBreak, at(16, 30))).toEqual([]);
    expect(due(onBreak, at(17, 5))).toEqual(["BREAK_END"]);
    // An early lunch counts as taken.
    const early: Punch[] = [...inn, { kind: "BREAK_START", at: at(15, 30) }, { kind: "BREAK_END", at: at(16) }];
    expect(due(early, at(16, 10))).toEqual([]);
    // No planned lunch: no lunch reminders.
    expect(due(inn, at(16, 10), { ...shift, lunchStartsAt: null, lunchMinutes: 0 })).toEqual([]);
  });

  it("clock out: after the end, whether on the clock or still on break", () => {
    const inn: Punch[] = [{ kind: "IN", at: at(11, 55) }, { kind: "BREAK_START", at: at(16) }, { kind: "BREAK_END", at: at(17) }];
    expect(due(inn, at(21, 2))).toEqual([]);
    expect(due(inn, at(21, 5))).toEqual(["OUT"]);
    expect(due([...inn, { kind: "OUT", at: at(21) }], at(21, 10))).toEqual([]);
    expect(due([{ kind: "IN", at: at(12) }, { kind: "BREAK_START", at: at(20, 30) }], at(21, 6))).toEqual(["OUT"]);
  });
});
