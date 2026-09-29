import { assertTransition, clinicTotalCents, depositCents, DomainError, providerTotalCents, SELECTABLE_SHIFT_STATUSES, travelEstimate, travelBufferMinutes } from "@cm/core";
import { Prisma, isInvariantViolation, type SelectionMethod } from "@cm/db";
import { audit, clock, getSettings, lockShift, tx, type Actor, type Db } from "./context";
import { Effects } from "./effects";
import { assertProviderEligibleForShift } from "./eligibility";
import { notify, notifyClinic } from "./notify";
import { chargeDeposit } from "./payments";

/**
 * Confirmation transaction (SPEC §7.8). Locks the shift row, re-checks
 * eligibility (INV-1/3/8), prices travel, inserts the assignment (the DB
 * trigger re-checks credentials; the exclusion constraint enforces INV-2;
 * a partial unique index guarantees one live assignment per shift), then
 * settles applications/offers and opens the provider pay ledger row.
 * Deposit charge, thread and notifications run after commit.
 */
export async function confirmProvider(
  actor: Actor,
  shiftId: string,
  providerId: string,
  method: SelectionMethod,
  opts: { acceptedOfferId?: string; graceMinutes?: number } = {},
): Promise<{ assignmentId: string }> {
  const effects = new Effects();
  let assignmentId = "";
  try {
    await tx(async (db) => {
      assignmentId = await confirmInTx(db, actor, shiftId, providerId, method, effects, opts);
    });
  } catch (e) {
    if (e instanceof DomainError) throw e;
    const inv = isInvariantViolation(e);
    if (inv) {
      if (/overlap/i.test(inv.message)) throw new DomainError("SCHEDULE_CONFLICT", "That provider is already booked at an overlapping time.");
      if (/one_live_assignment/i.test(inv.message)) throw new DomainError("CONFLICT", "This shift was just filled.");
      if (/INV-1/.test(inv.message)) throw new DomainError("LICENSE_STATE_MISMATCH", inv.message);
      if (/INV-3/.test(inv.message)) throw new DomainError("MALPRACTICE_INVALID", inv.message);
      if (/INV-8/.test(inv.message)) throw new DomainError("SUPERVISION_NOT_ATTESTED", inv.message);
      throw new DomainError("CONFLICT", inv.message);
    }
    if ((e as { code?: string }).code === "P2002") throw new DomainError("CONFLICT", "This shift was just filled.");
    throw e;
  }
  await effects.run();
  return { assignmentId };
}

export async function confirmInTx(
  db: Db,
  actor: Actor,
  shiftId: string,
  providerId: string,
  method: SelectionMethod,
  effects: Effects,
  opts: { acceptedOfferId?: string; graceMinutes?: number } = {},
): Promise<string> {
  const s = await getSettings(db);
  const now = clock.now();
  await lockShift(db, shiftId);
  await db.$queryRaw(Prisma.sql`SELECT id FROM "Shift" WHERE id = ${shiftId} FOR UPDATE`);
  const shift = await db.shift.findUniqueOrThrow({ where: { id: shiftId }, include: { location: true } });
  if (!SELECTABLE_SHIFT_STATUSES.includes(shift.status)) {
    throw new DomainError("CONFLICT", shift.status === "CONFIRMED" ? "This shift has already been filled." : `This shift can't be filled (${shift.status.toLowerCase()}).`);
  }
  if (shift.startsAt <= now) throw new DomainError("CONFLICT", "This shift has already started.");

  const ev = await assertProviderEligibleForShift(db, providerId, shiftId);
  const drive = ev.drive ?? { minutes: 0, miles: 0 };
  const travel = travelEstimate(drive, { lodgingAllowed: shift.lodgingAllowed, lodgingCapCentsPerNight: shift.lodgingCapCentsPerNight }, s);

  // Promo: redeem now (counts only confirmed shifts). If it ran out since posting, drop it.
  let discount = shift.promoDiscountCents;
  if (shift.promoCodeId && discount > 0) {
    const updated = await db.$executeRaw(
      Prisma.sql`UPDATE "PromoCode" SET "usedCount" = "usedCount" + 1 WHERE id = ${shift.promoCodeId} AND ("maxUses" IS NULL OR "usedCount" < "maxUses")`,
    );
    if (updated === 1) {
      await db.promoRedemption.upsert({
        where: { shiftId },
        create: { promoCodeId: shift.promoCodeId, clinicOrgId: shift.location.clinicOrgId, shiftId, discountCents: discount },
        update: { voidedAt: null, discountCents: discount },
      });
    } else {
      discount = 0;
      await db.shift.update({ where: { id: shiftId }, data: { promoDiscountCents: 0 } });
    }
  }

  const breakdown = {
    clinicPriceCents: shift.clinicPriceCents,
    providerPayCents: shift.providerPayCents,
    promoDiscountCents: discount,
    mileageCents: travel.mileageCents,
    lodgingCents: 0,
  };
  const clinicTotal = clinicTotalCents(breakdown);
  const providerTotal = providerTotalCents(breakdown);
  const assignment = await db.assignment.create({
    data: {
      shiftId,
      providerId,
      state: shift.state,
      professionCode: shift.professionCode,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      bufferMinutes: travelBufferMinutes(ev.drive?.minutes ?? null, s["matching.travelBufferExtraMinutes"]),
      selectionMethod: method,
      driveMinutes: drive.minutes,
      driveMiles: drive.miles,
      clinicPriceCents: shift.clinicPriceCents,
      providerPayCents: shift.providerPayCents,
      promoDiscountCents: discount,
      mileageCents: travel.mileageCents,
      lodgingEstimateCents: travel.lodgingEstimateCents,
      clinicTotalCents: clinicTotal,
      providerTotalCents: providerTotal,
      depositCents: depositCents(clinicTotal, s["payments.depositPercent"]),
      confirmedAt: now,
      graceEndsAt: opts.graceMinutes ? new Date(+now + opts.graceMinutes * 60_000) : null,
    },
  });

  assertTransition("Shift", shift.status, "CONFIRMED");
  await db.shift.update({ where: { id: shiftId }, data: { status: "CONFIRMED" } });
  await db.application.updateMany({ where: { shiftId, providerId, status: "ACTIVE" }, data: { status: "SELECTED" } });
  await db.application.updateMany({ where: { shiftId, providerId: { not: providerId }, status: "ACTIVE" }, data: { status: "NOT_SELECTED" } });
  if (opts.acceptedOfferId) {
    await db.offer.update({ where: { id: opts.acceptedOfferId }, data: { status: "ACCEPTED", respondedAt: now } });
  }
  // Close any active dispatch: other offers are NOT_SELECTED; other acceptors go to standby (Addendum 02 §5.4, §7).
  const { settleDispatchOnFill } = await import("./dispatch");
  await settleDispatchOnFill(db, shiftId, providerId, method, opts.acceptedOfferId ?? null, effects);
  await db.offer.updateMany({ where: { shiftId, status: "PENDING" }, data: { status: "WITHDRAWN", respondedAt: now } });

  // Auto-withdraw this provider's overlapping applications and offers elsewhere.
  const buffer = assignment.bufferMinutes * 60_000;
  const overlapWhere = { startsAt: { lt: new Date(+shift.endsAt + buffer) }, endsAt: { gt: new Date(+shift.startsAt - buffer) }, id: { not: shiftId } };
  await db.application.updateMany({ where: { providerId, status: "ACTIVE", shift: overlapWhere }, data: { status: "AUTO_WITHDRAWN_CONFLICT", withdrawnAt: new Date() } });
  await db.offer.updateMany({ where: { providerId, status: "PENDING", shift: overlapWhere }, data: { status: "WITHDRAWN", respondedAt: new Date() } });

  // Provider pay ledger: owed once the shift completes.
  await db.payout.create({
    data: {
      providerId,
      assignmentId: assignment.id,
      kind: "SHIFT",
      description: `Coverage ${shift.startsAt.toISOString().slice(0, 10)} · ${shift.location.name}`,
      amountCents: providerTotal,
      status: "PENDING",
    },
  });

  await db.messageThread.upsert({
    where: { clinicOrgId_providerId: { clinicOrgId: shift.location.clinicOrgId, providerId } },
    create: { clinicOrgId: shift.location.clinicOrgId, providerId, shiftId },
    update: { shiftId },
  });

  await audit(db, actor, "shift.confirmed", "Shift", shiftId, { status: shift.status }, { status: "CONFIRMED", providerId, method, assignmentId: assignment.id });

  effects.add(() => chargeDeposit(assignment.id));
  effects.add(async () => {
    const { prisma } = await import("@cm/db");
    const date = shift.startsAt.toLocaleDateString("en-US", { timeZone: shift.location.timeZone, weekday: "short", month: "short", day: "numeric" });
    await notify(prisma, ev.provider.userId, {
      template: "shift_confirmed_provider",
      title: `You're confirmed: ${date} at ${shift.location.name}`,
      body: `You're booked for ${date} in ${shift.location.city}, ${shift.location.state}. Arrival notes and the on-site contact are on the shift page.`,
      link: `/provider/assignments/${assignment.id}`,
      ctaLabel: "View shift details",
      sms: true,
    });
    await notifyClinic(prisma, shift.location.clinicOrgId, {
      template: "shift_confirmed_clinic",
      title: `Coverage confirmed for ${date}`,
      body: `${ev.provider.displayName} is confirmed for ${shift.location.name}.`,
      link: `/clinic/shifts/${shiftId}`,
      ctaLabel: "View shift",
      sms: true,
    });
    // Lead conversion: a clinic's first confirmed shift.
    const prior = await prisma.assignment.count({ where: { shift: { location: { clinicOrgId: shift.location.clinicOrgId } }, id: { not: assignment.id } } });
    if (prior === 0) {
      const members = await prisma.clinicMember.findMany({ where: { clinicOrgId: shift.location.clinicOrgId }, select: { userId: true } });
      const { onLeadConverted } = await import("./leads");
      await onLeadConverted(members.map((m) => m.userId), shiftId);
    }
  });
  return assignment.id;
}
