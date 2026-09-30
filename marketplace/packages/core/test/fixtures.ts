import { defaultSettings } from "@cm/config";
import type { EligibilityOptions, PairFacts, ProfessionStateFacts, ProviderFacts, ShiftFacts } from "../src";

export const S = defaultSettings();
export const OPTS: EligibilityOptions = { travelBufferExtraMinutes: S["matching.travelBufferExtraMinutes"] };

export const d = (s: string) => new Date(s);
export const FAR = d("2030-01-01");

export function config(over: Partial<ProfessionStateFacts> = {}): ProfessionStateFacts {
  return {
    enabled: true,
    stateEnabled: true,
    nationalCredentialAccepted: false,
    supervisionRequired: false,
    supervisingProfessionCodes: [],
    malpracticeMinOccurrenceCents: 100_000_000,
    malpracticeMinAggregateCents: 300_000_000,
    ...over,
  };
}

// Wed 2026-10-14, 9am–5pm Eastern
export function shift(over: Partial<ShiftFacts> = {}): ShiftFacts {
  return {
    id: "shift1",
    professionCode: "DC",
    state: "FL",
    startsAt: d("2026-10-14T13:00:00Z"),
    endsAt: d("2026-10-14T21:00:00Z"),
    requiredSkillIds: [],
    lodgingAllowed: false,
    maxTravelBudgetCents: null,
    supervisionAttestation: null,
    config: config(),
    skills: [],
    ...over,
  };
}

export const lic = (professionCode: string, state: string, status: ProviderFacts["licenses"][number]["status"] = "VERIFIED", expiresAt = FAR) => ({
  professionCode,
  state,
  status,
  expiresAt,
});

export const policy = (codes: string[], over: Partial<ProviderFacts["malpractice"][number]> = {}) => ({
  status: "VERIFIED" as const,
  expiresAt: d("2027-06-01T00:00:00Z"),
  perOccurrenceCents: 100_000_000,
  aggregateCents: 300_000_000,
  coveredProfessionCodes: codes,
  ...over,
});

export function provider(over: Partial<ProviderFacts> = {}): ProviderFacts {
  return {
    id: "prov1",
    status: "ACTIVE",
    professions: [{ professionCode: "DC", status: "ACTIVE" }],
    payoutsEnabled: true,
    licenses: [lic("DC", "FL", "VERIFIED", d("2028-01-31T00:00:00Z"))],
    malpractice: [policy(["DC"])],
    skills: [
      { skillId: "diversified", certificationStatus: null, certificationExpiresAt: null },
      { skillId: "activator", certificationStatus: null, certificationExpiresAt: null },
    ],
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
