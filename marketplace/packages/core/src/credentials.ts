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
};

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
