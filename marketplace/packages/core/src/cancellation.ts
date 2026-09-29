import type { SettingsMap } from "@cm/config";
import { HOUR } from "./time";

/** Cancellation matrix (SPEC §9.3). Returns what happens to money and reliability stats. */

export type CancelParty = "CLINIC" | "PROVIDER" | "PLATFORM";

export interface CancellationOutcome {
  /** Refund to clinic of what they've paid so far (deposit). */
  refundDepositCents: number;
  /** Deposit kept by the platform. */
  forfeitedDepositCents: number;
  /** Portion of the forfeited deposit paid to the provider. */
  providerCompensationCents: number;
  countsAsLateCancel: boolean;
  countsAsNoShow: boolean;
  backfill: boolean;
}

type CancelSettings = Pick<
  SettingsMap,
  "payments.clinicFreeCancelHours" | "payments.lateCancelProviderSharePercent" | "payments.providerLateCancelHours"
>;

export function cancellationOutcome(
  input: { by: CancelParty; noShow?: boolean; now: Date; startsAt: Date; depositPaidCents: number },
  s: CancelSettings,
): CancellationOutcome {
  const hoursToStart = (+input.startsAt - +input.now) / HOUR;
  const base: CancellationOutcome = {
    refundDepositCents: input.depositPaidCents,
    forfeitedDepositCents: 0,
    providerCompensationCents: 0,
    countsAsLateCancel: false,
    countsAsNoShow: false,
    backfill: false,
  };
  switch (input.by) {
    case "CLINIC":
      if (hoursToStart >= s["payments.clinicFreeCancelHours"]) return base;
      return {
        ...base,
        refundDepositCents: 0,
        forfeitedDepositCents: input.depositPaidCents,
        providerCompensationCents: Math.round((input.depositPaidCents * s["payments.lateCancelProviderSharePercent"]) / 100),
      };
    case "PROVIDER":
      if (input.noShow) return { ...base, countsAsNoShow: true, backfill: true };
      return { ...base, countsAsLateCancel: hoursToStart < s["payments.providerLateCancelHours"], backfill: true };
    case "PLATFORM":
      return { ...base, backfill: true };
  }
}
