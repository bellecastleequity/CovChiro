import type { SettingsMap } from "@cm/config";
import { HOUR } from "./time";

/** Cancellation matrix (SPEC §9.3). Returns what happens to money and reliability stats. */

export type CancelParty = "CLINIC" | "DOCTOR" | "PLATFORM";

export interface CancellationOutcome {
  /** Refund to clinic of what they've paid so far (deposit). */
  refundDepositCents: number;
  /** Deposit kept by the platform. */
  forfeitedDepositCents: number;
  /** Portion of the forfeited deposit paid to the doctor. */
  doctorCompensationCents: number;
  countsAsLateCancel: boolean;
  countsAsNoShow: boolean;
  backfill: boolean;
}

type CancelSettings = Pick<
  SettingsMap,
  "payments.clinicFreeCancelHours" | "payments.lateCancelDoctorSharePercent" | "payments.doctorLateCancelHours"
>;

export function cancellationOutcome(
  input: { by: CancelParty; noShow?: boolean; now: Date; startsAt: Date; depositPaidCents: number },
  s: CancelSettings,
): CancellationOutcome {
  const hoursToStart = (+input.startsAt - +input.now) / HOUR;
  const base: CancellationOutcome = {
    refundDepositCents: input.depositPaidCents,
    forfeitedDepositCents: 0,
    doctorCompensationCents: 0,
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
        doctorCompensationCents: Math.round((input.depositPaidCents * s["payments.lateCancelDoctorSharePercent"]) / 100),
      };
    case "DOCTOR":
      if (input.noShow) return { ...base, countsAsNoShow: true, backfill: true };
      return { ...base, countsAsLateCancel: hoursToStart < s["payments.doctorLateCancelHours"], backfill: true };
    case "PLATFORM":
      return { ...base, backfill: true };
  }
}
