import { defaultSettings } from "@cm/config";
import type { DoctorFacts, EligibilityOptions, PairFacts, ShiftFacts } from "../src";

export const S = defaultSettings();
export const OPTS: EligibilityOptions = {
  minMalpracticePerOccurrenceCents: S["credentials.minMalpracticePerOccurrenceCents"],
  minMalpracticeAggregateCents: S["credentials.minMalpracticeAggregateCents"],
  travelBufferExtraMinutes: S["matching.travelBufferExtraMinutes"],
};

export const d = (s: string) => new Date(s);

// Wed 2026-10-14, 9am–5pm Eastern
export function shift(over: Partial<ShiftFacts> = {}): ShiftFacts {
  return {
    id: "shift1",
    state: "FL",
    startsAt: d("2026-10-14T13:00:00Z"),
    endsAt: d("2026-10-14T21:00:00Z"),
    requiredTechniqueIds: [],
    lodgingAllowed: false,
    maxTravelBudgetCents: null,
    ...over,
  };
}

export function doctor(over: Partial<DoctorFacts> = {}): DoctorFacts {
  return {
    id: "doc1",
    status: "ACTIVE",
    profileComplete: true,
    payoutsEnabled: true,
    licenses: [{ state: "FL", status: "VERIFIED", expiresAt: d("2028-01-31T00:00:00Z") }],
    malpractice: [{ status: "VERIFIED", expiresAt: d("2027-06-01T00:00:00Z"), perOccurrenceCents: 100_000_000, aggregateCents: 300_000_000 }],
    techniqueIds: ["diversified", "activator"],
    maxDriveMinutes: 90,
    willingOvernight: false,
    availabilityRules: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMin: 5 * 60, endMin: 22 * 60, timeZone: "America/New_York" })),
    openDates: [],
    blackouts: [],
    busy: [],
    ...over,
  };
}

export function pair(over: Partial<PairFacts> = {}): PairFacts {
  return { driveMinutes: 30, travelEstimateCents: 500, blocked: false, previouslyDeclined: false, ...over };
}
