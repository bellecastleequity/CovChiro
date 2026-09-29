import { DomainError } from "./errors";

/**
 * Clinic promo codes. Carried over from the current site's promo system
 * (library codes, campaign landing pages with per-person codes, welcome
 * codes) and adapted to the marketplace rule that provider pay is fixed:
 * a discount only ever comes out of the platform margin (clinic price −
 * provider pay), is capped at a settable share of it, and never touches
 * pass-through mileage or lodging.
 */

export type PromoKind = "PERCENT" | "FIXED";

export interface PromoFacts {
  code: string;
  kind: PromoKind;
  /** Percent (0–100) for PERCENT, cents for FIXED. */
  value: number;
  active: boolean;
  startsAt: Date | null;
  expiresAt: Date | null;
  maxUses: number | null;
  usedCount: number;
  maxUsesPerClinic: number | null;
  firstShiftOnly: boolean;
  /** Personal codes are bound to one email address. */
  assignedEmail: string | null;
  /** A library code whose landing page is on can't be redeemed directly — only its personal copies can. */
  landingEnabled: boolean;
  isPersonalCopy: boolean;
}

export interface PromoContext {
  now: Date;
  /** Emails of the clinic org's members; a bound code must match one. */
  clinicEmails: string[];
  /** Shifts this clinic has had confirmed before (any status after confirmation). */
  clinicPriorConfirmedShifts: number;
  /** Times this clinic already redeemed this code. */
  clinicUsesOfCode: number;
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

export function promoRejection(p: PromoFacts, ctx: PromoContext): string | null {
  if (!p.active) return "This code is no longer active.";
  if (p.startsAt && ctx.now < p.startsAt) return "This code isn't active yet.";
  if (p.expiresAt && ctx.now >= p.expiresAt) return "This code has expired.";
  if (p.landingEnabled && !p.isPersonalCopy) return "Claim this offer from its landing page to get your personal code.";
  if (p.maxUses !== null && p.usedCount >= p.maxUses) return "This code has been fully redeemed.";
  if (p.maxUsesPerClinic !== null && ctx.clinicUsesOfCode >= p.maxUsesPerClinic) return "You've already used this code.";
  if (p.firstShiftOnly && ctx.clinicPriorConfirmedShifts > 0) return "This code is for a clinic's first coverage shift only.";
  if (p.assignedEmail) {
    const bound = p.assignedEmail.trim().toLowerCase();
    if (!ctx.clinicEmails.some((e) => e.trim().toLowerCase() === bound)) return "This code is linked to a different email address.";
  }
  return null;
}

export function assertPromoUsable(p: PromoFacts, ctx: PromoContext): void {
  const why = promoRejection(p, ctx);
  if (why) throw new DomainError("PROMO_INVALID", why);
}

/**
 * Discount on the coverage price only. Capped at `maxShareOfMarginPercent`
 * of the margin so provider pay is never subsidised by a promo.
 */
export function promoDiscountCents(
  p: Pick<PromoFacts, "kind" | "value">,
  quote: { clinicPriceCents: number; providerPayCents: number },
  maxShareOfMarginPercent: number,
): number {
  const margin = Math.max(0, quote.clinicPriceCents - quote.providerPayCents);
  const cap = Math.floor((margin * maxShareOfMarginPercent) / 100);
  const raw = p.kind === "PERCENT" ? Math.round((quote.clinicPriceCents * Math.min(100, Math.max(0, p.value))) / 100) : Math.max(0, Math.round(p.value));
  return Math.min(raw, cap);
}

export function promoLabel(p: Pick<PromoFacts, "kind" | "value">): string {
  return p.kind === "PERCENT" ? `${p.value}% off` : `$${(p.value / 100).toFixed(p.value % 100 ? 2 : 0)} off`;
}

/** Personal code for a campaign signup, e.g. SPRING-7F3A. */
export function personalCode(prefix: string, rand: () => number = Math.random): string {
  const clean = normalizeCode(prefix).replace(/[^A-Z0-9]/g, "").slice(0, 30) || "OFFER";
  const suffix = Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(rand() * 32)]).join("");
  return `${clean}-${suffix}`;
}
