import { describe, expect, it } from "vitest";
import { evaluateEligibility, hasQualifyingMalpractice } from "../src";
import { config, lic, OPTS, pair, policy, provider, shift } from "./fixtures";

describe("malpractice states covered", () => {
  const end = new Date("2026-12-01T00:00:00Z");
  const mins = { malpracticeMinOccurrenceCents: 0, malpracticeMinAggregateCents: 0 };
  it("an empty list means every state; otherwise the shift's state must be listed", () => {
    expect(hasQualifyingMalpractice([policy(["DC"])], "DC", end, mins, "VI")).toBe(true);
    expect(hasQualifyingMalpractice([policy(["DC"], { coveredStates: ["FL"] })], "DC", end, mins, "FL")).toBe(true);
    expect(hasQualifyingMalpractice([policy(["DC"], { coveredStates: ["FL"] })], "DC", end, mins, "VI")).toBe(false);
    expect(hasQualifyingMalpractice([policy(["DC"], { coveredStates: ["FL"] }), policy(["DC"], { coveredStates: ["VI"] })], "DC", end, mins, "VI")).toBe(true);
  });
  it("eligibility fails F2 for a shift in a state the policy doesn't cover", () => {
    const p = provider({ licenses: [lic("DC", "FL"), lic("DC", "VI")], malpractice: [policy(["DC"], { coveredStates: ["FL"] })] });
    const viShift = shift({ state: "VI" });
    const r = evaluateEligibility(p, viShift, pair(), OPTS);
    expect(r.failures.map((f) => f.code)).toContain("MALPRACTICE_INVALID");
    expect(evaluateEligibility(p, shift(), pair(), OPTS).failures.map((f) => f.code)).not.toContain("MALPRACTICE_INVALID");
    void config;
  });
});
