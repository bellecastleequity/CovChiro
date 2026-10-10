import { describe, expect, it } from "vitest";
import { ASSIGNABLE_BUILTIN_BADGES, customBadgeKey, customBadgeProblems, withAwardedBadges, type Badge } from "../src/badges";

const earned = (key: string): Badge => ({ key, label: key, description: "live numbers", kind: "earned", tone: "amber" });

describe("badges given by hand", () => {
  it("never lets a status or fact badge be given by hand", () => {
    for (const k of ["license", "malpractice", "npi", "oncall", "new", "seasoned", "multi_profession", "multi_state"]) expect(ASSIGNABLE_BUILTIN_BADGES[k]).toBeUndefined();
  });

  it("adds hand-given badges after the computed ones, once each, skipping unknown keys", () => {
    const custom = [{ key: "custom_mvp", label: "MVP", description: "October MVP.", tone: "brand" as const }];
    const out = withAwardedBadges([earned("top_rated")], [{ badgeKey: "top_rated" }, { badgeKey: "reliable" }, { badgeKey: "custom_mvp" }, { badgeKey: "custom_mvp" }, { badgeKey: "custom_gone" }, { badgeKey: "license" }], custom);
    expect(out.map((b) => b.key)).toEqual(["top_rated", "reliable", "custom_mvp"]);
    expect(out[0].description).toBe("live numbers");
    expect(out.find((b) => b.key === "custom_mvp")).toMatchObject({ label: "MVP", kind: "earned", tone: "brand" });
  });

  it("makes stable custom keys", () => {
    expect(customBadgeKey("Above & Beyond!")).toBe("custom_above_beyond");
    expect(customBadgeKey("🎉")).toBe("custom_badge");
  });

  it("checks custom badges: length, color, no contact details, no credential claims", () => {
    expect(customBadgeProblems({ label: "Above & Beyond", description: "Went above and beyond for a clinic.", tone: "amber" })).toBeNull();
    expect(customBadgeProblems({ label: "A", description: "Something good.", tone: "amber" })).toMatch(/name/);
    expect(customBadgeProblems({ label: "Great", description: "Hi", tone: "amber" })).toMatch(/Describe/);
    expect(customBadgeProblems({ label: "Great", description: "Something good.", tone: "pink" })).toMatch(/color/);
    expect(customBadgeProblems({ label: "Call me", description: "Reach me at 407-555-0123.", tone: "gray" })).toMatch(/phone/);
    expect(customBadgeProblems({ label: "Board certified", description: "Board certified in sports.", tone: "gray" })).toMatch(/license/);
  });
});
