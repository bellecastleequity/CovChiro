export function money(cents: number | null | undefined, opts: { exact?: boolean } = {}): string {
  if (cents === null || cents === undefined) return "—";
  const v = cents / 100;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: opts.exact || cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
}

export function dateLabel(d: Date | string, tz = "America/New_York", opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }) {
  return new Date(d).toLocaleDateString("en-US", { timeZone: tz, ...opts });
}

export function timeLabel(d: Date | string, tz = "America/New_York") {
  return new Date(d).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
}

export function timeRange(start: Date | string, end: Date | string, tz = "America/New_York") {
  return `${timeLabel(start, tz)} – ${timeLabel(end, tz)}`;
}

export function dateTimeLabel(d: Date | string | null | undefined, tz = "America/New_York") {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function relative(d: Date | string) {
  const diff = +new Date(d) - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  return rtf.format(Math.round(diff / 86_400_000), "day");
}

export function pct(n: number | null | undefined) {
  return n === null || n === undefined ? "—" : `${Math.round(n * 100)}%`;
}

export const STATUS_TONE: Record<string, "gray" | "green" | "amber" | "red" | "blue" | "brand"> = {
  DRAFT: "gray",
  OPEN: "blue",
  FAVORITES_ONLY: "blue",
  SELECTING: "amber",
  CASCADING: "amber",
  CONFIRMED: "green",
  IN_PROGRESS: "brand",
  COMPLETED: "gray",
  UNFILLED: "red",
  CANCELLED: "gray",
  VERIFIED: "green",
  PENDING_VERIFICATION: "amber",
  EXPIRED: "red",
  SUSPENDED: "red",
  REVOKED: "red",
  REJECTED: "red",
  ACTIVE: "green",
  ONBOARDING: "amber",
  PAUSED: "gray",
  PENDING: "gray",
  SCHEDULED: "blue",
  ON_HOLD: "amber",
  PROCESSING: "blue",
  PAID: "green",
  FAILED: "red",
  SUCCEEDED: "green",
  NEW: "blue",
  NURTURING: "brand",
  CONTACTED: "blue",
  CONVERTED: "green",
  UNSUBSCRIBED: "gray",
  SUPERSEDED: "gray",
  LOST: "gray",
  LICENSE_LAPSED: "red",
  NO_SHOW: "red",
  DISPUTED: "amber",
  // growth
  SENT: "green",
  APPROVED: "green",
  BLOCKED: "red",
  PENDING_APPROVAL: "amber",
  QUEUED: "blue",
  RUNNING: "blue",
  DONE: "green",
  NOT_FOUND: "gray",
  SKIPPED: "gray",
  RECEIVED: "blue",
  LOGGED: "gray",
  RESOLVED: "gray",
  PROSPECT: "gray",
  CONTACTABLE: "gray",
  OUTREACH_STARTED: "blue",
  ENGAGED: "amber",
  INTERESTED: "amber",
  ACCOUNT_CREATED: "brand",
  COVERAGE_REQUESTED: "amber",
  FIRST_SHIFT_BOOKED: "green",
  FIRST_SHIFT_COMPLETED: "green",
  REPEAT_CLINIC: "green",
  DORMANT: "gray",
  NOT_INTERESTED: "gray",
  DO_NOT_CONTACT: "red",
};

export function humanize(s: string) {
  return s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

/** First name for greetings, skipping honorifics: "Dr. Jane Rivera" → "Jane". */
export function firstName(name: string): string {
  const parts = name.trim().split(/\s+/);
  const rest = parts.filter((p) => !/^(dr|mr|mrs|ms|mx|prof)\.?$/i.test(p));
  return rest[0] ?? parts[0] ?? "";
}

/** +14075550142 → (407) 555-0142 (other formats unchanged). */
export const phoneLabel = (p: string | null | undefined) => (p ?? "").replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3");
