import { describe, expect, it } from "vitest";
import { tierConfigFor } from "@cm/config";
import {
  arrivalFeasible, awardAtClose, broadcastAwardAt, capWindow, describeOnCallRule, dispatchScore, inQuietHours, onCallRuleMismatch, orderForDispatch,
  parseSmsReply, pickReplyCode, pRespond, rankProtectedAward, responseCounts, urgencyTier, waveAllDeclined, waveSize,
  type OnCallRuleFacts, type WaveOffer,
} from "../src";
import { d, S } from "./fixtures";

const now = d("2026-10-14T11:02:00Z"); // 7:02am Eastern

describe("urgency tiers (§2)", () => {
  it("classifies by hours to start", () => {
    expect(urgencyTier(now, d("2026-10-14T13:00:00Z"))).toBe("SAME_DAY");
    expect(urgencyTier(now, d("2026-10-15T13:00:00Z"))).toBe("SHORT");
    expect(urgencyTier(now, d("2026-10-17T13:00:00Z"))).toBe("NEAR");
    expect(urgencyTier(now, d("2026-10-30T13:00:00Z"))).toBe("PLANNED");
  });
  it("escalates as time passes (test 11)", () => {
    const start = d("2026-10-15T00:00:00Z");
    expect(urgencyTier(d("2026-10-14T11:00:00Z"), start)).toBe("SHORT");
    expect(urgencyTier(d("2026-10-14T12:00:01Z"), start)).toBe("SAME_DAY");
  });
});

describe("wave sizing (test 11)", () => {
  it.each([
    ["SAME_DAY", [5, 8, 11, 14, 15]],
    ["SHORT", [3, 5, 7, 9, 10]],
    ["NEAR", [3, 5, 7, 8, 8]],
    ["PLANNED", [3, 5, 7, 8, 8]],
  ] as const)("%s", (tier, sizes) => {
    const cfg = tierConfigFor(S, tier);
    expect([1, 2, 3, 4, 5].map((n) => waveSize(cfg, n, 100))).toEqual(sizes);
  });
  it("limited by remaining candidates; per-profession overrides", () => {
    expect(waveSize(tierConfigFor(S, "SAME_DAY"), 2, 4)).toBe(4);
    const s2 = { ...S, "dispatch.tierOverridesByProfession": { LMT: { SAME_DAY: { windowMin: 10 } } } };
    expect(tierConfigFor(s2, "SAME_DAY", "LMT").windowMin).toBe(10);
    expect(tierConfigFor(s2, "SAME_DAY", "DC").windowMin).toBe(5);
  });
});

describe("arrival feasibility & window capping (test 12)", () => {
  const start = d("2026-10-14T13:00:00Z"); // 9:00
  it("drops providers who can't arrive", () => {
    expect(arrivalFeasible(now, 60, 15, start)).toBe(true); // 7:02 + 75 = 8:17
    expect(arrivalFeasible(now, 110, 15, start)).toBe(false); // 9:07
    expect(arrivalFeasible(now, null, 15, start)).toBe(false);
  });
  it("shortens the window so the farthest can still arrive", () => {
    const r = capWindow(now, 30, start, [{ driveMinutes: 20 }, { driveMinutes: 95 }], 15, 3);
    // latest = 9:00 − 110 min = 7:10 → 8 minutes window
    expect(r.windowEnd).toEqual(d("2026-10-14T11:10:00Z"));
    expect(r.members).toHaveLength(2);
  });
  it("drops the farthest when the window would be under the minimum", () => {
    const r = capWindow(now, 5, start, [{ driveMinutes: 20 }, { driveMinutes: 102 }], 15, 3);
    expect(r.dropped.map((x) => x.driveMinutes)).toEqual([102]);
    expect(r.windowEnd).toEqual(d("2026-10-14T11:07:00Z"));
  });
});

describe("responsiveness & dispatch score (test 13)", () => {
  it("new providers start at 0.5", () => {
    expect(pRespond({ n: 0, hits: 0 }, { n: 0, hits: 0 }, S["responsiveness.prior"])).toBe(0.5);
  });
  it("counts decline as a hit; recency weighting; blending", () => {
    const recs = [
      { tier: "SAME_DAY" as const, sentAt: d("2026-10-10T00:00:00Z"), respondedAt: d("2026-10-10T00:03:00Z"), windowMinutes: 5 },
      { tier: "SAME_DAY" as const, sentAt: d("2026-10-11T00:00:00Z"), respondedAt: d("2026-10-11T00:09:00Z"), windowMinutes: 5 },
      { tier: "SAME_DAY" as const, sentAt: d("2026-08-01T00:00:00Z"), respondedAt: null, windowMinutes: 5 },
      { tier: "NEAR" as const, sentAt: d("2026-10-12T00:00:00Z"), respondedAt: d("2026-10-12T01:00:00Z"), windowMinutes: 90 },
    ];
    const c = responseCounts(recs, now);
    expect(c.byTier.SAME_DAY).toEqual({ n: 2.5, hits: 1 });
    const p = pRespond(c.byTier.SAME_DAY, c.overall, { a: 2, b: 2 });
    const w = 2.5 / 3;
    expect(p).toBeCloseTo(w * (3 / 6.5) + (1 - w) * (4 / 7.5));
    expect(pRespond({ n: 10, hits: 9 }, { n: 10, hits: 9 }, { a: 2, b: 2 })).toBeCloseTo(11 / 14);
  });
  it("β per tier trades fit for responsiveness", () => {
    const strongSlow = { match: 0.84, p: 0.2 };
    const weakerFast = { match: 0.78, p: 0.95 };
    // same-day β=0.6: fast one asked first
    expect(dispatchScore(weakerFast.match, weakerFast.p, 0.6)).toBeGreaterThan(dispatchScore(strongSlow.match, strongSlow.p, 0.6));
    // planned β=0.2: better match still first
    expect(dispatchScore(strongSlow.match, strongSlow.p, 0.2)).toBeGreaterThan(dispatchScore(weakerFast.match, weakerFast.p, 0.2) - 0.1);
    const ordered = orderForDispatch(
      [
        { providerId: "a", matchScore: 0.8, dispatchScore: 0.7, driveMinutes: 30, shiftsThisMonth: 1 },
        { providerId: "b", matchScore: 0.9, dispatchScore: 0.7, driveMinutes: 30, shiftsThisMonth: 1 },
        { providerId: "c", matchScore: 0.6, dispatchScore: 0.75, driveMinutes: 30, shiftsThisMonth: 1 },
      ],
      "s",
    );
    expect(ordered.map((x) => x.providerId)).toEqual(["c", "b", "a"]);
  });
});

describe("rank-protected award (tests 5–10)", () => {
  const offer = (id: string, matchScore: number, status: WaveOffer["status"], acceptedAt: Date | null = null): WaveOffer => ({ id, matchScore, status, acceptedAt });
  it("5. top-ranked accepts first → immediate", () => {
    expect(rankProtectedAward([offer("B", 0.84, "ACCEPTED_PENDING", now), offer("C", 0.79, "PENDING")]).award).toBe("B");
  });
  it("6. lower accepts, higher accepts later → higher wins", () => {
    const w = [offer("B", 0.84, "PENDING"), offer("C", 0.79, "PENDING"), offer("D", 0.77, "ACCEPTED_PENDING", now)];
    expect(rankProtectedAward(w)).toEqual({ award: null, waitingOn: ["B", "C"] });
    w[1].status = "DECLINED";
    expect(rankProtectedAward(w).award).toBeNull();
    w[0].status = "ACCEPTED_PENDING";
    expect(rankProtectedAward(w).award).toBe("B");
  });
  it("7. lower accepts, all higher decline → lower confirmed at the last decline", () => {
    const w = [offer("B", 0.84, "DECLINED"), offer("C", 0.79, "DECLINED"), offer("D", 0.77, "ACCEPTED_PENDING", now), offer("E", 0.7, "PENDING")];
    expect(rankProtectedAward(w).award).toBe("D");
  });
  it("8. higher never responds → best acceptor at window close", () => {
    const w = [offer("B", 0.84, "PENDING"), offer("D", 0.77, "ACCEPTED_PENDING", now)];
    expect(rankProtectedAward(w).award).toBeNull();
    expect(awardAtClose(w)).toBe("D");
  });
  it("9. all decline → next wave immediately", () => {
    expect(waveAllDeclined([offer("B", 0.8, "DECLINED"), offer("C", 0.7, "EXPIRED")])).toBe(true);
    expect(waveAllDeclined([offer("B", 0.8, "DECLINED"), offer("C", 0.7, "PENDING")])).toBe(false);
  });
  it("10. broadcast: hold after first accept; best acceptor wins at hold end", () => {
    const at = broadcastAwardAt(now, 3, d("2026-10-14T11:17:00Z"));
    expect(at).toEqual(d("2026-10-14T11:05:00Z"));
    expect(broadcastAwardAt(d("2026-10-14T11:16:00Z"), 3, d("2026-10-14T11:17:00Z"))).toEqual(d("2026-10-14T11:17:00Z"));
    expect(awardAtClose([offer("X", 0.6, "ACCEPTED_PENDING", now), offer("Y", 0.75, "ACCEPTED_PENDING", d("2026-10-14T11:04:00Z"))])).toBe("Y");
  });
});

describe("On Call rules (tests 2, 18)", () => {
  const rule: OnCallRuleFacts = {
    active: true, pausedUntil: null, professionCodes: ["DC"], recurringWindows: [3].map((weekday) => ({ weekday, startMin: 7 * 60, endMin: 19 * 60 })), dateWindows: [],
    timeZone: "America/New_York", maxDriveMinutes: 45, minPayHalfDayCents: 20000, minPayFullDayCents: 40000, minPayHourlyCents: null, minNoticeMinutes: 90,
    maxPerDay: 1, maxPerWeek: 5, favoritesOnly: false, minClinicRating: null, excludedClinicIds: [], allowOvernight: false,
  };
  const shift = { professionCode: "DC", startsAt: d("2026-10-14T13:00:00Z"), endsAt: d("2026-10-14T21:00:00Z"), durationTier: "FULL_DAY" as const, hours: 8, providerPayCents: 45000, clinicOrgId: "c1", lodgingAllowed: false };
  const ctx = { now, driveMinutes: 30, clinicFavoritedByProvider: false, clinicRating: 4.8, onCallShiftsSameDay: 0, onCallShiftsSameWeek: 0, needsOvernight: false };
  it("matches and explains mismatches", () => {
    expect(onCallRuleMismatch(rule, shift, ctx)).toBeNull();
    expect(onCallRuleMismatch(rule, { ...shift, professionCode: "LMT" }, ctx)).toBe("profession");
    expect(onCallRuleMismatch(rule, { ...shift, providerPayCents: 39999 }, ctx)).toBe("pay");
    expect(onCallRuleMismatch(rule, shift, { ...ctx, now: d("2026-10-14T11:45:00Z") })).toBe("notice");
    expect(onCallRuleMismatch(rule, shift, { ...ctx, onCallShiftsSameDay: 1 })).toBe("daily limit");
    expect(onCallRuleMismatch(rule, shift, { ...ctx, onCallShiftsSameWeek: 5 })).toBe("weekly limit");
    expect(onCallRuleMismatch(rule, shift, { ...ctx, driveMinutes: 50 })).toBe("drive");
    expect(onCallRuleMismatch({ ...rule, favoritesOnly: true }, shift, ctx)).toBe("favorites only");
    expect(onCallRuleMismatch({ ...rule, pausedUntil: d("2026-10-15T00:00:00Z") }, shift, ctx)).toBe("paused");
    expect(onCallRuleMismatch(rule, { ...shift, startsAt: d("2026-10-15T13:00:00Z"), endsAt: d("2026-10-15T21:00:00Z") }, ctx)).toBe("time window");
    expect(describeOnCallRule(rule, { DC: "Chiropractic" })).toMatch(/chiropractic shifts within 45 min of home, Wed 7:00am–7:00pm, paying at least \$400\/day\. Up to 1 per day/);
  });
});

describe("quiet hours & SMS replies (tests 21, 22)", () => {
  it("quiet hours wrap midnight in the provider's zone", () => {
    expect(inQuietHours(d("2026-10-14T02:00:00Z"), "America/New_York", 21 * 60, 6 * 60)).toBe(true); // 10pm ET
    expect(inQuietHours(d("2026-10-14T14:00:00Z"), "America/New_York", 21 * 60, 6 * 60)).toBe(false);
  });
  it("parses replies; bare YES has no code", () => {
    expect(parseSmsReply("yes 4821")).toEqual({ kind: "YES", code: "4821" });
    expect(parseSmsReply("Y 4821")).toEqual({ kind: "YES", code: "4821" });
    expect(parseSmsReply("decline 4821")).toEqual({ kind: "NO", code: "4821" });
    expect(parseSmsReply("YES")).toEqual({ kind: "YES", code: null });
    expect(parseSmsReply("STOP")).toEqual({ kind: "STOP" });
    expect(parseSmsReply("help")).toEqual({ kind: "HELP" });
    expect(parseSmsReply("maybe later")).toEqual({ kind: "UNKNOWN" });
    expect(pickReplyCode(new Set(["1000"]), () => 0.5)).toBe("5500");
  });
});

describe("quiet hours: waiting instead of giving up", () => {
  it("quietHoursEnd gives the next local end time, across midnight and daylight-saving changes", async () => {
    const { quietHoursEnd } = await import("../src");
    // 5:00 AM EST on Nov 4 2026 → 6:00 AM EST (11:00 UTC).
    expect(quietHoursEnd(new Date("2026-11-04T10:00:00Z"), "America/New_York", 1260, 360)?.toISOString()).toBe("2026-11-04T11:00:00.000Z");
    // 11 PM EDT on Oct 14 → 6 AM EDT next day (10:00 UTC).
    expect(quietHoursEnd(new Date("2026-10-15T03:00:00Z"), "America/New_York", 1260, 360)?.toISOString()).toBe("2026-10-15T10:00:00.000Z");
    // Not in quiet hours → null; no quiet hours configured → null.
    expect(quietHoursEnd(new Date("2026-10-14T16:00:00Z"), "America/New_York", 1260, 360)).toBeNull();
    expect(quietHoursEnd(new Date("2026-10-14T03:00:00Z"), "America/New_York", 0, 0)).toBeNull();
  });

  it("quietWakeTime picks the earliest wake from which a provider can still arrive in time", async () => {
    const { quietWakeTime } = await import("../src");
    const start = new Date("2026-11-04T13:00:00Z"); // 8 AM EST
    const six = new Date("2026-11-04T11:00:00Z");
    const seven = new Date("2026-11-04T12:00:00Z");
    expect(quietWakeTime([{ wakesAt: seven, driveMinutes: 20 }, { wakesAt: six, driveMinutes: 30 }], 30, start)).toEqual(six);
    // 6 AM + 100 min drive + 30 min buffer is past 8 AM → that one can't make it; the 7 AM one can.
    expect(quietWakeTime([{ wakesAt: six, driveMinutes: 100 }, { wakesAt: seven, driveMinutes: 20 }], 30, start)).toEqual(seven);
    expect(quietWakeTime([{ wakesAt: seven, driveMinutes: 60 }], 30, start)).toBeNull();
    expect(quietWakeTime([], 30, start)).toBeNull();
  });
});
