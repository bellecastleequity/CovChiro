/**
 * State license checks against a state's own license data (e.g. Florida's daily pipe-delimited
 * "Licensure Data Download"). Pure: the file text and our license numbers in, one finding per
 * license out. The file layout isn't fixed, so columns are found by header name when there is a
 * header, and otherwise the license number is matched against ours and the status is read from
 * whichever field holds a recognisable license status.
 */

export type BoardVerdict = "ACTIVE" | "REVIEW" | "INACTIVE";

const BAD = /(INACTIVE|DELINQUENT|SUSPEN|REVOK|VOID|RETIRED|DECEASED|RELINQUISH|SURRENDER|EXPIRED|CANCEL|DENIED|LAPSED)/;
const CAUTION = /(PROBATION|OBLIGATION|RESTRICT|CONDITION|LIMIT|STIPULAT)/;

/** What a state license status means for us: keep, look at it, or stop matching. */
export function classifyBoardStatus(status: string): BoardVerdict {
  const s = status.toUpperCase();
  if (BAD.test(s)) return "INACTIVE";
  if (CAUTION.test(s)) return "REVIEW";
  if (/\b(ACTIVE|CLEAR|CURRENT)\b/.test(s)) return "ACTIVE";
  return "REVIEW";
}

export const normalizeLicenseNumber = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const digits = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "");

const STATUS_WORDS = /(ACTIVE|CLEAR|INACTIVE|DELINQUENT|SUSPEN|REVOK|VOID|RETIRED|DECEASED|PROBATION|OBLIGATION|RELINQUISH|SURRENDER|EXPIRED)/i;

export interface BoardRow {
  status: string;
  /** A discipline / proceedings / obligations flag was set (null = the file doesn't say). */
  discipline: boolean | null;
  expires: string | null;
}

/**
 * Finds each of `ours` (license numbers as providers entered them) in the file. Returns the
 * matches keyed by our original number; numbers not in the file are simply absent.
 */
export function parseBoardFile(text: string, ours: string[]): Map<string, BoardRow> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const out = new Map<string, BoardRow>();
  if (!lines.length) return out;
  const byFull = new Map<string, string>();
  const byDigits = new Map<string, string>();
  for (const o of ours) {
    byFull.set(normalizeLicenseNumber(o), o);
    const d = digits(o);
    if (d.length >= 4) byDigits.set(d, o);
  }
  const first = lines[0].split("|").map((f) => f.trim());
  const isHeader = first.some((f) => /[A-Z]{3,}/i.test(f) && /(LIC|STATUS|NAME|PROF|NUMBER|EXP)/i.test(f)) && !first.some((f) => byFull.has(normalizeLicenseNumber(f)));
  const col = (re: RegExp) => (isHeader ? first.findIndex((h) => re.test(h)) : -1);
  const numberCol = col(/^(LIC(ENSE)?[\s_]*(NO|NBR|NUM|NUMBER|#)|LICENSE)$/i);
  const statusCol = (() => {
    const exact = col(/^(LIC(ENSE)?[\s_]*)?STATUS([\s_]*(DESC(RIPTION)?|NAME))?$/i);
    return exact >= 0 ? exact : col(/STATUS/i);
  })();
  const disciplineCol = col(/(DISCIP|PROCEED|OBLIG|BOARD[\s_]*ACTION|PUBLIC[\s_]*COMPLAINT)/i);
  const expiresCol = col(/EXP/i);
  for (const line of lines.slice(isHeader ? 1 : 0)) {
    const f = line.split("|").map((x) => x.trim());
    let mine: string | undefined;
    const tryField = (v: string | undefined) => {
      if (!v || mine) return;
      mine = byFull.get(normalizeLicenseNumber(v)) ?? (digits(v).length >= 4 ? byDigits.get(digits(v)) : undefined);
    };
    if (numberCol >= 0) tryField(f[numberCol]);
    else for (const v of f) tryField(v);
    if (!mine) continue;
    const status = statusCol >= 0 ? (f[statusCol] ?? "") : (f.find((v) => STATUS_WORDS.test(v) && v.length <= 40) ?? "");
    const d = disciplineCol >= 0 ? (f[disciplineCol] ?? "").toUpperCase() : null;
    out.set(mine, {
      status,
      discipline: d === null ? null : d !== "" && !/^(N|NO|FALSE|0|NONE)$/.test(d),
      expires: expiresCol >= 0 ? f[expiresCol] || null : null,
    });
  }
  return out;
}
