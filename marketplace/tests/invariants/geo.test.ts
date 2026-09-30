import { afterEach, describe, expect, it, vi } from "vitest";
import { GeoServiceError, GoogleGeo } from "@cm/integrations";

const comp = (long: string, types: string[], short = long) => ({ long_name: long, short_name: short, types });
const deltona = (partial: boolean, street = true) => ({
  status: "OK",
  results: [
    {
      partial_match: partial || undefined,
      formatted_address: "641 Applegate Ter, Deltona, FL 32725, USA",
      geometry: { location: { lat: 28.9, lng: -81.2 } },
      address_components: [
        ...(street ? [comp("641", ["street_number"]), comp("Applegate Terrace", ["route"], "Applegate Ter")] : []),
        comp("Deltona", ["locality"]),
        comp("Florida", ["administrative_area_level_1"], "FL"),
        comp("United States", ["country"], "US"),
        comp("32725", ["postal_code"]),
      ],
    },
  ],
});

function stubGoogle(geocode: unknown) {
  const calls: URL[] = [];
  vi.stubGlobal("fetch", async (u: URL | string) => {
    const url = new URL(String(u));
    calls.push(url);
    const body = url.pathname.includes("timezone") ? { status: "OK", timeZoneId: "America/New_York" } : geocode;
    return new Response(JSON.stringify(body));
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("Google geocoder", () => {
  const g = new GoogleGeo("test-key");

  it("accepts a street-level partial match (Terrace vs Ter)", async () => {
    stubGoogle(deltona(true));
    expect(await g.geocode("641 Applegate Terrace, Deltona, FL 32725")).toMatchObject({ state: "FL", zip: "32725", city: "Deltona", addressLine1: "641 Applegate Terrace", timeZone: "America/New_York" });
  });

  it("rejects a partial match that only found the city/ZIP", async () => {
    stubGoogle(deltona(true, false));
    expect(await g.geocode("999 Nowhere Rd, Deltona, FL 32725")).toBeNull();
  });

  it("looks up by place ID from the autocomplete", async () => {
    const calls = stubGoogle(deltona(false));
    await g.geocode("641 Applegate Ter, Deltona, FL 32725", { placeId: "ChIJabc" });
    expect(calls[0].searchParams.get("place_id")).toBe("ChIJabc");
    expect(calls[0].searchParams.has("address")).toBe(false);
  });

  it("reports a key/API problem instead of 'address not found'", async () => {
    stubGoogle({ status: "REQUEST_DENIED", error_message: "API keys with referer restrictions cannot be used with this API." });
    await expect(g.geocode("641 Applegate Terrace, Deltona, FL 32725")).rejects.toThrow(GeoServiceError);
    stubGoogle({ status: "ZERO_RESULTS", results: [] });
    expect(await g.geocode("asdf")).toBeNull();
  });
});
