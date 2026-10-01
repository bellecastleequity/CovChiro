/**
 * Referral program rules (pure). Anyone with an account gets a personal link. When the person
 * they invite completes their first real shift (provider: worked it; clinic: it was worked and
 * paid in full), both sides earn: providers as pay through Stripe, clinics as a credit toward
 * their next shift. Rewards wait a short hold after the shift; anything that looks off is
 * flagged for the owner instead of paid.
 */

export type ReferralStatus = "PENDING" | "FLAGGED" | "REWARDED" | "REJECTED" | "EXPIRED";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** e.g. "Dr. Jane Smith" → SMITH7K2. Letters from the last name (max 8) + 3 random characters. */
export function referralCodeFor(name: string, rand: () => number = Math.random): string {
  const words = name
    .normalize("NFKD")
    .replace(/[^A-Za-z\s-]/g, "")
    .split(/[\s-]+/)
    .filter((w) => w && !/^(dr|mr|mrs|ms|dc|pt|md|do|jr|sr|ii|iii)$/i.test(w));
  const base = (words[words.length - 1] ?? "").toUpperCase().slice(0, 8) || "FRIEND";
  const suffix = Array.from({ length: 3 }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]).join("");
  return `${base}${suffix}`;
}

export function normalizeReferralCode(raw: string | null | undefined): string | null {
  const c = (raw ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length >= 4 && c.length <= 20 ? c : null;
}

/** "Jane Smith" → "Jane S." (what an invitee sees about who invited them). */
export function referrerDisplayName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "A colleague";
  const first = /^(dr\.?)$/i.test(parts[0]) && parts.length > 2 ? `${parts[0]} ${parts[1]}` : parts[0];
  return `${first} ${parts[parts.length - 1][0]}.`;
}

export interface ReferralCheck {
  referrer: { userId: string; phone: string | null; disabled: boolean; suspended: boolean };
  referee: { userId: string; phone: string | null; disabled: boolean; suspended: boolean; flaggedAsSpam: boolean };
  qualifyingShiftDisputed: boolean;
}

/** "reject" = never pays (banned accounts, self-referral); "flag" = owner decides; "ok" = pay automatically. */
export function referralDecision(c: ReferralCheck): { decision: "ok" | "flag" | "reject"; reasons: string[] } {
  if (c.referrer.userId === c.referee.userId) return { decision: "reject", reasons: ["self-referral"] };
  if (c.referrer.disabled) return { decision: "reject", reasons: ["referrer's account is banned"] };
  if (c.referee.disabled) return { decision: "reject", reasons: ["invited account is banned"] };
  const reasons: string[] = [];
  const digits = (p: string | null) => (p ?? "").replace(/\D/g, "").slice(-10);
  if (digits(c.referrer.phone).length === 10 && digits(c.referrer.phone) === digits(c.referee.phone)) reasons.push("same phone number");
  if (c.referrer.suspended) reasons.push("referrer is suspended");
  if (c.referee.suspended) reasons.push("invited account is suspended");
  if (c.referee.flaggedAsSpam) reasons.push("signup was flagged as possible spam");
  if (c.qualifyingShiftDisputed) reasons.push("the first shift had a dispute");
  return { decision: reasons.length ? "flag" : "ok", reasons };
}

/** The first shift counts once the hold after it has passed. */
export function qualifiesAt(shiftEndsAt: Date, holdDays: number): Date {
  return new Date(+shiftEndsAt + Math.max(0, holdDays) * 86_400_000);
}

export const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
