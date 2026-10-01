import { DomainError, isPayable, netTransfer, planTransferLegs, releaseAt, summarizePayouts, type ChargeSource, type PayoutFacts } from "@cm/core";
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
  return sendTransfer(actor, reserved.transfer.id);
}

const CHARGE_TYPES = ["DEPOSIT", "BALANCE", "LODGING", "CANCELLATION_FEE"] as const;

/** Clinic charges that can still fund this provider's transfers, oldest first (deposit, then balance). */
async function chargeSources(assignmentIds: string[]): Promise<(ChargeSource & { paymentIntentId: string })[]> {
  if (!assignmentIds.length) return [];
  const charges = await prisma.payment.findMany({
    where: { assignmentId: { in: assignmentIds }, status: "SUCCEEDED", type: { in: [...CHARGE_TYPES] }, stripePaymentIntentId: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  const refunds = await prisma.payment.findMany({ where: { assignmentId: { in: assignmentIds }, type: "REFUND", status: "SUCCEEDED" }, select: { amountCents: true, description: true } });
  return charges.map((c) => {
    const refunded = refunds.filter((r) => r.description?.includes(c.id)).reduce((a, r) => a + r.amountCents, 0);
    return { paymentId: c.id, assignmentId: c.assignmentId!, paymentIntentId: c.stripePaymentIntentId!, capacityCents: Math.max(0, c.amountCents - refunded - c.transferredCents) };
  });
}

/** Legs in planned order (keys end in -L0, -L1, … -L10; a string sort would misplace L10). */
function byLegOrder<T extends { idempotencyKey: string }>(legs: T[]): T[] {
  const n = (k: string) => Number(k.slice(k.lastIndexOf("-L") + 2));
  return [...legs].sort((a, b) => n(a.idempotencyKey) - n(b.idempotencyKey));
}

/**
 * Send (or resume) one provider payment. The amount is split into legs, each linked to a clinic
 * charge of the same booking (Stripe source_transaction) where one exists, so provider pay is set
 * aside in Stripe and never paid out to the platform. Legs already PAID are never sent again.
 */
export async function sendTransfer(actor: Actor, transferId: string) {
  const transfer = await prisma.payoutTransfer.findUniqueOrThrow({ where: { id: transferId }, include: { payouts: true, legs: { orderBy: { createdAt: "asc" } }, provider: true } });
  const provider = transfer.provider;
  if (!provider.stripeAccountId) throw new DomainError("CONFLICT", `${provider.displayName} hasn't finished payout setup in Stripe yet.`);
  let legs = byLegOrder(transfer.legs);
  if (!legs.length) {
    const sources = await chargeSources([...new Set(transfer.payouts.map((p) => p.assignmentId).filter((x): x is string => !!x))]);
    const plan = planTransferLegs(transfer.payouts.map((p) => ({ assignmentId: p.assignmentId, amountCents: p.amountCents })), sources);
    const planned = plan.reduce((a, l) => a + l.amountCents, 0);
    if (planned !== transfer.amountCents) throw new Error(`Transfer legs (${planned}) don't add up to ${transfer.amountCents}`);
    await prisma.payoutTransferLeg.createMany({ data: plan.map((l, i) => ({ transferId, paymentId: l.paymentId, amountCents: l.amountCents, idempotencyKey: `${transfer.idempotencyKey}-L${i}` })) });
    legs = byLegOrder(await prisma.payoutTransferLeg.findMany({ where: { transferId } }));
  }
  const pis = new Map((await prisma.payment.findMany({ where: { id: { in: legs.map((l) => l.paymentId).filter((x): x is string => !!x) } }, select: { id: true, stripePaymentIntentId: true } })).map((p) => [p.id, p.stripePaymentIntentId]));
  let failure: string | null = null;
  for (const [i, leg] of legs.entries()) {
    if (leg.status === "PAID") continue;
    try {
      const t = await paymentsProvider().transfer({
        accountId: provider.stripeAccountId,
        amountCents: leg.amountCents,
        idempotencyKey: leg.idempotencyKey,
        description: `Coverage pay (${transfer.payouts.length} item${transfer.payouts.length === 1 ? "" : "s"})${legs.length > 1 ? ` · part ${i + 1} of ${legs.length}` : ""}`,
        metadata: { providerId: provider.id, transferId, legId: leg.id },
        sourcePaymentIntentId: leg.paymentId ? (pis.get(leg.paymentId) ?? null) : null,
      });
      await prisma.$transaction([
        prisma.payoutTransferLeg.update({ where: { id: leg.id }, data: { status: "PAID", stripeTransferId: t.id, paidAt: new Date(), failureReason: null } }),
        ...(leg.paymentId ? [prisma.payment.update({ where: { id: leg.paymentId }, data: { transferredCents: { increment: leg.amountCents } } })] : []),
      ]);
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
      await prisma.payoutTransferLeg.update({ where: { id: leg.id }, data: { status: "FAILED", failureReason: failure.slice(0, 500) } });
      break;
    }
  }
  const done = byLegOrder(await prisma.payoutTransferLeg.findMany({ where: { transferId } }));
  const paidLegs = done.filter((l) => l.status === "PAID");
  if (!failure && paidLegs.length === done.length) {
    const paidAt = new Date();
    await prisma.$transaction([
      prisma.payoutTransfer.update({ where: { id: transferId }, data: { status: "PAID", stripeTransferId: paidLegs[0]?.stripeTransferId ?? null, paidAt, failureReason: null } }),
      prisma.payout.updateMany({ where: { transferId }, data: { status: "PAID", paidAt } }),
    ]);
    await audit(prisma, actor, "payout.transfer_paid", "PayoutTransfer", transferId, null, { amountCents: transfer.amountCents, legs: paidLegs.map((l) => ({ amountCents: l.amountCents, linked: !!l.paymentId, stripeTransferId: l.stripeTransferId })), payoutIds: transfer.payouts.map((p) => p.id) });
    await notify(prisma, provider.userId, {
      template: "payout_sent",
      title: `Payment sent: $${(transfer.amountCents / 100).toFixed(2)}`,
      body: "Your coverage pay is on its way to your bank through Stripe. It usually arrives within 2 business days.",
      link: "/provider/earnings",
      ctaLabel: "View earnings",
    });
    return { transferId, amountCents: transfer.amountCents, status: "PAID" as const };
  }
  if (!paidLegs.length) {
    // Nothing went out: release the rows so the next run (or an admin) can try again from scratch.
    await prisma.$transaction([
      prisma.payoutTransfer.update({ where: { id: transferId }, data: { status: "FAILED", failureReason: (failure ?? "").slice(0, 500) } }),
      prisma.payout.updateMany({ where: { transferId }, data: { status: "FAILED", transferId: null } }),
    ]);
    await audit(prisma, actor, "payout.transfer_failed", "PayoutTransfer", transferId, null, { reason: failure });
    await notifyAdmins(prisma, { template: "payout_failed", title: "A provider payment failed", body: `${provider.displayName}: ${failure}`, link: "/admin/payouts", email: true });
    return { transferId, amountCents: transfer.amountCents, status: "FAILED" as const, reason: failure };
  }
  // Part of it went out: keep the rows reserved; the payout job resumes only the unpaid legs.
  await prisma.payoutTransfer.update({ where: { id: transferId }, data: { failureReason: `Partly sent; retrying: ${failure}`.slice(0, 500) } });
  await audit(prisma, actor, "payout.transfer_partial", "PayoutTransfer", transferId, null, { reason: failure, paidCents: paidLegs.reduce((a, l) => a + l.amountCents, 0) });
  await notifyAdmins(prisma, { template: "payout_failed", title: "A provider payment was only partly sent", body: `${provider.displayName}: ${failure}. The rest is retried automatically.`, link: "/admin/payouts", email: true });
  return { transferId, amountCents: transfer.amountCents, status: "PARTIAL" as const, reason: failure };
}

/** Job: finish payments that were only partly sent (unpaid legs only, same idempotency keys). */
export async function resumePartialTransfers(olderThanMinutes = 5) {
  const stuck = await prisma.payoutTransfer.findMany({
    where: { status: "PROCESSING", createdAt: { lt: new Date(Date.now() - olderThanMinutes * 60_000) }, legs: { some: { status: { not: "PAID" } } } },
    select: { id: true },
    take: 50,
  });
  const out = [];
  for (const t of stuck) out.push(await sendTransfer(SYSTEM, t.id).catch((e) => ({ transferId: t.id, error: (e as Error).message })));
  return out;
}

/** Job: pay everything that's due, per provider. */
export async function releaseDuePayouts(now = new Date()) {
  const resumed = await resumePartialTransfers();
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
  return resumed.length ? [...resumed, ...results] : results;
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
