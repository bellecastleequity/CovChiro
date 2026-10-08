import { env } from "@cm/config";

/**
 * Clinic discovery source: the public NPPES NPI registry (CMS). Free, no key,
 * and it lists every licensed provider and practice by taxonomy (chiropractor,
 * physical therapist…) with its practice location, so we know where the offices
 * are and how many providers work at each.
 * Results are reduced to public practice-location facts (no mailing/home
 * addresses). Shape matches core RegistryRecord.
 */
export interface NppesRecord {
  npi: string;
  kind: "individual" | "organization";
  name: string;
  firstName: string | null;
  lastName: string | null;
  credential: string | null;
  /** NPI taxonomy codes, e.g. 111N00000X (chiropractor). */
  taxonomyCodes: string[];
  location: { line1: string; line2: string | null; city: string; state: string; zip: string; phone: string | null } | null;
  /** State licenses listed on the NPI's taxonomies (self-reported to NPPES). */
  licenses?: { number: string; state: string }[];
  /** Organizations: the person who signed for the NPI. */
  authorizedOfficial?: string | null;
}

export interface NppesQuery {
  /** NPPES taxonomy_description, e.g. "Chiropractor". */
  taxonomy: string;
  state: string;
  city: string;
  enumerationType: "NPI-1" | "NPI-2";
  /** NPPES caps limit at 200 and skip at 1000. */
  limit?: number;
  skip?: number;
}

export interface NppesProvider {
  name: string;
  search(q: NppesQuery): Promise<NppesRecord[]>;
  /** One NPI by number (null = not found or deactivated). */
  lookup?(npi: string): Promise<NppesRecord | null>;
  /** Individuals by name in a state (clinic owner license check). */
  findPeople?(q: { firstName: string; lastName: string; state: string }): Promise<NppesRecord[]>;
}

/** Registry failure (unreachable, HTTP error, API error message). */
export class NppesError extends Error {}

type RawAddress = { address_purpose?: string; address_1?: string; address_2?: string; city?: string; state?: string; postal_code?: string; telephone_number?: string };
type RawResult = {
  number?: string | number;
  enumeration_type?: string;
  basic?: {
    organization_name?: string;
    first_name?: string;
    last_name?: string;
    credential?: string;
    status?: string;
    authorized_official_first_name?: string;
    authorized_official_last_name?: string;
  };
  addresses?: RawAddress[];
  taxonomies?: { code?: string; desc?: string; license?: string; state?: string }[];
};

export function mapNppesResult(r: RawResult): NppesRecord | null {
  const npi = String(r.number ?? "");
  if (!/^\d{10}$/.test(npi)) return null;
  if (r.basic?.status && r.basic.status !== "A") return null; // deactivated
  const kind = r.enumeration_type === "NPI-2" ? "organization" : "individual";
  const loc = r.addresses?.find((a) => a.address_purpose === "LOCATION");
  return {
    npi,
    kind,
    name: (r.basic?.organization_name ?? "").trim(),
    firstName: r.basic?.first_name?.trim() || null,
    lastName: r.basic?.last_name?.trim() || null,
    credential: r.basic?.credential?.trim() || null,
    taxonomyCodes: (r.taxonomies ?? []).map((t) => (t.code ?? "").trim()).filter(Boolean),
    licenses: (r.taxonomies ?? []).filter((t) => t.license?.trim() && t.state?.trim()).map((t) => ({ number: t.license!.trim(), state: t.state!.trim().toUpperCase() })),
    authorizedOfficial: [r.basic?.authorized_official_first_name, r.basic?.authorized_official_last_name].filter((x) => x?.trim()).join(" ").trim() || null,
    location: loc?.address_1
      ? { line1: loc.address_1.trim(), line2: loc.address_2?.trim() || null, city: (loc.city ?? "").trim(), state: (loc.state ?? "").trim(), zip: (loc.postal_code ?? "").trim(), phone: loc.telephone_number?.trim() || null }
      : null,
  };
}

async function query(params: Record<string, string>): Promise<NppesRecord[]> {
  const u = new URL(env().NPPES_API_BASE);
  u.searchParams.set("version", "2.1");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  let j: { results?: RawResult[]; Errors?: { description?: string }[] };
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(20_000), headers: { accept: "application/json" } });
    if (!r.ok) throw new NppesError(`NPPES HTTP ${r.status}`);
    j = (await r.json()) as typeof j;
  } catch (e) {
    throw e instanceof NppesError ? e : new NppesError(`NPPES unreachable: ${(e as Error).message}`);
  }
  if (j.Errors?.length) throw new NppesError(`NPPES: ${j.Errors.map((e) => e.description).join("; ")}`.slice(0, 240));
  return (j.results ?? []).map(mapNppesResult).filter((x): x is NppesRecord => !!x);
}

const registry: NppesProvider = {
  name: "nppes",
  async lookup(npi) {
    return (await query({ number: npi }))[0] ?? null;
  },
  async findPeople(q) {
    return query({ first_name: q.firstName, last_name: q.lastName, state: q.state, enumeration_type: "NPI-1", limit: "50" });
  },
  async search(q) {
    const u = new URL(env().NPPES_API_BASE);
    u.searchParams.set("version", "2.1");
    u.searchParams.set("taxonomy_description", q.taxonomy);
    u.searchParams.set("state", q.state);
    u.searchParams.set("city", q.city);
    u.searchParams.set("enumeration_type", q.enumerationType);
    u.searchParams.set("limit", String(Math.min(200, q.limit ?? 200)));
    if (q.skip) u.searchParams.set("skip", String(Math.min(1000, q.skip)));
    let j: { results?: RawResult[]; Errors?: { description?: string }[] };
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(20_000), headers: { accept: "application/json" } });
      if (!r.ok) throw new NppesError(`NPPES HTTP ${r.status}`);
      j = (await r.json()) as typeof j;
    } catch (e) {
      throw e instanceof NppesError ? e : new NppesError(`NPPES unreachable: ${(e as Error).message}`);
    }
    if (j.Errors?.length) throw new NppesError(`NPPES: ${j.Errors.map((e) => e.description).join("; ")}`.slice(0, 240));
    return (j.results ?? []).map(mapNppesResult).filter((x): x is NppesRecord => !!x);
  },
};

/** Under test there is no network: an empty registry unless a test installs one. */
const empty: NppesProvider = { name: "none", search: async () => [], lookup: async () => null, findPeople: async () => [] };

let override: NppesProvider | null = null;
/** Tests: install a fake registry (null restores the default). */
export function setNppesProvider(p: NppesProvider | null) {
  override = p;
}

export function nppesProvider(): NppesProvider {
  if (override) return override;
  return env().NODE_ENV === "test" ? empty : registry;
}
