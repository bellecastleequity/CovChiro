/** US federal holidays (actual and observed dates), as ISO yyyy-mm-dd strings. */

function iso(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function nthWeekday(y: number, m: number, weekday: number, n: number): number {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

function lastWeekday(y: number, m: number, weekday: number): number {
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lastDow = new Date(Date.UTC(y, m - 1, daysInMonth)).getUTCDay();
  return daysInMonth - ((lastDow - weekday + 7) % 7);
}

function observed(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  if (dow === 6) dt.setUTCDate(d - 1);
  else if (dow === 0) dt.setUTCDate(d + 1);
  return dt.toISOString().slice(0, 10);
}

export function federalHolidays(year: number): Set<string> {
  const out = new Set<string>();
  const fixed: [number, number][] = [
    [1, 1],
    [6, 19],
    [7, 4],
    [11, 11],
    [12, 25],
  ];
  for (const [m, d] of fixed) {
    out.add(iso(year, m, d));
    out.add(observed(year, m, d));
  }
  out.add(iso(year, 1, nthWeekday(year, 1, 1, 3))); // MLK
  out.add(iso(year, 2, nthWeekday(year, 2, 1, 3))); // Presidents
  out.add(iso(year, 5, lastWeekday(year, 5, 1))); // Memorial
  out.add(iso(year, 9, nthWeekday(year, 9, 1, 1))); // Labor
  out.add(iso(year, 10, nthWeekday(year, 10, 1, 2))); // Columbus / Indigenous Peoples'
  out.add(iso(year, 11, nthWeekday(year, 11, 4, 4))); // Thanksgiving
  // Next year's Jan 1 can be observed on Dec 31 of this year.
  const nextNewYear = observed(year + 1, 1, 1);
  if (nextNewYear.startsWith(String(year))) out.add(nextNewYear);
  return out;
}

export function isFederalHoliday(isoDate: string): boolean {
  return federalHolidays(Number(isoDate.slice(0, 4))).has(isoDate);
}
