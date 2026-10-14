/**
 * Federal healthcare exclusion lists (owner decision Oct 2026): HHS-OIG's LEIE
 * (oig.hhs.gov/exclusions, UPDATED.csv, refreshed monthly) and the SAM.gov public exclusions
 * extract. A clinic that bills Medicare or Medicaid can be fined for using an excluded provider.
 *
 * Matching (no date of birth on our side):
 *  - the provider's NPI is on the list → EXCLUDED (strong);
 *  - same first + last name and the listing is in one of their license/home states, or names
 *    their profession (LEIE specialty) → POSSIBLE_MATCH, for a person to compare (Stripe's ID
 *    check shows the date of birth); a name match elsewhere is ignored (common names).
 * A listing an admin marked "not the same person" is remembered by its key and never re-flagged.
 */

export type ExclusionSource = "LEIE" | "SAM";
export type ExclusionResult = "CLEAR" | "POSSIBLE_MATCH" | "EXCLUDED";

export interface ExclusionRow {
  source: ExclusionSource;
  lastName: string;
  firstName: string;
  middleName: string;
  businessName: string;
  npi: string | null;
  state: string | null;
  /** LEIE GENERAL + SPECIALTY, e.g. "IND- LIC HC SERV PRO / CHIROPRACTOR". */
  specialty: string;
  exclType: string;
  /** YYYY-MM-DD when known. */
  exclDate: string | null;
}

/** Minimal CSV reader: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function csvRows(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x.trim())) out.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim())) out.push(row);
  return out;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "");

/** "smith|john": the key both sides are matched on. */
export function exclusionNameKey(first: string, last: string): string {
  return `${norm(last)}|${norm(first)}`;
}

/** First and last name from a legal name ("Dr. Jane A. Smith-Lee, DC" → jane / smithlee). */
export function legalNameParts(legalName: string): { first: string; last: string } | null {
  const drop = new Set(["dr", "doctor", "dc", "md", "do", "jr", "sr", "ii", "iii", "iv", "mr", "mrs", "ms", "phd"]);
  const t = legalName.toLowerCase().replace(/[.,'’]/g, "").split(/\s+/).filter((x) => x && !drop.has(x));
  return t.length >= 2 ? { first: t[0], last: t[t.length - 1] } : null;
}

const validNpi = (s: string | undefined | null) => {
  const d = (s ?? "").replace(/\D/g, "");
  return d.length === 10 && !/^0+$/.test(d) ? d : null;
};

/** "20130722" / "07/22/2013" / "2013-07-22" → "2013-07-22". */
function isoDate(s: string | undefined): string | null {
  const v = (s ?? "").trim();
  let m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return m[1] === "0000" ? null : `${m[1]}-${m[2]}-${m[3]}`;
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Reads an LEIE (UPDATED.csv) or SAM.gov public exclusions extract (CSV, V2 layout), found by
 * the header. Keeps only listings in force: LEIE rows without a reinstatement date; SAM rows
 * that are Active and not terminated before `today`.
 */
export function parseExclusionFile(text: string, today = new Date()): { source: ExclusionSource; rows: ExclusionRow[]; skipped: number } {
  const all = csvRows(text.replace(/^﻿/, ""));
  if (!all.length) throw new Error("The file is empty.");
  const head = all[0].map((h) => h.trim().toUpperCase());
  const col = (...names: string[]) => names.map((n) => head.indexOf(n)).find((i) => i >= 0) ?? -1;
  const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const rows: ExclusionRow[] = [];
  let skipped = 0;
  if (head.includes("LASTNAME") && head.includes("EXCLTYPE")) {
    const c = { last: col("LASTNAME"), first: col("FIRSTNAME"), mid: col("MIDNAME"), bus: col("BUSNAME"), gen: col("GENERAL"), spec: col("SPECIALTY"), npi: col("NPI"), state: col("STATE"), type: col("EXCLTYPE"), date: col("EXCLDATE"), rein: col("REINDATE") };
    for (const r of all.slice(1)) {
      if (isoDate(at(r, c.rein))) { skipped++; continue; }
      const last = at(r, c.last), first = at(r, c.first), npi = validNpi(at(r, c.npi));
      if (!(last && first) && !npi) { skipped++; continue; }
      rows.push({ source: "LEIE", lastName: last, firstName: first, middleName: at(r, c.mid), businessName: at(r, c.bus), npi, state: at(r, c.state).toUpperCase() || null, specialty: [at(r, c.gen), at(r, c.spec)].filter(Boolean).join(" / "), exclType: at(r, c.type), exclDate: isoDate(at(r, c.date)) });
    }
    return { source: "LEIE", rows, skipped };
  }
  if (head.includes("EXCLUSION TYPE") || head.includes("EXCLUSION PROGRAM")) {
    const c = { cls: col("CLASSIFICATION"), name: col("NAME"), first: col("FIRST"), mid: col("MIDDLE"), last: col("LAST"), state: col("STATE / PROVINCE", "STATE"), npi: col("NPI"), type: col("EXCLUSION TYPE"), active: col("ACTIVE DATE"), term: col("TERMINATION DATE"), status: col("RECORD STATUS"), prog: col("EXCLUSION PROGRAM") };
    const todayIso = today.toISOString().slice(0, 10);
    for (const r of all.slice(1)) {
      const status = at(r, c.status);
      const term = isoDate(at(r, c.term));
      if ((status && !/^active$/i.test(status)) || (term && term < todayIso)) { skipped++; continue; }
      const last = at(r, c.last), first = at(r, c.first), npi = validNpi(at(r, c.npi));
      if (!(last && first) && !npi) { skipped++; continue; }
      rows.push({ source: "SAM", lastName: last, firstName: first, middleName: at(r, c.mid), businessName: last && first ? "" : at(r, c.name), npi, state: at(r, c.state).toUpperCase() || null, specialty: at(r, c.cls), exclType: [at(r, c.type), at(r, c.prog)].filter(Boolean).join(" / "), exclDate: isoDate(at(r, c.active)) });
    }
    return { source: "SAM", rows, skipped };
  }
  throw new Error("This doesn't look like the OIG exclusion list (UPDATED.csv) or a SAM.gov exclusions extract.");
}

/** Stable key of one listing, kept when an admin marks it "not the same person". */
export function exclusionRowKey(r: Pick<ExclusionRow, "source" | "npi" | "lastName" | "firstName" | "state" | "exclDate">): string {
  return [r.source, r.npi ?? "", norm(r.lastName), norm(r.firstName), r.state ?? "", r.exclDate ?? ""].join(":");
}

export interface ExclusionSubject {
  npi: string | null;
  legalName: string;
  /** License states and home state. */
  states: string[];
  /** Words that name their profession in a listing's specialty, e.g. ["CHIRO"]. */
  professionWords: string[];
  /** Listing keys an admin said are someone else. */
  clearedKeys: string[];
}

/** Check one provider against the listings that share their NPI or name key. */
export function matchExclusion(p: ExclusionSubject, candidates: ExclusionRow[]): { result: ExclusionResult; row: ExclusionRow | null; reason: string | null } {
  const cleared = new Set(p.clearedKeys);
  const live = candidates.filter((r) => !cleared.has(exclusionRowKey(r)));
  const npi = validNpi(p.npi);
  const byNpi = npi ? live.find((r) => r.npi === npi) : undefined;
  if (byNpi) return { result: "EXCLUDED", row: byNpi, reason: `NPI ${npi} is on the ${byNpi.source === "LEIE" ? "OIG exclusion list" : "SAM.gov exclusion list"}${byNpi.exclDate ? ` (excluded ${byNpi.exclDate})` : ""}.` };
  const parts = legalNameParts(p.legalName);
  if (!parts) return { result: "CLEAR", row: null, reason: null };
  const key = exclusionNameKey(parts.first, parts.last);
  const states = new Set(p.states.map((s) => s.toUpperCase()));
  const words = p.professionWords.map((w) => w.toUpperCase());
  const byName = live.find((r) => exclusionNameKey(r.firstName, r.lastName) === key && ((r.state && states.has(r.state)) || words.some((w) => r.specialty.toUpperCase().includes(w))));
  if (byName) {
    const where = byName.state ? ` in ${byName.state}` : "";
    return { result: "POSSIBLE_MATCH", row: byName, reason: `${byName.firstName} ${byName.lastName}${where} is on the ${byName.source === "LEIE" ? "OIG" : "SAM.gov"} exclusion list${byName.specialty ? ` (${byName.specialty})` : ""}. Same name; check it's the same person.` };
  }
  return { result: "CLEAR", row: null, reason: null };
}
