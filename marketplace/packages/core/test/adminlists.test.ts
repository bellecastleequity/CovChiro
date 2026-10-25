import { describe, expect, it } from "vitest";
import { clinicGroup, providerGroup, providerStates, tally } from "../src/adminlists";

const now = new Date("2026-10-25T12:00:00Z");
const day = (n: number) => new Date(+now + n * 86_400_000);
const p = (o: Partial<Parameters<typeof providerGroup>[0]>) => ({ status: "ACTIVE", breakStartsAt: null, breakEndsAt: null, breakReason: null, ...o });

describe("admin list groups", () => {
  it("puts each provider in one group", () => {
    expect(providerGroup(p({}), now)).toBe("ready");
    expect(providerGroup(p({ status: "ONBOARDING" }), now)).toBe("onboarding");
    expect(providerGroup(p({ status: "SUSPENDED", breakStartsAt: day(-1) }), now)).toBe("suspended");
    expect(providerGroup(p({ breakStartsAt: day(-1) }), now)).toBe("break");
    expect(providerGroup(p({ breakStartsAt: day(-1), breakReason: "INACTIVE" }), now)).toBe("inactive");
    expect(providerGroup(p({ breakStartsAt: day(3) }), now)).toBe("ready"); // break not started yet
    expect(providerGroup(p({ breakStartsAt: day(-9), breakEndsAt: day(-1) }), now)).toBe("ready"); // break over
  });

  it("uses license states (not rejected, not national), else the home state", () => {
    expect(providerStates([{ state: "GA", status: "VERIFIED" }, { state: "FL", status: "PENDING_VERIFICATION" }, { state: "TX", status: "REJECTED" }, { state: "US", status: "VERIFIED" }], "FL")).toEqual(["FL", "GA"]);
    expect(providerStates([], "NC")).toEqual(["NC"]);
    expect(providerStates([], null)).toEqual([]);
  });

  it("calls a clinic active when it posted in the last 90 days", () => {
    expect(clinicGroup({ status: "ACTIVE", lastPostedAt: day(-10) }, now)).toBe("active");
    expect(clinicGroup({ status: "ONBOARDING", lastPostedAt: day(-10) }, now)).toBe("active");
    expect(clinicGroup({ status: "ACTIVE", lastPostedAt: day(-120) }, now)).toBe("quiet");
    expect(clinicGroup({ status: "ACTIVE", lastPostedAt: null }, now)).toBe("quiet");
    expect(clinicGroup({ status: "ONBOARDING", lastPostedAt: null }, now)).toBe("onboarding");
    expect(clinicGroup({ status: "SUSPENDED", lastPostedAt: day(-1) }, now)).toBe("suspended");
  });

  it("tallies each account once per value, largest first", () => {
    expect(tally([["FL", "GA"], ["FL"], ["FL", "FL"], ["TX"]])).toEqual([{ key: "FL", count: 3 }, { key: "GA", count: 1 }, { key: "TX", count: 1 }]);
  });
});
