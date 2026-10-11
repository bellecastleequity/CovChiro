import { describe, expect, it } from "vitest";
import { inLocalWindow } from "../src";

describe("local send window", () => {
  const wk = [1, 2, 3, 4, 5];
  it("Mon–Fri from 08:15 through 17:00 Eastern", () => {
    expect(inLocalWindow(new Date("2026-10-19T12:14:00Z"), "America/New_York", wk, "08:15", "17:00")).toBe(false); // Mon 8:14
    expect(inLocalWindow(new Date("2026-10-19T12:15:00Z"), "America/New_York", wk, "08:15", "17:00")).toBe(true); // Mon 8:15
    expect(inLocalWindow(new Date("2026-10-19T21:00:30Z"), "America/New_York", wk, "08:15", "17:00")).toBe(true); // Mon 17:00
    expect(inLocalWindow(new Date("2026-10-19T21:01:00Z"), "America/New_York", wk, "08:15", "17:00")).toBe(false); // Mon 17:01
    expect(inLocalWindow(new Date("2026-10-17T14:00:00Z"), "America/New_York", wk, "08:15", "17:00")).toBe(false); // Sat
    expect(inLocalWindow(new Date("2026-12-14T13:15:00Z"), "America/New_York", wk, "08:15", "17:00")).toBe(true); // Mon 8:15 EST (winter)
  });
});
