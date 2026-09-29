import { env } from "@cm/config";

/** NPI validation against the public NPPES registry (SPEC §4.1): number exists and the name matches. */
export interface NpiResult {
  found: boolean;
  nameMatches: boolean;
  registryName?: string;
}

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

export function luhnNpiValid(npi: string): boolean {
  if (!/^\d{10}$/.test(npi)) return false;
  const digits = ("80840" + npi).split("").map(Number);
  let sum = 0;
  for (let i = digits.length - 1, alt = false; i >= 0; i--, alt = !alt) {
    let d = digits[i];
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export async function lookupNpi(npi: string, first: string, last: string): Promise<NpiResult> {
  if (!luhnNpiValid(npi)) return { found: false, nameMatches: false };
  if (env().NODE_ENV === "test") return { found: true, nameMatches: true, registryName: `${first} ${last}` };
  try {
    const u = new URL(env().NPPES_API_BASE);
    u.searchParams.set("version", "2.1");
    u.searchParams.set("number", npi);
    const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
    const j = (await r.json()) as any;
    const basic = j?.results?.[0]?.basic;
    if (!basic) return { found: false, nameMatches: false };
    const registryName = `${basic.first_name ?? ""} ${basic.last_name ?? ""}`.trim();
    return { found: true, nameMatches: norm(basic.last_name ?? "") === norm(last) && norm(basic.first_name ?? "").startsWith(norm(first).slice(0, 3)), registryName };
  } catch {
    // Registry unreachable: treat as unverified; admin resolves in the verification queue.
    return { found: false, nameMatches: false };
  }
}
