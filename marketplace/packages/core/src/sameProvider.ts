import { HOUR } from "./time";

/**
 * "Same provider for all days" bookings (owner decision Oct 2026): a multi-day booking the clinic
 * wants covered by one provider. Until it's split, providers apply for every open day together, the
 * clinic confirms one provider for all of them, and Smart Dispatch doesn't offer single days. At the
 * decision deadline: confirm the best provider who applied for every day; otherwise ask the clinic to
 * split it, and split it automatically after a wait (or at once when the first day is close).
 */

export type GroupDeadlineAction = "confirm" | "ask" | "wait" | "split";

export function groupDeadlineAction(input: {
  now: Date;
  firstStartsAt: Date;
  /** Someone eligible applied for every open day. */
  hasFullApplicant: boolean;
  askedAt: Date | null;
  /** bookings.splitWaitHours: how long the clinic has to answer before it's split for them. */
  waitHours: number;
  /** bookings.splitNowWithinHours: first day this close → split straight away, no question. */
  splitNowWithinHours: number;
}): GroupDeadlineAction {
  if (input.hasFullApplicant) return "confirm";
  if (+input.firstStartsAt - +input.now <= input.splitNowWithinHours * HOUR) return "split";
  if (!input.askedAt) return "ask";
  return +input.now - +input.askedAt >= input.waitHours * HOUR ? "split" : "wait";
}
