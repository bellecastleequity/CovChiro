import { assertTransition, stayLabel, idDueAt, type IdStatus, clinicTotalCents, depositPercentFor, depositWithTravel, DomainError, providerTotalCents, SELECTABLE_SHIFT_STATUSES, travelEstimate, travelBufferMinutes } from "@cm/core";
import { Prisma, isInvariantViolation, type SelectionMethod } from "@cm/db";
import { audit, clock, getSettings, lockShift, tx, type Actor, type Db } from "./context";
import { Effects } from "./effects";
import { assertProviderEligibleForShift } from "./eligibility";
import { createLodgingAdvance, refundUnusedHold, sendDueLodgingAdvance, takeShiftHold, UPFRONT_FLAG } from "./lodging";
import { notify, notifyClinic } from "./notify";
import { chargeDeposit } from "./payments";
import { idCheckRules } from "./idcheck";

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
  // Fly-in: no mileage; lodging every night (the night before each day) at the fly-in rate; the
  // airfare allowance once per trip, on the first day this provider covers in the booking.
  const flyIn = !!ev.result.flyIn;
  let airfareCents = 0;
  if (flyIn) {
    const carried = shift.shiftGroupId
      ? await db.assignment.count({ where: { providerId, airfareCents: { gt: 0 }, status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] }, shift: { shiftGroupId: shift.shiftGroupId } } })
      : 0;
    airfareCents = carried ? 0 : (shift.flyInAirfareCents ?? 0);
  }
  const travel = shift.lodgingByClinic
    ? // The clinic books the stay itself: no lodging allowance either way.
      { mileageCents: flyIn ? 0 : travelEstimate(drive, { lodgingAllowed: false, lodgingCapCentsPerNight: null }, s).mileageCents, lodgingEstimateCents: 0 }
    : flyIn
      ? { mileageCents: 0, lodgingEstimateCents: shift.flyInNightlyCents ?? 0 }
      : travelEstimate(drive, { lodgingAllowed: shift.lodgingAllowed, lodgingCapCentsPerNight: shift.lodgingCapCentsPerNight }, s);
  // The clinic books the stay and this provider will stay over (fly-in, or a drive past the lodging trigger).
  const stayByClinic = shift.lodgingAllowed && shift.lodgingByClinic && (flyIn || drive.minutes > s["pricing.lodgingTriggerMinutes"]);
  // Lodging held on this shift from a provider who dropped out pays this provider's lodging (core lodging.ts).
  const hold = await takeShiftHold(db, shiftId, travel.lodgingEstimateCents);

  // Promo: redeem now (counts only confirmed shifts). If it ran out since posting, drop it.
  // promoDiscountCents carries promo + partner discount; only the promo part can run out.
  const partnerDiscount = Math.min(shift.partnerDiscountCents, shift.promoDiscountCents);
  let discount = shift.promoDiscountCents;
  if (shift.promoCodeId && discount - partnerDiscount > 0) {
    const updated = await db.$executeRaw(
      Prisma.sql`UPDATE "PromoCode" SET "usedCount" = "usedCount" + 1 WHERE id = ${shift.promoCodeId} AND ("maxUses" IS NULL OR "usedCount" < "maxUses")`,
    );
    if (updated === 1) {
      await db.promoRedemption.upsert({
        where: { shiftId },
        create: { promoCodeId: shift.promoCodeId, clinicOrgId: shift.location.clinicOrgId, shiftId, discountCents: discount - partnerDiscount },
        update: { voidedAt: null, discountCents: discount - partnerDiscount },
      });
    } else {
      discount = partnerDiscount;
      await db.shift.update({ where: { id: shiftId }, data: { promoDiscountCents: partnerDiscount } });
    }
  }

  const breakdown = {
    clinicPriceCents: shift.clinicPriceCents,
    providerPayCents: shift.providerPayCents,
    promoDiscountCents: discount,
    mileageCents: travel.mileageCents,
    // Flat nightly lodging allowance (no receipts): charged to the clinic and paid to the provider.
    lodgingCents: travel.lodgingEstimateCents,
    airfareCents,
  };
  const clinicTotal = clinicTotalCents(breakdown);
  const payInFull = (await db.clinicOrg.findUnique({ where: { id: shift.location.clinicOrgId }, select: { payInFull: true } }))?.payInFull ?? false;
  const providerTotal = providerTotalCents(breakdown);
  // Photo ID check: an unverified provider booked ahead verifies by a deadline (idcheck.ts), or the booking is released.
  const idStatus = (await db.provider.findUniqueOrThrow({ where: { id: providerId }, select: { idStatus: true } })).idStatus as IdStatus;
  const idDue = idDueAt(idCheckRules(s), idStatus, shift.startsAt, now);
  const assignment = await db.assignment.create({
    data: {
      shiftId,
      providerId,
      idDueAt: idDue,
      state: shift.state,
      professionCode: shift.professionCode,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      bufferMinutes: travelBufferMinutes(flyIn ? null : (ev.drive?.minutes ?? null), s["matching.travelBufferExtraMinutes"]),
      selectionMethod: method,
      driveMinutes: drive.minutes,
      driveMiles: drive.miles,
      clinicPriceCents: shift.clinicPriceCents,
      providerPayCents: shift.providerPayCents,
      promoDiscountCents: discount,
      partnerDiscountCents: partnerDiscount,
      mileageCents: travel.mileageCents,
      lodgingEstimateCents: travel.lodgingEstimateCents,
      flyIn,
      airfareCents,
      clinicTotalCents: clinicTotal,
      providerTotalCents: providerTotal,
      // Fly-in: the airfare is collected in full with the deposit (flights are booked soon after).
      // Overdue payment rule: a pay-in-full clinic is charged the whole booking at confirmation.
      // Lodging is collected in full too, so the provider can have it before check-in (released when they reconfirm).
      depositCents: depositWithTravel({ clinicTotalCents: clinicTotal, airfareCents, lodgingCents: travel.lodgingEstimateCents, lodgingCreditCents: hold.creditCents, depositPercent: depositPercentFor(s["payments.depositPercent"], payInFull) }),
      lodgingCreditCents: hold.creditCents,
      flags: [UPFRONT_FLAG],
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
      amountCents: providerTotal - travel.lodgingEstimateCents,
      status: "PENDING",
    },
  });
  // Lodging is its own payout: an advance sent when the provider reconfirms (from 48 h before the start).
  await createLodgingAdvance(db, assignment, `${shift.startsAt.toISOString().slice(0, 10)} · ${shift.location.name}`, now);
  if (hold.refundCents > 0) effects.add(() => refundUnusedHold(shiftId, assignment.id, hold.refundCents));

  await db.messageThread.upsert({
    where: { clinicOrgId_providerId: { clinicOrgId: shift.location.clinicOrgId, providerId } },
    create: { clinicOrgId: shift.location.clinicOrgId, providerId, shiftId },
    update: { shiftId },
  });

  await audit(db, actor, "shift.confirmed", "Shift", shiftId, { status: shift.status }, { status: "CONFIRMED", providerId, method, assignmentId: assignment.id });

  effects.add(() => chargeDeposit(assignment.id));
  if (stayByClinic && !shift.lodgingStayDetails) {
    effects.add(async () => {
      const { prisma } = await import("@cm/db");
      await notifyClinic(prisma, shift.location.clinicOrgId, {
        template: "stay_details_needed",
        title: "Your provider needs a place to stay",
        body: `Your confirmed provider for ${shift.startsAt.toLocaleDateString("en-US", { timeZone: shift.location.timeZone, weekday: "short", month: "short", day: "numeric" })} lives far enough away to stay over, and you chose to book the stay. Add where they'll stay (${stayLabel(shift.lodgingStayKind)}) on the shift page.`,
        link: `/clinic/shifts/${shiftId}`,
        ctaLabel: "Add stay details",
      });
    });
  }
  // Booked inside the 48-hour window: the lodging advance goes out right after the deposit.
  if (travel.lodgingEstimateCents) effects.add(() => sendDueLodgingAdvance(assignment.id));
  effects.add(async () => {
    const { prisma } = await import("@cm/db");
    const date = shift.startsAt.toLocaleDateString("en-US", { timeZone: shift.location.timeZone, weekday: "short", month: "short", day: "numeric" });
    await notify(prisma, ev.provider.userId, {
      template: "shift_confirmed_provider",
      title: `You're confirmed: ${date} at ${shift.location.name}`,
      body: `You're booked for ${date} in ${shift.location.city}, ${shift.location.state}. Arrival notes and the on-site contact are on the shift page.${
        airfareCents
          ? ` This is a fly-in booking: book your flights after ${new Date(+now + s["flyIn.airfareRefundHours"] * 3_600_000).toLocaleString("en-US", { timeZone: shift.location.timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}, when the clinic's change window ends. Your $${(airfareCents / 100).toFixed(0)} airfare allowance is included in your pay.`
          : ""
      }${
        travel.lodgingEstimateCents
          ? ` Your $${(travel.lodgingEstimateCents / 100).toFixed(0)} lodging is paid in advance: we send it to your bank when you reconfirm, from 48 hours before the shift. The earlier you reconfirm, the more likely it's in your account before the hotel puts a hold on your card.`
          : stayByClinic
            ? ` The clinic books and pays for your stay (${stayLabel(shift.lodgingStayKind)}).${shift.lodgingStayDetails ? " Where you're staying is on the shift page." : " We'll let you know as soon as they add where you're staying."}`
            : ""
      }${idDue ? ` One step left: verify your ID (about 2 minutes, on your phone) by ${idDue.toLocaleString("en-US", { timeZone: shift.location.timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}, or this booking goes to another provider.` : ""}`,
      link: idDue ? "/provider/verify-id" : `/provider/assignments/${assignment.id}`,
      ctaLabel: "View shift details",
      // Standing-booking days are expected: in-app only (the daily/weekly digests list them).
      email: method !== "STANDING",
      sms: method !== "STANDING",
    });
    // A replacement after a cancellation or no-show gets the "we've found your replacement" email.
    const replaced = !!shift.emergencyAt || !!shift.rescueOfShiftId || (await prisma.assignment.count({ where: { shiftId, id: { not: assignment.id }, status: { in: ["CANCELLED", "NO_SHOW", "LICENSE_LAPSED"] } } })) > 0;
    const license = await prisma.license.findFirst({ where: { providerId, professionCode: shift.professionCode, status: "VERIFIED" }, orderBy: { state: "asc" } });
    const who = `${ev.provider.displayName}${license?.credentialTitle ? `, ${license.credentialTitle}` : ""}`;
    const arriveBy = new Date(+shift.startsAt - (await getSettings())["dispatch.arrivalBufferMinutes"] * 60_000).toLocaleTimeString("en-US", { timeZone: shift.location.timeZone, hour: "numeric", minute: "2-digit" });
    await notifyClinic(prisma, shift.location.clinicOrgId, replaced
      ? {
          template: "replacement_confirmed_clinic",
          title: `We've found your replacement: ${who}`,
          body: `Good news — ${who} is your new coverage provider for ${date} at ${shift.location.name}, arriving by about ${arriveBy}.`,
          details: [
            "Their license and malpractice coverage are verified, like every provider we send.",
            `You can view their profile and message them from the shift page. When they arrive, tap "Provider arrived".`,
          ],
          link: `/clinic/shifts/${shiftId}`,
          ctaLabel: "See your new provider",
          sms: true,
        }
      : {
          template: "shift_confirmed_clinic",
          title: `Coverage confirmed for ${date}`,
          body: `${who} is confirmed for ${shift.location.name}.`,
          link: `/clinic/shifts/${shiftId}`,
          ctaLabel: "View shift",
          // Days of a multi-day booking: in-app only; one "fully covered" email summarizes them.
          email: !shift.shiftGroupId && method !== "STANDING",
          sms: !shift.shiftGroupId && method !== "STANDING",
        });
    if (shift.shiftGroupId) {
      const { maybeSendBookingCovered } = await import("./bookings");
      await maybeSendBookingCovered(shiftId);
    }
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
