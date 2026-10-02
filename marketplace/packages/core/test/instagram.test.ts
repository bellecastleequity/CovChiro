import { describe, expect, it } from "vitest";
import { followPace, instagramHandle, instagramHandleFrom } from "../src/instagram";

const TZ = "America/New_York";
// 2026-10-05 is a Monday; 14:00 UTC = 10:00 in New York (EDT).
const at = (hhmm: string, day = "2026-10-05") => new Date(`${day}T${hhmm}:00-04:00`);
const PACE = { perDay: 30, perWindow: 2, windowMinutes: 5, start: "09:00", end: "20:00", timeZone: TZ };

describe("instagram handles", () => {
  it("reads a profile handle from common URL shapes", () => {
    expect(instagramHandle("https://www.instagram.com/BaysideChiro/")).toBe("baysidechiro");
    expect(instagramHandle("instagram.com/bayside.chiro_fl?igsh=abc")).toBe("bayside.chiro_fl");
    expect(instagramHandle("https://instagram.com/@drjane")).toBe("drjane");
    expect(instagramHandle("http://m.instagram.com/sunrise.chiro")).toBe("sunrise.chiro");
  });
  it("rejects posts, reels, system pages and other sites", () => {
    expect(instagramHandle("https://www.instagram.com/p/Cx123/")).toBeNull();
    expect(instagramHandle("https://www.instagram.com/reel/abc/")).toBeNull();
    expect(instagramHandle("https://www.instagram.com/explore/tags/chiro/")).toBeNull();
    expect(instagramHandle("https://www.instagram.com/")).toBeNull();
    expect(instagramHandle("https://www.facebook.com/baysidechiro")).toBeNull();
    expect(instagramHandle("https://notinstagram.com/baysidechiro")).toBeNull();
    expect(instagramHandle("not a url")).toBeNull();
  });
  it("takes the first usable handle from a list", () => {
    expect(instagramHandleFrom(["https://facebook.com/x", "https://instagram.com/p/1", "https://instagram.com/goodone"])).toBe("goodone");
    expect(instagramHandleFrom([])).toBeNull();
  });
});

describe("follow pace", () => {
  it("allows up to perWindow at once, then waits for the window", () => {
    expect(followPace([], at("10:00"), PACE)).toMatchObject({ readyNow: 2, today: 0, reason: "ok" });
    const two = [at("09:58"), at("09:59")];
    const p = followPace(two, at("10:00"), PACE);
    expect(p).toMatchObject({ readyNow: 0, reason: "window" });
    expect(p.nextAt).toEqual(at("10:03"));
    expect(followPace([at("09:58")], at("10:00"), PACE).readyNow).toBe(1);
  });
  it("stops at the daily cap and resumes at tomorrow's start", () => {
    const thirty = Array.from({ length: 30 }, (_, i) => new Date(+at("09:00") + i * 6 * 60_000));
    const p = followPace(thirty, at("15:00"), PACE);
    expect(p).toMatchObject({ readyNow: 0, today: 30, reason: "daily_cap" });
    expect(p.nextAt).toEqual(at("09:00", "2026-10-06"));
    // Yesterday's follows don't count today.
    expect(followPace(thirty, at("10:00", "2026-10-06"), PACE)).toMatchObject({ today: 0, readyNow: 2 });
  });
  it("is closed outside the active hours", () => {
    expect(followPace([], at("07:30"), PACE)).toMatchObject({ readyNow: 0, reason: "outside_hours", nextAt: at("09:00") });
    expect(followPace([], at("21:00"), PACE)).toMatchObject({ readyNow: 0, reason: "outside_hours", nextAt: at("09:00", "2026-10-06") });
  });
  it("never offers more than what's left today", () => {
    const n = Array.from({ length: 29 }, (_, i) => new Date(+at("09:00") + i * 6 * 60_000));
    expect(followPace(n, at("19:00"), PACE).readyNow).toBe(1);
  });
});
