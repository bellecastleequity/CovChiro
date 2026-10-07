import { describe, expect, it } from "vitest";
import { ACTIVITY_DEFAULTS as S, activityAction } from "../src";

const DAY = 86_400_000;
const now = new Date("2026-11-01T12:00:00Z");
const ago = (d: number) => new Date(+now - d * DAY);
const facts = (days: number, extra = {}) => ({ lastActivity: ago(days), hasUpcomingBooking: false, inOpenMarket: true, onBreak: false, ...extra });

describe("provider active status", () => {
  it("reminds on day 23 and 28, pauses after 30 full days", () => {
    expect(activityAction(facts(10), now, S)).toEqual({ kind: "none" });
    expect(activityAction(facts(23), now, S)).toMatchObject({ kind: "remind", day: 23 });
    expect(activityAction(facts(26), now, S)).toMatchObject({ kind: "remind", day: 23 });
    expect(activityAction(facts(28), now, S)).toMatchObject({ kind: "remind", day: 28 });
    expect(activityAction(facts(30), now, S)).toMatchObject({ kind: "remind", day: 28 });
    expect(activityAction(facts(31), now, S)).toEqual({ kind: "pause" });
  });
  it("the reminder says when the pause happens", () => {
    const r = activityAction(facts(23), now, S);
    expect(r.kind === "remind" && r.pauseAt.toISOString()).toBe(new Date(+ago(23) + 31 * DAY).toISOString());
  });
  it("skips upcoming bookings, unopened markets, breaks they chose, and when switched off", () => {
    expect(activityAction(facts(40, { hasUpcomingBooking: true }), now, S).kind).toBe("none");
    expect(activityAction(facts(40, { inOpenMarket: false }), now, S).kind).toBe("none");
    expect(activityAction(facts(40, { onBreak: true }), now, S).kind).toBe("none");
    expect(activityAction(facts(40), now, { ...S, enabled: false }).kind).toBe("none");
  });
});
