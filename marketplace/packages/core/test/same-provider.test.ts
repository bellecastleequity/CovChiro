import { describe, expect, it } from "vitest";
import { groupDeadlineAction } from "../src";

const H = 3_600_000;
const now = new Date("2026-10-10T12:00:00Z");
const base = { now, firstStartsAt: new Date(+now + 5 * 24 * H), hasFullApplicant: false, askedAt: null, waitHours: 4, splitNowWithinHours: 48 };

describe("same provider for all days: at the decision deadline", () => {
  it("confirms when someone applied for every day", () => {
    expect(groupDeadlineAction({ ...base, hasFullApplicant: true })).toBe("confirm");
  });
  it("asks the clinic first, waits, then splits after the wait", () => {
    expect(groupDeadlineAction(base)).toBe("ask");
    expect(groupDeadlineAction({ ...base, askedAt: new Date(+now - 1 * H) })).toBe("wait");
    expect(groupDeadlineAction({ ...base, askedAt: new Date(+now - 4 * H) })).toBe("split");
  });
  it("splits straight away when the first day is close", () => {
    expect(groupDeadlineAction({ ...base, firstStartsAt: new Date(+now + 30 * H) })).toBe("split");
  });
});
