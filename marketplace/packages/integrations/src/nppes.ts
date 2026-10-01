import { env } from "@cm/config";

/**
 * Clinic discovery source: the public NPPES NPI registry (CMS). Free, no key,
 * and it lists every chiropractor and chiropractic practice with its practice
 * location, so we know where the offices are and how many DCs work at each.
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
  isChiropractic: boolean;
  location: { line1: string; line2: string | null; city: string; state: string; zip: string; phone: string | null } | null;
}

export interface NppesQuery {
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
}

/** Registry failure (unreachable, HTTP error, API error message). */
export class NppesError extends Error {}

type RawAddress = { address_purpose?: string; address_1?: string; address_2?: string; city?: string; state?: string; postal_code?: string; telephone_number?: string };
type RawResult = {
  number?: string | number;
  enumeration_type?: string;
  basic?: { organization_name?: string; first_name?: string; last_name?: string; credential?: string; status?: string };
  addresses?: RawAddress[];
  taxonomies?: { code?: string; desc?: string }[];
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
    isChiropractic: (r.taxonomies ?? []).some((t) => (t.code ?? "").startsWith("111N") || /chiropract/i.test(t.desc ?? "")),
    location: loc?.address_1
      ? { line1: loc.address_1.trim(), line2: loc.address_2?.trim() || null, city: (loc.city ?? "").trim(), state: (loc.state ?? "").trim(), zip: (loc.postal_code ?? "").trim(), phone: loc.telephone_number?.trim() || null }
      : null,
  };
}

const registry: NppesProvider = {
  name: "nppes",
  async search(q) {
    const u = new URL(env().NPPES_API_BASE);
    u.searchParams.set("version", "2.1");
    u.searchParams.set("taxonomy_description", "Chiropractor");
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
const empty: NppesProvider = { name: "none", search: async () => [] };

let override: NppesProvider | null = null;
/** Tests: install a fake registry (null restores the default). */
export function setNppesProvider(p: NppesProvider | null) {
  override = p;
}

export function nppesProvider(): NppesProvider {
  if (override) return override;
  return env().NODE_ENV === "test" ? empty : registry;
}
