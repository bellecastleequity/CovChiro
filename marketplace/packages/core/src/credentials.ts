import { DAY } from "./time";

/** nextReverifyAt = earlier of (expiration − 30 days) or (verification + 90 days). SPEC §4.3. */
export function nextReverifyAt(verifiedAt: Date, expiresAt: Date): Date {
  return new Date(Math.min(+expiresAt - 30 * DAY, +verifiedAt + 90 * DAY));
}

/**
 * Days until expiry when that day is one of the reminder points (setting
 * credentials.expiryReminderDays, e.g. 60/30/14/7), else null. Run daily.
 */
export function expiryReminderDue(expiresAt: Date, now: Date, days: readonly number[] = [60, 30, 7]): number | null {
  const left = Math.ceil((+expiresAt - +now) / DAY);
  return days.includes(left) ? left : null;
}

export const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  // U.S. territories: U.S. dollars, ZIP codes and the NPI registry, each with its own chiropractic board.
  PR: "Puerto Rico", VI: "U.S. Virgin Islands",
};

/**
 * Canadian provinces and territories: waitlist only for now (no shifts, sign-up or payments there).
 * Their two-letter codes never collide with U.S. ones, so a waitlist lead keeps them in Lead.state.
 */
export const CA_PROVINCES: Record<string, string> = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador",
  NS: "Nova Scotia", NT: "Northwest Territories", NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island",
  QC: "Quebec", SK: "Saskatchewan", YT: "Yukon",
};

/** A state, territory or Canadian province code → its name ("Ontario, Canada"). */
export function regionName(code: string | null | undefined): string {
  if (!code) return "";
  if (US_STATES[code]) return US_STATES[code];
  if (CA_PROVINCES[code]) return `${CA_PROVINCES[code]}, Canada`;
  return code;
}

/**
 * License.state for a national registry credential (e.g. ARDMS, CCI, ARRT),
 * accepted only where the state doesn't license the profession and the
 * admin has turned national credentials on (ProfessionStateConfig).
 */
export const NATIONAL_CREDENTIAL = "US";

/** "Florida", or "National registry" for a national credential. */
export function credentialPlace(state: string): string {
  return state === NATIONAL_CREDENTIAL ? "National registry" : (US_STATES[state] ?? state);
}
