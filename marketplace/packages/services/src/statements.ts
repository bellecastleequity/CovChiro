import { DateTime } from "luxon";
import { DomainError } from "@cm/core";
import { prisma } from "@cm/db";
import { requireClinic, requireProvider, type Actor } from "./context";

/**
 * Printable statements (browser "Save as PDF"): a clinic's monthly charges and refunds for its
 * bookkeeper, and a provider's yearly earnings summary. Amounts come straight from the payment and
 * payout ledgers; nothing is recalculated. Months and years are Eastern time.
 */
const TZ = "America/New_York";

export async function clinicStatement(actor: Actor, month: string) {
  const orgId = requireClinic(actor);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new DomainError("VALIDATION", "Pick a month.");
  const start = DateTime.fromISO(`${month}-01`, { zone: TZ });
  const end = start.plus({ months: 1 });
  const [org, rows] = await Promise.all([
    prisma.clinicOrg.findUniqueOrThrow({ where: { id: orgId }, select: { displayName: true, legalName: true, billingEmail: true } }),
    prisma.payment.findMany({
      where: { clinicOrgId: orgId, status: "SUCCEEDED", createdAt: { gte: start.toJSDate(), lt: end.toJSDate() } },
      include: { assignment: { include: { provider: { select: { displayName: true } }, shift: { include: { location: { select: { name: true, timeZone: true } } } } } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const lines = rows.map((p) => ({
    id: p.id,
    date: p.createdAt,
    type: p.type,
    description: p.description ?? null,
    shiftDate: p.assignment?.startsAt ?? null,
    location: p.assignment?.shift.location.name ?? null,
    provider: p.assignment?.provider.displayName ?? null,
    amountCents: p.type === "REFUND" ? -p.amountCents : p.amountCents,
  }));
  const charges = lines.filter((l) => l.amountCents > 0).reduce((a, l) => a + l.amountCents, 0);
  const refunds = lines.filter((l) => l.amountCents < 0).reduce((a, l) => a - l.amountCents, 0);
  return { org, month, label: start.toFormat("LLLL yyyy"), lines, charges, refunds, net: charges - refunds };
}

/** Months (newest first) with any payment, for the statement picker. */
export async function clinicStatementMonths(actor: Actor) {
  const orgId = requireClinic(actor);
  const rows = await prisma.$queryRaw<{ m: string }[]>`SELECT DISTINCT to_char("createdAt" AT TIME ZONE 'America/New_York', 'YYYY-MM') AS m FROM "Payment" WHERE "clinicOrgId" = ${orgId} AND status = 'SUCCEEDED' ORDER BY 1 DESC LIMIT 36`;
  return rows.map((r) => r.m);
}

export async function providerAnnualStatement(actor: Actor, year: number) {
  const providerId = requireProvider(actor);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new DomainError("VALIDATION", "Pick a year.");
  const start = DateTime.fromObject({ year, month: 1, day: 1 }, { zone: TZ });
  const end = start.plus({ years: 1 });
  const [provider, rows] = await Promise.all([
    prisma.provider.findUniqueOrThrow({ where: { id: providerId }, select: { legalName: true, displayName: true } }),
    prisma.payout.findMany({
      where: { providerId, status: "PAID", paidAt: { gte: start.toJSDate(), lt: end.toJSDate() } },
      include: { assignment: { include: { shift: { include: { location: { include: { clinicOrg: { select: { displayName: true } } } } } } } } },
      orderBy: { paidAt: "asc" },
    }),
  ]);
  const lines = rows.map((p) => ({
    id: p.id,
    paidAt: p.paidAt!,
    kind: p.kind,
    description: p.description,
    shiftDate: p.assignment?.startsAt ?? null,
    clinic: p.assignment?.shift.location.clinicOrg.displayName ?? null,
    amountCents: p.amountCents,
  }));
  const byMonth = Array.from({ length: 12 }, (_, i) => {
    const m = start.plus({ months: i });
    const inMonth = lines.filter((l) => DateTime.fromJSDate(l.paidAt, { zone: TZ }).month === m.month);
    return { label: m.toFormat("LLLL"), cents: inMonth.reduce((a, l) => a + l.amountCents, 0), count: inMonth.length };
  });
  const shifts = lines.filter((l) => l.kind === "SHIFT").length;
  return { provider, year, lines, byMonth, total: lines.reduce((a, l) => a + l.amountCents, 0), shifts };
}
