import { describe, expect, it } from "vitest";
import { clinicRewardEvents, DEFAULT_LEVELS, DEFAULT_REWARD_POINTS, providerRewardEvents, rewardLevel, type ProviderRewardFacts } from "../src";

const d = (s: string) => new Date(s);
const H = 3_600_000;

describe("reward levels", () => {
  it("Bronze → Silver → Gold → Platinum with progress to the next", () => {
    expect(rewardLevel(0, DEFAULT_LEVELS)).toMatchObject({ level: "Bronze", next: "Silver", pointsToNext: 500, progress: 0 });
    expect(rewardLevel(750, DEFAULT_LEVELS)).toMatchObject({ level: "Silver", next: "Gold", pointsToNext: 750, progress: 0.25 });
    expect(rewardLevel(1500, DEFAULT_LEVELS)).toMatchObject({ level: "Gold", next: "Platinum" });
    expect(rewardLevel(9999, DEFAULT_LEVELS)).toMatchObject({ level: "Platinum", next: null, progress: 1 });
    expect(rewardLevel(-80, DEFAULT_LEVELS).level).toBe("Bronze");
  });
});

const base: ProviderRewardFacts = {
  id: "p1", emailVerified: true, profile: true, photo: false, npi: false, licenseVerified: true, malpracticeVerified: false,
  payouts: false, agreement: true, availability: false, ready: false, assignments: [], rewardedReferralIds: [], trailblazerStates: [],
};
const opts = { lateGraceMinutes: 10, lateCancelHours: 72 };

describe("provider points", () => {
  it("each setup step once, with stable keys", () => {
    const e = providerRewardEvents(base, DEFAULT_REWARD_POINTS, opts);
    expect(e.map((x) => x.refKey).sort()).toEqual(["p.agreement:p1", "p.email:p1", "p.license:p1", "p.profile:p1"]);
    expect(e.reduce((t, x) => t + x.points, 0)).toBe(10 + 15 + 25 + 15);
  });

  it("a completed shift: on time, clean punches, 5 stars, short notice; deductions for late cancels and no-shows", () => {
    const start = d("2026-10-14T12:00:00Z");
    const shift = { startsAt: start, cancelledAt: null, cancelledBy: null, firstInAt: new Date(+start + 5 * 60_000), cleanPunches: true, clinicStars: 5, urgent: true };
    const e = providerRewardEvents({ ...base, emailVerified: false, profile: false, licenseVerified: false, agreement: false, assignments: [
      { id: "a1", status: "COMPLETED", ...shift },
      { id: "a2", status: "COMPLETED", ...shift, firstInAt: new Date(+start + 30 * 60_000), cleanPunches: false, clinicStars: 4, urgent: false },
      { id: "a3", status: "CANCELLED", ...shift, cancelledBy: "PROVIDER", cancelledAt: new Date(+start - 10 * H) },
      { id: "a4", status: "CANCELLED", ...shift, cancelledBy: "PROVIDER", cancelledAt: new Date(+start - 200 * H) },
      { id: "a5", status: "NO_SHOW", ...shift },
    ] }, DEFAULT_REWARD_POINTS, opts);
    expect(e.map((x) => x.refKey).sort()).toEqual(["p.fiveStar:a1", "p.lateCancel:a3", "p.noShow:a5", "p.onTime:a1", "p.punches:a1", "p.shift:a1", "p.shift:a2", "p.urgent:a1"]);
  });

  it("an admin can switch a rule off by setting it to 0", () => {
    const e = providerRewardEvents(base, { ...DEFAULT_REWARD_POINTS, "p.email": 0 }, opts);
    expect(e.some((x) => x.kind === "p.email")).toBe(false);
  });

  it("referrals and Trailblazer", () => {
    const e = providerRewardEvents({ ...base, rewardedReferralIds: ["r1"], trailblazerStates: ["GA"] }, DEFAULT_REWARD_POINTS, opts);
    expect(e.find((x) => x.kind === "p.referral")?.refKey).toBe("p.referral:r1");
    expect(e.find((x) => x.kind === "p.trailblazer")?.refKey).toBe("p.trailblazer:p1:GA");
  });
});

describe("clinic points", () => {
  it("setup, early posting, quick sign-off, rating, late cancel", () => {
    const start = d("2026-10-20T12:00:00Z");
    const e = clinicRewardEvents({
      id: "c1", emailVerified: true, location: true, paymentMethod: true, agreement: false, posted: true, rewardedReferralIds: [],
      assignments: [
        { id: "a1", status: "COMPLETED", startsAt: start, postedAt: new Date(+start - 8 * 24 * H), cancelledAt: null, cancelledBy: null, timesheetSubmittedAt: new Date(+start + 9 * H), timesheetApprovedAt: new Date(+start + 20 * H), clinicSigned: true, ratedProvider: true },
        { id: "a2", status: "COMPLETED", startsAt: start, postedAt: new Date(+start - 2 * 24 * H), cancelledAt: null, cancelledBy: null, timesheetSubmittedAt: new Date(+start + 9 * H), timesheetApprovedAt: new Date(+start + 60 * H), clinicSigned: false, ratedProvider: false },
        { id: "a3", status: "CANCELLED", startsAt: start, postedAt: null, cancelledAt: new Date(+start - 5 * H), cancelledBy: "CLINIC", timesheetSubmittedAt: null, timesheetApprovedAt: null, clinicSigned: false, ratedProvider: false },
      ],
    }, DEFAULT_REWARD_POINTS, { lateCancelHours: 48 });
    expect(e.map((x) => x.refKey).sort()).toEqual(["c.early:a1", "c.email:c1", "c.firstPost:c1", "c.lateCancel:a3", "c.location:c1", "c.payment:c1", "c.rated:a1", "c.shift:a1", "c.shift:a2", "c.signoff:a1"]);
  });
});
