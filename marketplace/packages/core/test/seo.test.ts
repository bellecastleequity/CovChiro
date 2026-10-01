import { describe, expect, it } from "vitest";
import { cityFromSlug, cityLabel, jobPostable, nearbyCities, slugify, stateFromSlug, stateSlug } from "../src";

describe("SEO slugs", () => {
  it("makes clean, stable URL slugs", () => {
    expect(slugify("St Petersburg")).toBe("st-petersburg");
    expect(slugify("Port St. Lucie")).toBe("port-st-lucie");
    expect(slugify("  Coral Gables!! ")).toBe("coral-gables");
    expect(slugify("Spine & Sport")).toBe("spine-and-sport");
  });
  it("round-trips states and resolves only configured cities", () => {
    expect(stateSlug("FL")).toBe("florida");
    expect(stateFromSlug("florida")).toBe("FL");
    expect(stateFromSlug("new-york")).toBe("NY");
    expect(stateFromSlug("atlantis")).toBeNull();
    expect(cityFromSlug(["Tampa", "St Petersburg"], "st-petersburg")).toBe("St Petersburg");
    expect(cityFromSlug(["Tampa"], "orlando")).toBeNull();
    expect(cityLabel("St Petersburg")).toBe("St. Petersburg");
    expect(cityLabel("St. Augustine")).toBe("St. Augustine");
  });
});

describe("nearby cities", () => {
  const list = ["Orlando", "Kissimmee", "Tampa", "Brandon", "Miami", "Hialeah"];
  it("uses distance when city centers are known", () => {
    const centers = { Orlando: { lat: 28.54, lng: -81.38 }, Kissimmee: { lat: 28.29, lng: -81.41 }, Tampa: { lat: 27.95, lng: -82.46 }, Brandon: { lat: 27.94, lng: -82.29 }, Miami: { lat: 25.76, lng: -80.19 }, Hialeah: { lat: 25.86, lng: -80.28 } };
    expect(nearbyCities("Tampa", list, centers, 2)).toEqual(["Brandon", "Kissimmee"]);
  });
  it("falls back to neighbours in the (region-grouped) list", () => {
    expect(nearbyCities("Tampa", list, {}, 2)).toEqual(["Kissimmee", "Brandon"]);
  });
});

describe("public job postings", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const shift = { status: "OPEN", postedAt: now, startsAt: new Date("2026-10-05T13:00:00Z"), standingBookingId: null, cancelledAt: null };
  it("only open, posted, future, non-standing shifts are published", () => {
    expect(jobPostable(shift, now)).toBe(true);
    expect(jobPostable({ ...shift, status: "CONFIRMED" }, now)).toBe(false);
    expect(jobPostable({ ...shift, status: "DRAFT", postedAt: null }, now)).toBe(false);
    expect(jobPostable({ ...shift, standingBookingId: "s1" }, now)).toBe(false);
    expect(jobPostable({ ...shift, startsAt: new Date("2026-10-01T12:30:00Z") }, now)).toBe(false);
    expect(jobPostable({ ...shift, cancelledAt: now }, now)).toBe(false);
  });
});
