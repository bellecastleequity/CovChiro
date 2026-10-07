import { describe, expect, it } from "vitest";
import { CA_PROVINCES, regionName, US_STATES } from "../src";

describe("regions", () => {
  it("includes Puerto Rico and the U.S. Virgin Islands, and names Canadian provinces for the waitlist", () => {
    expect(US_STATES.PR).toBe("Puerto Rico");
    expect(US_STATES.VI).toBe("U.S. Virgin Islands");
    expect(regionName("ON")).toBe("Ontario, Canada");
    expect(regionName("FL")).toBe("Florida");
    expect(regionName("ZZ")).toBe("ZZ");
    // Province codes never collide with U.S. state or territory codes (both live in Lead.state).
    expect(Object.keys(CA_PROVINCES).filter((c) => c in US_STATES)).toEqual([]);
  });
});
