import { describe, expect, it } from "vitest";
import { closedListAfterToggle, marketsToOpen, supplyCheck, waitingDraftAction } from "../src";

const H = 3_600_000;

describe("posting supply check: at least one doctor must be able to take the shift", () => {
  it("passes when enough doctors are available", () => {
    const r = supplyCheck({ needed: 1, eligible: 2, excluded: [] });
    expect(r).toMatchObject({ ok: true, available: 2, gap: null });
  });
  it("no one licensed nearby = not enrolled yet", () => {
    const r = supplyCheck({ needed: 1, eligible: 0, excluded: [] });
    expect(r.ok).toBe(false);
    expect(r.gap).toBe("NONE_NEARBY");
    expect(r.headline).toMatch(/no doctors near you/i);
  });
  it("doctors too far away or not finished joining count as none nearby", () => {
    expect(supplyCheck({ needed: 1, eligible: 0, excluded: [["F7"], ["F3"], ["F3", "F5"]] }).gap).toBe("NONE_NEARBY");
  });
  it("fully booked doctors", () => {
    const r = supplyCheck({ needed: 1, eligible: 0, excluded: [["F5"], ["F5", "F4"], ["F4"]] });
    expect(r.gap).toBe("BOOKED");
    expect(r.headline).toMatch(/booked/i);
  });
  it("doctors not available that day (hours, time off, a break)", () => {
    expect(supplyCheck({ needed: 1, eligible: 0, excluded: [["F4"], ["F4"], ["F5"]] }).gap).toBe("UNAVAILABLE");
  });
  it("shift requirements rule everyone out, and says which to relax", () => {
    const r = supplyCheck({ needed: 1, eligible: 0, excluded: [["F6"], ["F11", "F8"]] });
    expect(r.gap).toBe("REQUIREMENTS");
    expect(r.detail).toMatch(/required skills/);
    expect(r.detail).toMatch(/minimum experience/);
    expect(r.detail).toMatch(/travel budget/);
  });
  it("never reveals pay floors at the market price, but suggests the market price for a clinic-set rate", () => {
    const market = supplyCheck({ needed: 1, eligible: 0, excluded: [["F12"]] });
    expect(market.gap).toBe("REQUIREMENTS");
    expect(market.detail).not.toMatch(/pay|minimum|floor|rate/i);
    expect(supplyCheck({ needed: 1, eligible: 0, excluded: [["F12"]], clinicRate: true }).detail).toMatch(/market price/i);
  });
  it("several providers needed but fewer available", () => {
    const r = supplyCheck({ needed: 3, eligible: 1, excluded: [["F5"]] });
    expect(r).toMatchObject({ ok: false, available: 1, gap: "TOO_FEW" });
    expect(r.headline).toMatch(/only 1 doctor/i);
  });
});

describe("automatic opening of states", () => {
  const base = {
    states: ["FL", "GA", "TX", "PR"],
    closed: ["PR"],
    professions: ["DC"],
    stateRows: [{ state: "FL", enabled: true }, { state: "GA", enabled: false }],
    pairRows: [{ professionCode: "DC", state: "FL", enabled: true }, { professionCode: "DC", state: "GA", enabled: false }],
  };
  it("opens every state and profession pair not on the closed list", () => {
    const r = marketsToOpen(base);
    expect(r.states).toEqual(["GA", "TX"]);
    expect(r.pairs).toEqual([{ professionCode: "DC", state: "GA" }, { professionCode: "DC", state: "TX" }]);
  });
  it("leaves a closed state, or a closed pair, alone", () => {
    const r = marketsToOpen({ ...base, closed: ["PR", "TX", "DC:GA"] });
    expect(r.states).toEqual(["GA"]);
    expect(r.pairs).toEqual([]);
  });
  it("records the admin's switch: off adds to the closed list, on removes it", () => {
    expect(closedListAfterToggle(["PR"], "GA", false)).toEqual(["GA", "PR"]);
    expect(closedListAfterToggle(["GA", "PR"], "GA", true)).toEqual(["PR"]);
    expect(closedListAfterToggle(["PR"], "DC:GA", false)).toEqual(["DC:GA", "PR"]);
    expect(closedListAfterToggle(["PR"], "GA", true)).toEqual(["PR"]);
  });
});

describe("drafts waiting for a doctor", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  it("tells the clinic once a doctor is available", () => {
    expect(waitingDraftAction({ now, startsAt: new Date(+now + 48 * H), available: 1, notifiedAt: null })).toBe("NOTIFY");
    expect(waitingDraftAction({ now, startsAt: new Date(+now + 48 * H), available: 0, notifiedAt: null })).toBe("WAIT");
  });
  it("doesn't repeat the notice while doctors stay available", () => {
    expect(waitingDraftAction({ now, startsAt: new Date(+now + 48 * H), available: 2, notifiedAt: new Date(+now - H) })).toBe("WAIT");
  });
  it("re-arms the notice when the doctor is taken again before the clinic posts", () => {
    expect(waitingDraftAction({ now, startsAt: new Date(+now + 48 * H), available: 0, notifiedAt: new Date(+now - H) })).toBe("RESET");
  });
  it("gives up once the shift is too close to post", () => {
    expect(waitingDraftAction({ now, startsAt: new Date(+now + 1 * H), available: 0, notifiedAt: null })).toBe("EXPIRE");
  });
});
