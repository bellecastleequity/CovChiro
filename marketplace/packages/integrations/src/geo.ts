import { env } from "@cm/config";

export interface GeocodeResult {
  formatted: string;
  addressLine1: string;
  city: string;
  /** USPS 2-letter code, derived from the geocoder — the only source of a location's state (INV-1). */
  state: string;
  zip: string;
  lat: number;
  lng: number;
  timeZone: string;
}

export interface DriveResult {
  minutes: number;
  miles: number;
}

export interface GeoProvider {
  name: string;
  geocode(address: string): Promise<GeocodeResult | null>;
  /** Drive time/distance from many origins to one destination. null = no route. */
  driveMatrix(origins: { lat: number; lng: number }[], dest: { lat: number; lng: number }, departAt: Date): Promise<(DriveResult | null)[]>;
}

// ---------------- Google (Geocoding + Time Zone + Routes) ----------------

class GoogleGeo implements GeoProvider {
  name = "google";
  constructor(private key: string) {}

  async geocode(address: string): Promise<GeocodeResult | null> {
    const u = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    u.searchParams.set("address", address);
    u.searchParams.set("components", "country:US");
    u.searchParams.set("key", this.key);
    const r = await fetch(u);
    const j = (await r.json()) as any;
    const top = j.results?.[0];
    if (!top || top.partial_match) return null;
    const comp = (t: string, short = false) => {
      const c = top.address_components.find((x: any) => x.types.includes(t));
      return c ? (short ? c.short_name : c.long_name) : "";
    };
    const state = comp("administrative_area_level_1", true);
    const zip = comp("postal_code");
    if (!state || !zip) return null;
    const { lat, lng } = top.geometry.location;
    const tz = new URL("https://maps.googleapis.com/maps/api/timezone/json");
    tz.searchParams.set("location", `${lat},${lng}`);
    tz.searchParams.set("timestamp", String(Math.floor(Date.now() / 1000)));
    tz.searchParams.set("key", this.key);
    const tj = (await (await fetch(tz)).json()) as any;
    return {
      formatted: top.formatted_address,
      addressLine1: [comp("street_number"), comp("route")].filter(Boolean).join(" "),
      city: comp("locality") || comp("sublocality") || comp("postal_town"),
      state,
      zip,
      lat,
      lng,
      timeZone: tj.timeZoneId ?? "America/New_York",
    };
  }

  async driveMatrix(origins: { lat: number; lng: number }[], dest: { lat: number; lng: number }, departAt: Date) {
    if (!origins.length) return [];
    const r = await fetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.key,
        "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,condition",
      },
      body: JSON.stringify({
        origins: origins.map((o) => ({ waypoint: { location: { latLng: { latitude: o.lat, longitude: o.lng } } } })),
        destinations: [{ waypoint: { location: { latLng: { latitude: dest.lat, longitude: dest.lng } } } }],
        travelMode: "DRIVE",
        routingPreference: departAt > new Date() ? "TRAFFIC_AWARE" : "TRAFFIC_UNAWARE",
        ...(departAt > new Date() ? { departureTime: departAt.toISOString() } : {}),
      }),
    });
    const rows = (await r.json()) as any[];
    const out: (DriveResult | null)[] = origins.map(() => null);
    for (const e of Array.isArray(rows) ? rows : []) {
      if (e.condition !== "ROUTE_EXISTS") continue;
      out[e.originIndex] = { minutes: Math.round(parseInt(String(e.duration), 10) / 60), miles: Math.round((e.distanceMeters / 1609.344) * 10) / 10 };
    }
    return out;
  }
}

// ---------------- Fake (development / tests) ----------------

// ZIP3 → [state, lat, lng] centroids for the launch market plus neighbours;
// other ZIPs resolve to their state via ZIP_RANGES with a generic centroid.
const ZIP3: Record<string, [string, number, number]> = {
  "320": ["FL", 30.33, -81.66], "321": ["FL", 29.21, -81.02], "322": ["FL", 30.33, -81.66], "323": ["FL", 30.44, -84.28],
  "324": ["FL", 30.16, -85.66], "325": ["FL", 30.42, -87.22], "326": ["FL", 29.65, -82.32], "327": ["FL", 28.66, -81.37],
  "328": ["FL", 28.54, -81.38], "329": ["FL", 28.08, -80.61], "330": ["FL", 25.77, -80.19], "331": ["FL", 25.76, -80.3],
  "332": ["FL", 25.78, -80.21], "333": ["FL", 26.12, -80.14], "334": ["FL", 26.71, -80.05], "335": ["FL", 27.95, -82.46],
  "336": ["FL", 27.95, -82.46], "337": ["FL", 27.77, -82.64], "338": ["FL", 28.04, -81.95], "339": ["FL", 26.64, -81.87],
  "341": ["FL", 26.14, -81.79], "342": ["FL", 27.34, -82.53], "344": ["FL", 29.19, -82.14], "346": ["FL", 28.24, -82.72],
  "347": ["FL", 28.29, -81.41], "349": ["FL", 27.45, -80.33], "300": ["GA", 33.75, -84.39], "303": ["GA", 33.75, -84.39],
  "314": ["GA", 32.08, -81.09], "316": ["GA", 30.83, -83.28], "350": ["AL", 33.52, -86.8], "365": ["AL", 30.69, -88.04],
};

const ZIP_RANGES: [number, number, string][] = [
  [5, 5, "NY"], [6, 9, "PR"], [10, 27, "MA"], [28, 29, "RI"], [30, 38, "NH"], [39, 49, "ME"], [50, 59, "VT"], [60, 69, "CT"],
  [70, 89, "NJ"], [100, 149, "NY"], [150, 196, "PA"], [197, 199, "DE"], [200, 205, "DC"], [206, 219, "MD"], [220, 246, "VA"],
  [247, 268, "WV"], [270, 289, "NC"], [290, 299, "SC"], [300, 319, "GA"], [320, 349, "FL"], [350, 369, "AL"], [370, 385, "TN"],
  [386, 397, "MS"], [398, 399, "GA"], [400, 427, "KY"], [430, 459, "OH"], [460, 479, "IN"], [480, 499, "MI"], [500, 528, "IA"],
  [530, 549, "WI"], [550, 567, "MN"], [570, 577, "SD"], [580, 588, "ND"], [590, 599, "MT"], [600, 629, "IL"], [630, 658, "MO"],
  [660, 679, "KS"], [680, 693, "NE"], [700, 715, "LA"], [716, 729, "AR"], [730, 749, "OK"], [750, 799, "TX"], [800, 816, "CO"],
  [820, 831, "WY"], [832, 838, "ID"], [840, 847, "UT"], [850, 865, "AZ"], [870, 884, "NM"], [889, 898, "NV"], [900, 961, "CA"],
  [967, 968, "HI"], [970, 979, "OR"], [980, 994, "WA"], [995, 999, "AK"],
];

const CENTRAL_TZ_STATES = new Set(["AL", "AR", "IL", "IA", "KS", "LA", "MN", "MS", "MO", "NE", "ND", "OK", "SD", "TN", "TX", "WI"]);

function stateForZip(zip: string): string | null {
  const z3 = parseInt(zip.slice(0, 3), 10);
  const hit = ZIP_RANGES.find(([a, b]) => z3 >= a && z3 <= b);
  return hit ? hit[2] : null;
}

function tzFor(state: string, zip: string): string {
  if (state === "FL" && (zip.startsWith("324") || zip.startsWith("325"))) return "America/Chicago";
  if (CENTRAL_TZ_STATES.has(state)) return "America/Chicago";
  if (["CO", "MT", "NM", "UT", "WY", "ID"].includes(state)) return "America/Denver";
  if (state === "AZ") return "America/Phoenix";
  if (["CA", "NV", "OR", "WA"].includes(state)) return "America/Los_Angeles";
  if (state === "AK") return "America/Anchorage";
  if (state === "HI") return "Pacific/Honolulu";
  return "America/New_York";
}

function hashOffset(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return ((Math.abs(h) % 1000) / 1000 - 0.5) * 0.12; // ±0.06° ≈ ±4 miles
}

export function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export class FakeGeo implements GeoProvider {
  name = "fake";
  async geocode(address: string): Promise<GeocodeResult | null> {
    const zip = address.match(/\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/)?.[1];
    if (!zip) return null;
    const known = ZIP3[zip.slice(0, 3)];
    const state = known?.[0] ?? stateForZip(zip);
    if (!state) return null;
    const [lat0, lng0] = known ? [known[1], known[2]] : [37, -95];
    const parts = address.split(",").map((s) => s.trim());
    return {
      formatted: address,
      addressLine1: parts[0] ?? address,
      city: parts.length >= 3 ? parts[parts.length - 2].replace(/\b[A-Z]{2}\b.*$/, "").trim() || parts[1] : parts[1] ?? "",
      state,
      zip,
      lat: Math.round((lat0 + hashOffset(address)) * 1e5) / 1e5,
      lng: Math.round((lng0 + hashOffset(address + "x")) * 1e5) / 1e5,
      timeZone: tzFor(state, zip),
    };
  }
  async driveMatrix(origins: { lat: number; lng: number }[], dest: { lat: number; lng: number }) {
    return origins.map((o) => {
      const miles = Math.round(haversineMiles(o, dest) * 1.25 * 10) / 10;
      return { miles, minutes: Math.round((miles / 45) * 60 + 5) };
    });
  }
}

let geo: GeoProvider | null = null;
export function geoProvider(): GeoProvider {
  if (!geo) {
    const key = env().GOOGLE_MAPS_API_KEY;
    geo = key ? new GoogleGeo(key) : new FakeGeo();
  }
  return geo;
}
