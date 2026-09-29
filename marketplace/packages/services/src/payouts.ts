import { DomainError, isPayable, netTransfer, releaseAt, summarizePayouts, type PayoutFacts } from "@cm/core";
import { prisma, type Payout } from "@cm/db";
import { paymentsProvider } from "@cm/integrations";
import { audit, getSettings, requireAdmin, requireProvider, SYSTEM, type Actor, type Db } from "./context";
import { notify, notifyAdmins } from "./notify";

/**
 * Provider pay ledger and payment issuing.
 *
 *   confirm  → SHIFT row PENDING (amount = pay + mileage)
 *   complete → SCHEDULED, releaseAt = completion + hold
 *   lodging approved / late-cancel share / admin adjustment → own rows
 *   issue    → rows netted per provider into one PayoutTransfer → Stripe
 *              Connect transfer (INV-5) → PAID (or FAILED, retryable)
 *
 * Holds and open disputes block payment. Paid rows are immutable (DB trigger).
 */

async function openDisputeAssignmentIds(db: Db, assignmentIds: string[]): Promise<Set<string>> {
  if (!assignmentIds.length) return new Set();
  const rows = await db.dispute.findMany({ where: { assignmentId: { in: assignmentIds }, status: "OPEN" }, select: { assignmentId: true } });
  return new Set(rows.map((r) => r.assignmentId));
}

function facts(p: Payout): PayoutFacts {
  return { kind: p.kind, status: p.status, amountCents: p.amountCents, releaseAt: p.releaseAt, paidAt: p.paidAt, onHold: p.onHold };
}

/** Called when an assignment completes: schedule its SHIFT row for release. */
export async function scheduleShiftPayout(db: Db, assignmentId: string, completedAt: Date) {
  const s = await getSettings(db);
  await db.payout.updateMany({
    where: { assignmentId, kind: "SHIFT", status: "PENDING" },
    data: { status: "SCHEDULED", releaseAt: releaseAt(completedAt, s["payments.payoutHoldHours"]) },
  });
}

export async function setHold(actor: Actor, payoutId: string, hold: boolean, reason: string | null) {
  requireAdmin(actor);
  const p = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
  if (p.status === "PAID" || p.status === "PROCESSING" || p.status === "CANCELLED") throw new DomainError("CONFLICT", `A ${p.status.toLowerCase()} payout can't be ${hold ? "held" : "released"}.`);
  await prisma.payout.update({ where: { id: payoutId }, data: { onHold: hold, holdReason: hold ? reason?.slice(0, 300) || "Held by admin" : null } });
  await audit(prisma, actor, hold ? "payout.hold" : "payout.release_hold", "Payout", payoutId, { onHold: p.onHold }, { onHold: hold, reason });
}

/** Bonus (+) or correction (−). Negative adjustments are recovered from the next payment. */
export async function addAdjustment(actor: Actor, input: { providerId: string; amountCents: number; description: string; assignmentId?: string | null }) {
  requireAdmin(actor);
  if (!Number.isInteger(input.amountCents) || input.amountCents === 0) throw new DomainError("VALIDATION", "Enter a non-zero amount in cents.");
  if (!input.description.trim()) throw new DomainError("VALIDATION", "Describe the adjustment.");
  const row = await prisma.payout.create({
    data: {
      providerId: input.providerId,
      kind: "ADJUSTMENT",
      description: input.description.trim().slice(0, 300),
      amountCents: input.amountCents,
      status: "SCHEDULED",
      releaseAt: new Date(),
      createdById: actor.userId,
    },
  });
  await audit(prisma, actor, "payout.adjustment", "Payout", row.id, null, { providerId: input.providerId, amountCents: input.amountCents, description: input.description });
  return row;
}

export async function cancelPayout(actor: Actor, payoutId: string, reason: string) {
  requireAdmin(actor);
  const p = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
  if (!["PENDING", "SCHEDULED", "ON_HOLD", "FAILED"].includes(p.status)) throw new DomainError("CONFLICT", "Only unpaid payouts can be cancelled.");
  await prisma.payout.update({ where: { id: payoutId }, data: { status: "CANCELLED", holdReason: reason.slice(0, 300) } });
  await audit(prisma, actor, "payout.cancelled", "Payout", payoutId, { status: p.status }, { status: "CANCELLED", reason });
}

/**
 * Issue payment to one provider. Admins may pay a SCHEDULED row before its
 * hold period ends (`early`), but never past a hold or an open dispute.
 * The job calls this with SYSTEM for everything that's due.
 */
export async function issuePayment(actor: Actor, providerId: string, opts: { payoutIds?: string[]; early?: boolean; note?: string } = {}) {
  if (actor.role !== "SYSTEM") requireAdmin(actor);
  const provider = await prisma.provider.findUniqueOrThrow({ where: { id: providerId } });
  if (!provider.stripeAccountId || !provider.stripePayoutsEnabled) {
    throw new DomainError("CONFLICT", `${provider.displayName} hasn't finished payout setup in Stripe yet.`);
  }
  const now = new Date();

  // Reserve rows + create the transfer record atomically so two admins can't pay the same rows.
  const reserved = await prisma.$transaction(async (db) => {
    const rows = await db.payout.findMany({
      where: {
        providerId,
        status: { in: ["SCHEDULED", "FAILED"] },
        onHold: false,
        ...(opts.payoutIds?.length ? { id: { in: opts.payoutIds } } : {}),
      },
    });
    const disputes = await openDisputeAssignmentIds(db, rows.map((r) => r.assignmentId).filter(Boolean) as string[]);
    const payable = rows.filter((r) => {
      const blocked = r.assignmentId ? disputes.has(r.assignmentId) : false;
      if (opts.early && actor.role !== "SYSTEM") return !blocked && r.releaseAt !== null && r.amountCents !== 0;
      return isPayable(facts(r), now, blocked) || (r.kind === "ADJUSTMENT" && r.amountCents < 0 && !blocked);
    });
    const net = netTransfer(payable.map((r) => ({ id: r.id, amountCents: r.amountCents })));
    if (!net) return null;
    const transfer = await db.payoutTransfer.create({
      data: {
        providerId,
        amountCents: net.amountCents,
        idempotencyKey: `payout-${providerId}-${net.ids.sort().join(".").slice(0, 180)}-${now.getTime()}`,
        status: "PROCESSING",
        initiatedById: actor.userId,
        note: opts.note?.slice(0, 300) ?? null,
      },
    });
    const updated = await db.payout.updateMany({ where: { id: { in: net.ids }, status: { in: ["SCHEDULED", "FAILED"] } }, data: { status: "PROCESSING", transferId: transfer.id } });
    if (updated.count !== net.ids.length) throw new DomainError("CONFLICT", "Some of these payouts changed while paying — refresh and try again.");
    return { transfer, ids: net.ids };
  });
  if (!reserved) return null;

  try {
    const t = await paymentsProvider().transfer({
      accountId: provider.stripeAccountId,
      amountCents: reserved.transfer.amountCents,
      idempotencyKey: reserved.transfer.idempotencyKey,
      description: `Coverage pay (${reserved.ids.length} item${reserved.ids.length === 1 ? "" : "s"})`,
      metadata: { providerId, transferId: reserved.transfer.id },
    });
    const paidAt = new Date();
    await prisma.$transaction([
      prisma.payoutTransfer.update({ where: { id: reserved.transfer.id }, data: { status: "PAID", stripeTransferId: t.id, paidAt } }),
      prisma.payout.updateMany({ where: { transferId: reserved.transfer.id }, data: { status: "PAID", paidAt } }),
    ]);
    await audit(prisma, actor, "payout.transfer_paid", "PayoutTransfer", reserved.transfer.id, null, { amountCents: reserved.transfer.amountCents, stripeTransferId: t.id, payoutIds: reserved.ids });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: provider.userId } });
    await notify(prisma, user.id, {
      template: "payout_sent",
      title: `Payment sent: $${(reserved.transfer.amountCents / 100).toFixed(2)}`,
      body: "Your coverage pay is on its way to your bank through Stripe. It usually arrives within 2 business days.",
      link: "/provider/earnings",
      ctaLabel: "View earnings",
    });
    return { transferId: reserved.transfer.id, amountCents: reserved.transfer.amountCents, status: "PAID" as const };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    await prisma.$transaction([
      prisma.payoutTransfer.update({ where: { id: reserved.transfer.id }, data: { status: "FAILED", failureReason: reason.slice(0, 500) } }),
      prisma.payout.updateMany({ where: { transferId: reserved.transfer.id }, data: { status: "FAILED", transferId: null } }),
    ]);
    await audit(prisma, actor, "payout.transfer_failed", "PayoutTransfer", reserved.transfer.id, null, { reason });
    await notifyAdmins(prisma, { template: "payout_failed", title: "A provider payment failed", body: `${provider.displayName}: ${reason}`, link: "/admin/payouts", email: true });
    return { transferId: reserved.transfer.id, amountCents: reserved.transfer.amountCents, status: "FAILED" as const, reason };
  }
}

/** Job: pay everything that's due, per provider. */
export async function releaseDuePayouts(now = new Date()) {
  const due = await prisma.payout.findMany({
    where: { status: { in: ["SCHEDULED"] }, onHold: false, releaseAt: { lte: now } },
    select: { providerId: true },
    distinct: ["providerId"],
  });
  const results = [];
  for (const { providerId } of due) {
    try {
      results.push(await issuePayment(SYSTEM, providerId));
    } catch (e) {
      results.push({ providerId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}

// ---------------- views ----------------

export async function providerEarnings(actor: Actor) {
  const providerId = requireProvider(actor);
  return earningsFor(providerId);
}

export async function earningsFor(providerId: string) {
  const now = new Date();
  const rows = await prisma.payout.findMany({
    where: { providerId },
    orderBy: { createdAt: "desc" },
    include: { assignment: { include: { shift: { include: { location: { include: { clinicOrg: true } } } } } } },
  });
  const disputes = await openDisputeAssignmentIds(prisma, rows.map((r) => r.assignmentId).filter(Boolean) as string[]);
  const transfers = await prisma.payoutTransfer.findMany({ where: { providerId }, orderBy: { createdAt: "desc" }, take: 50 });
  return {
    summary: summarizePayouts(rows.map((r) => ({ ...facts(r), hasOpenDispute: r.assignmentId ? disputes.has(r.assignmentId) : false })), now),
    rows: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      description: r.description,
      amountCents: r.amountCents,
      status: r.onHold ? "ON_HOLD" : r.status,
      holdReason: r.onHold ? r.holdReason : null,
      disputed: r.assignmentId ? disputes.has(r.assignmentId) : false,
      releaseAt: r.releaseAt,
      paidAt: r.paidAt,
      shiftDate: r.assignment?.startsAt ?? null,
      clinic: r.assignment?.shift.location.clinicOrg.displayName ?? null,
      professionCode: r.assignment?.professionCode ?? null,
      createdAt: r.createdAt,
    })),
    transfers,
  };
}

/** Admin: who is owed what, per provider. */
export async function payoutsOverview(actor: Actor, filter: { status?: string; q?: string } = {}) {
  requireAdmin(actor);
  const now = new Date();
  const rows = await prisma.payout.findMany({
    where: {
      status: { not: "CANCELLED" },
      ...(filter.q ? { provider: { OR: [{ displayName: { contains: filter.q, mode: "insensitive" } }, { legalName: { contains: filter.q, mode: "insensitive" } }] } } : {}),
    },
    include: { provider: { select: { id: true, displayName: true, stripePayoutsEnabled: true, stripeAccountId: true } }, assignment: { select: { startsAt: true, professionCode: true } } },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });
  const disputes = await openDisputeAssignmentIds(prisma, rows.map((r) => r.assignmentId).filter(Boolean) as string[]);
  const byProvider = new Map<string, { provider: (typeof rows)[number]["provider"]; rows: typeof rows }>();
  for (const r of rows) {
    const e = byProvider.get(r.providerId) ?? { provider: r.provider, rows: [] as typeof rows };
    e.rows.push(r);
    byProvider.set(r.providerId, e);
  }
  const providers = [...byProvider.values()].map(({ provider, rows }) => ({
    provider,
    summary: summarizePayouts(rows.map((r) => ({ ...facts(r), hasOpenDispute: r.assignmentId ? disputes.has(r.assignmentId) : false })), now),
    rows: rows.map((r) => ({ ...r, disputed: r.assignmentId ? disputes.has(r.assignmentId) : false })),
  }));
  const totals = providers.reduce(
    (t, p) => {
      for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += p.summary[k];
      return t;
    },
    { upcomingCents: 0, scheduledCents: 0, readyCents: 0, onHoldCents: 0, processingCents: 0, paidCents: 0, paidYtdCents: 0 },
  );
  const transfers = await prisma.payoutTransfer.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { provider: { select: { displayName: true } } } });
  return { providers: providers.sort((a, b) => b.summary.readyCents - a.summary.readyCents || b.summary.scheduledCents - a.summary.scheduledCents), totals, transfers };
}

export function payoutsCsv(rows: { id: string; providerName: string; kind: string; description: string; amountCents: number; status: string; releaseAt: Date | null; paidAt: Date | null }[]) {
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [
    ["id", "provider", "kind", "description", "amount", "status", "release_at", "paid_at"].join(","),
    ...rows.map((r) => [r.id, r.providerName, r.kind, r.description, (r.amountCents / 100).toFixed(2), r.status, r.releaseAt?.toISOString() ?? "", r.paidAt?.toISOString() ?? ""].map(q).join(",")),
  ].join("\n");
}
