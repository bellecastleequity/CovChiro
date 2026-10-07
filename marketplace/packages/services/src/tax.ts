import { form1099Summary, taxInfoStatus } from "@cm/core";
import { prisma } from "@cm/db";
import { paymentsProvider } from "@cm/integrations";
import { getSettings, requireAdmin, type Actor } from "./context";

/**
 * 1099 review (Admin → Payments → 1099 report). Stripe holds the W-9 details and can file and deliver
 * the 1099-NEC forms (Stripe Dashboard → Connect → Tax forms); this page is the cross-check: what each
 * provider was paid in the calendar year (PAID payouts by paid date), the flat travel allowances inside
 * that (mileage, lodging, airfare), and whether Stripe has their full tax ID.
 */
export async function form1099Report(actor: Actor, year: number) {
  requireAdmin(actor);
  const s = await getSettings();
  const threshold = s["tax.form1099ThresholdDollars"] * 100;
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));
  const payouts = await prisma.payout.findMany({
    where: { status: "PAID", paidAt: { gte: from, lt: to } },
    select: {
      providerId: true,
      kind: true,
      amountCents: true,
      assignment: { select: { mileageCents: true, lodgingEstimateCents: true, airfareCents: true, clinicTotalCents: true, clinicPriceCents: true, promoDiscountCents: true } },
    },
  });
  const by = new Map<string, Parameters<typeof form1099Summary>[0]>();
  for (const p of payouts) {
    const a = p.assignment;
    // Lodging counts as an allowance only when it was in the booking total (flat allowance, not a receipt).
    const lodgingIn = a && a.lodgingEstimateCents > 0 && a.clinicTotalCents >= a.clinicPriceCents - a.promoDiscountCents + a.mileageCents + a.lodgingEstimateCents + a.airfareCents;
    const travel = p.kind === "SHIFT" && a ? a.mileageCents + (lodgingIn ? a.lodgingEstimateCents : 0) + a.airfareCents : 0;
    const rows = by.get(p.providerId) ?? [];
    rows.push({ kind: p.kind, amountCents: p.amountCents, travelCents: travel });
    by.set(p.providerId, rows);
  }
  const providers = await prisma.provider.findMany({
    where: { id: { in: [...by.keys()] } },
    select: { id: true, legalName: true, displayName: true, taxEntity: true, taxInfoStatus: true, taxCheckedAt: true, stripeAccountId: true, user: { select: { email: true } } },
  });
  const rows = providers
    .map((p) => ({ ...p, email: p.user.email, ...form1099Summary(by.get(p.id) ?? [], threshold) }))
    .sort((a, b) => b.totalCents - a.totalCents);
  return {
    year,
    thresholdCents: threshold,
    rows,
    over: rows.filter((r) => r.overThreshold).length,
    needsTaxInfo: rows.filter((r) => r.overThreshold && r.taxInfoStatus !== "COMPLETE").length,
  };
}

/** Re-read tax info status from Stripe for providers with a Stripe account (admin button; a few at a time). */
export async function refreshTaxStatuses(actor: Actor, opts: { onlyIncomplete?: boolean } = {}) {
  requireAdmin(actor);
  const list = await prisma.provider.findMany({
    where: { stripeAccountId: { not: null }, ...(opts.onlyIncomplete ? { taxInfoStatus: { not: "COMPLETE" } } : {}) },
    select: { id: true, stripeAccountId: true },
  });
  let updated = 0;
  let failed = 0;
  for (let i = 0; i < list.length; i += 5) {
    await Promise.all(
      list.slice(i, i + 5).map(async (p) => {
        try {
          const st = await paymentsProvider().accountStatus(p.stripeAccountId!);
          await prisma.provider.update({ where: { id: p.id }, data: { stripePayoutsEnabled: st.payoutsEnabled, taxInfoStatus: taxInfoStatus(st.taxFacts), taxCheckedAt: new Date() } });
          updated++;
        } catch {
          failed++;
        }
      }),
    );
  }
  return { updated, failed };
}

/** CSV for the accountant (no tax IDs: Stripe holds those). */
export function form1099Csv(r: Awaited<ReturnType<typeof form1099Report>>) {
  const d = (c: number) => (c / 100).toFixed(2);
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [["Legal name", "Email", "Paid as", "Tax info with Stripe", "Stripe account", "Total paid", "Travel allowances (mileage/lodging/airfare)", "Adjustments (rewards etc.)", "Work pay", `At or over $${d(r.thresholdCents)}`].join(",")];
  for (const x of r.rows) {
    lines.push([q(x.legalName), q(x.email), x.taxEntity === "COMPANY" ? "Company (EIN)" : "Individual (SSN)", x.taxInfoStatus, x.stripeAccountId ?? "", d(x.totalCents), d(x.travelCents), d(x.adjustmentsCents), d(x.workCents), x.overThreshold ? "yes" : "no"].join(","));
  }
  return lines.join("\n") + "\n";
}
