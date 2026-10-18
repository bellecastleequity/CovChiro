import { addressKey, DomainError, normalizeUsPhone, welcomeCounts, welcomeStage, type WelcomeCounts } from "@cm/core";
import { prisma, Prisma, type WelcomeEntitlement } from "@cm/db";
import { audit, clock, getSettings, requireAdmin, requireClinic, type Actor, type Db } from "./context";
import { notifyAdmins, notifyClinic } from "./notify";

/**
 * Welcome Discount (owner spec Oct 2026, docs/specs/welcome-discount.md): every clinic business has one
 * permanent entitlement (WelcomeEntitlement, shared by all its logins) to a percentage off the base rate of
 * its first N completed bookings. No code, no expiration, never removed by a settings change.
 *
 * Lifecycle per booking (WelcomeRedemption, one per shift): pricing (pricing.quoteShift) puts the discount
 * on a shift while one is available; confirmation reserves it (reserveInTx, under a row lock so the total
 * can never be exceeded) or drops it if the last one went to another booking; completion redeems it
 * (welcomeSweep); a cancellation or a booking that wasn't delivered releases it (releaseInTx), and a
 * replacement provider's confirmation reserves it again. Provider pay is never touched.
 */

const OPEN_SHIFT: Prisma.ShiftWhereInput["status"] = { notIn: ["DRAFT", "CANCELLED", "UNFILLED", "COMPLETED"] };

/** The clinic's entitlement, created on first need while new enrollment is on (null when off and none yet). */
export async function ensureEntitlement(db: Db, clinicOrgId: string): Promise<WelcomeEntitlement | null> {
  const existing = await db.welcomeEntitlement.findUnique({ where: { clinicOrgId } });
  if (existing) return existing;
  const s = await getSettings(db);
  if (!s["welcome.enabled"]) return null;
  const prior = await db.assignment.count({ where: { status: "COMPLETED", shift: { location: { clinicOrgId } } } });
  return db.welcomeEntitlement.upsert({
    where: { clinicOrgId },
    create: { clinicOrgId, percent: s["welcome.percent"], totalBookings: s["welcome.bookings"], priorCompleted: Math.min(prior, s["welcome.bookings"]) },
    update: {},
  });
}

/**
 * Another clinic account for the same business (same phone, or a location at the same street address)
 * that has already used Welcome Discounts or completed bookings: the offer waits for an admin.
 */
async function sameBusinessUsedIt(db: Db, clinicOrgId: string): Promise<string | null> {
  const org = await db.clinicOrg.findUnique({ where: { id: clinicOrgId }, select: { phone: true, backupPhone: true, locations: { select: { addressLine1: true, zip: true } } } });
  if (!org) return null;
  const phones = [org.phone, org.backupPhone].map((p) => normalizeUsPhone(p)).filter((p): p is string => !!p);
  const keys = new Set(org.locations.map((l) => addressKey(l.addressLine1, l.zip)));
  const others = await db.clinicOrg.findMany({
    where: {
      id: { not: clinicOrgId },
      OR: [
        ...(phones.length ? [{ phone: { in: phones } }, { backupPhone: { in: phones } }] : []),
        ...(org.locations.length ? [{ locations: { some: { zip: { in: org.locations.map((l) => l.zip) } } } }] : []),
      ],
    },
    select: { id: true, displayName: true, phone: true, backupPhone: true, locations: { select: { addressLine1: true, zip: true } }, welcomeEntitlement: { select: { priorCompleted: true, _count: { select: { redemptions: { where: { status: { in: ["RESERVED", "REDEEMED"] } } } } } } } },
    take: 50,
  });
  for (const o of others) {
    const samePhone = [o.phone, o.backupPhone].some((p) => p && phones.includes(normalizeUsPhone(p) ?? ""));
    const sameAddress = o.locations.some((l) => keys.has(addressKey(l.addressLine1, l.zip)));
    if (!samePhone && !sameAddress) continue;
    const used = (o.welcomeEntitlement?.priorCompleted ?? 0) + (o.welcomeEntitlement?._count.redemptions ?? 0) > 0 || (await db.assignment.count({ where: { status: "COMPLETED", shift: { location: { clinicOrgId: o.id } } } })) > 0;
    if (used) return `Shares a ${samePhone ? "phone number" : "street address"} with ${o.displayName}, which has already booked through us.`;
  }
  return null;
}

export interface WelcomeState {
  entitlement: WelcomeEntitlement;
  counts: WelcomeCounts;
  /** A new booking would get the discount now. */
  canUse: boolean;
}

/** The clinic's current position: used, reserved, pending and available (excludeShiftId = the shift being priced). */
export async function welcomeState(db: Db, clinicOrgId: string, opts: { excludeShiftId?: string } = {}): Promise<WelcomeState | null> {
  let ent = await ensureEntitlement(db, clinicOrgId);
  if (!ent) return null;
  const [byStatus, open, held] = await Promise.all([
    db.welcomeRedemption.groupBy({ by: ["status"], where: { entitlementId: ent.id, ...(opts.excludeShiftId ? { shiftId: { not: opts.excludeShiftId } } : {}) }, _count: { _all: true } }),
    // Posted shifts already priced with the discount (each will need one when it's booked).
    db.shift.findMany({ where: { location: { clinicOrgId }, welcomeDiscountCents: { gt: 0 }, status: OPEN_SHIFT, ...(opts.excludeShiftId ? { id: { not: opts.excludeShiftId } } : {}) }, select: { id: true } }),
    db.welcomeRedemption.findMany({ where: { entitlementId: ent.id, status: { in: ["RESERVED", "REDEEMED"] } }, select: { shiftId: true } }),
  ]);
  const heldIds = new Set(held.map((h) => h.shiftId));
  const pending = open.filter((o) => !heldIds.has(o.id)).length;
  const n = (st: string) => byStatus.find((b) => b.status === st)?._count._all ?? 0;
  const counts = welcomeCounts({ total: ent.totalBookings, priorCompleted: ent.priorCompleted, reserved: n("RESERVED"), redeemed: n("REDEEMED"), pending });
  // A brand-new clinic that looks like a business that already booked with us waits for an admin.
  if (ent.status === "ACTIVE" && counts.used === 0 && counts.reserved === 0 && !ent.reviewReason?.startsWith("Approved")) {
    const why = await sameBusinessUsedIt(db, clinicOrgId);
    if (why) {
      ent = await db.welcomeEntitlement.update({ where: { id: ent.id }, data: { status: "REVIEW", reviewReason: why } });
      await notifyAdmins(prisma, { template: "welcome_review", title: "Welcome Discount waiting for review", body: why, link: `/admin/clinics/${clinicOrgId}#welcome`, ctaLabel: "Review" }).catch(() => undefined);
    }
  }
  return { entitlement: ent, counts, canUse: ent.status === "ACTIVE" && counts.available > 0 };
}

/**
 * Confirmation: hold one discount for this shift's booking. Returns the discount kept (0 when the clinic
 * has none left; the caller then charges the standard price). Must run inside the confirmation transaction.
 */
export async function reserveInTx(db: Db, shift: { id: string; welcomeDiscountCents: number; clinicPriceCents: number; clinicOrgId: string }, assignmentId: string | null, now: Date): Promise<number> {
  if (shift.welcomeDiscountCents <= 0) return 0;
  const ent = await db.welcomeEntitlement.findUnique({ where: { clinicOrgId: shift.clinicOrgId } });
  if (!ent) return 0;
  await db.$queryRaw(Prisma.sql`SELECT id FROM "WelcomeEntitlement" WHERE id = ${ent.id} FOR UPDATE`);
  const held = await db.welcomeRedemption.count({ where: { entitlementId: ent.id, status: { in: ["RESERVED", "REDEEMED"] }, shiftId: { not: shift.id } } });
  if (ent.status !== "ACTIVE" || ent.priorCompleted + held >= ent.totalBookings) return 0;
  const data = { assignmentId, status: "RESERVED", discountCents: shift.welcomeDiscountCents, standardCents: shift.clinicPriceCents, reservedAt: now, releasedAt: null, releaseReason: null };
  await db.welcomeRedemption.upsert({ where: { shiftId: shift.id }, create: { ...data, entitlementId: ent.id, clinicOrgId: shift.clinicOrgId, shiftId: shift.id }, update: data });
  return shift.welcomeDiscountCents;
}

/** A booking was cancelled or not delivered: the discount is available again (idempotent). */
export async function releaseInTx(db: Db, shiftId: string, reason: string, now: Date) {
  await db.welcomeRedemption.updateMany({ where: { shiftId, status: "RESERVED" }, data: { status: "RELEASED", releasedAt: now, releaseReason: reason.slice(0, 200) } });
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

/** One line about the discount for the clinic's booking confirmation. */
export async function confirmationLines(clinicOrgId: string, shift: { clinicPriceCents: number; welcomeDiscountCents: number }): Promise<string[]> {
  if (shift.welcomeDiscountCents <= 0) return [];
  const st = await welcomeState(prisma, clinicOrgId);
  if (!st) return [];
  const pct = st.entitlement.percent;
  const leftAfter = Math.max(0, st.counts.remaining - 1);
  return [
    `Standard coverage rate ${money(shift.clinicPriceCents)} · Welcome Discount (${pct}%) −${money(shift.welcomeDiscountCents)} · Coverage total ${money(shift.clinicPriceCents - shift.welcomeDiscountCents)} (travel, if any, is separate).`,
    `Your Welcome Discount is reserved for this booking and counts as used when the shift is completed. Welcome bookings left after this one: ${leftAfter}.`,
  ];
}

const STAGE_MAIL = {
  TWO_LEFT: (n: number, pct: number) => ({ title: `You still have ${n} Welcome Discounts available`, body: `Thank you for completing your first coverage booking with us. Your clinic still has ${n} ${pct}% Welcome Discounts, and they never expire, so book your next coverage day whenever you need it.`, cta: "Book your next coverage day" }),
  ONE_LEFT: (_n: number, pct: number) => ({ title: `Your final ${pct}% Welcome Discount is ready`, body: `Your clinic has completed two introductory bookings. You have one ${pct}% Welcome Discount left. There's no expiration date: it's ready whenever your practice needs its next coverage booking.`, cta: "Book coverage" }),
  DONE: () => ({ title: "Thank you for your first coverage bookings", body: "Your Welcome Discount has now been fully used. Your clinic can keep booking coverage at our standard rates, with your booking history and account features all in place.", cta: "Book coverage" }),
} as const;

async function onceKey(key: string, userId: string) {
  return (await prisma.digestSend.createMany({ data: [{ key, userId }], skipDuplicates: true })).count === 1;
}

/** The welcome email for a new clinic (once). */
export async function sendWelcomeEmail(clinicOrgId: string) {
  const st = await welcomeState(prisma, clinicOrgId);
  if (!st || st.counts.remaining <= 0 || st.entitlement.status !== "ACTIVE") return;
  if (!(await onceKey(`welcome:${clinicOrgId}:ready`, clinicOrgId))) return;
  const { percent: pct } = st.entitlement;
  await notifyClinic(prisma, clinicOrgId, {
    template: "welcome_discount_ready",
    title: `Welcome! Your ${pct}% discount is ready`,
    body: `Your clinic gets ${pct}% off its first ${st.entitlement.totalBookings} coverage bookings. It's applied automatically when you post a shift: no promo code, and it never expires.`,
    details: [`You have ${st.counts.remaining} Welcome booking${st.counts.remaining === 1 ? "" : "s"} remaining.`],
    link: "/clinic/shifts/new", ctaLabel: "Book coverage", sms: false,
  });
}

/**
 * Every 15 minutes: completed bookings redeem their reserved discount (and the clinic hears how many
 * are left); a reserved discount whose booking was cancelled or not delivered is released (safety net
 * for the cancel paths, which release it themselves).
 */
export async function welcomeSweep() {
  const now = clock.now();
  const out = { redeemed: 0, released: 0 };
  const rows = await prisma.welcomeRedemption.findMany({ where: { status: "RESERVED", assignmentId: { not: null } }, take: 500 });
  if (!rows.length) return out;
  const assignments = await prisma.assignment.findMany({ where: { id: { in: rows.map((r) => r.assignmentId!) } }, select: { id: true, status: true } });
  const statusOf = new Map(assignments.map((a) => [a.id, a.status]));
  for (const r of rows) {
    const st = statusOf.get(r.assignmentId!);
    if (st === "COMPLETED") {
      const done = await prisma.welcomeRedemption.updateMany({ where: { id: r.id, status: "RESERVED" }, data: { status: "REDEEMED", redeemedAt: now } });
      if (!done.count) continue;
      out.redeemed++;
      await audit(prisma, SYSTEM_ACTOR, "welcome.redeemed", "WelcomeRedemption", r.id, null, { shiftId: r.shiftId, discountCents: r.discountCents });
      const state = await welcomeState(prisma, r.clinicOrgId);
      if (!state) continue;
      const stage = welcomeStage(state.counts);
      if (stage === "NEW") continue;
      if (!(await onceKey(`welcome:${r.clinicOrgId}:used:${state.counts.used}`, r.clinicOrgId))) continue;
      const m = STAGE_MAIL[stage](state.counts.remaining, state.entitlement.percent);
      await notifyClinic(prisma, r.clinicOrgId, { template: "welcome_discount_used", title: m.title, body: m.body, link: "/clinic/shifts/new", ctaLabel: m.cta, sms: false });
    } else if (st && ["CANCELLED", "NO_SHOW", "LICENSE_LAPSED"].includes(st)) {
      const done = await prisma.welcomeRedemption.updateMany({ where: { id: r.id, status: "RESERVED", assignmentId: r.assignmentId }, data: { status: "RELEASED", releasedAt: now, releaseReason: `Booking ${st.toLowerCase().replace("_", " ")}` } });
      if (done.count) out.released++;
    }
  }
  return out;
}

const SYSTEM_ACTOR: Actor = { userId: null, role: "PLATFORM_ADMIN" };

// ---------------- clinic dashboard ----------------

export async function clinicWelcome(actor: Actor) {
  const orgId = requireClinic(actor);
  const st = await welcomeState(prisma, orgId);
  if (!st) return null;
  const rows = await prisma.welcomeRedemption.findMany({ where: { entitlementId: st.entitlement.id, status: { in: ["RESERVED", "REDEEMED"] } }, orderBy: { reservedAt: "asc" } });
  const shifts = await prisma.shift.findMany({ where: { id: { in: rows.map((r) => r.shiftId) } }, select: { id: true, startsAt: true, location: { select: { timeZone: true } } } });
  const when = new Map(shifts.map((s) => [s.id, s]));
  const slots = Array.from({ length: st.entitlement.totalBookings }, (_, i) => {
    if (i < st.entitlement.priorCompleted) return { n: i + 1, status: "USED" as const, shiftId: null, startsAt: null, timeZone: null, savedCents: 0 };
    const r = rows[i - st.entitlement.priorCompleted];
    if (!r) return { n: i + 1, status: "AVAILABLE" as const, shiftId: null, startsAt: null, timeZone: null, savedCents: 0 };
    const sh = when.get(r.shiftId);
    return { n: i + 1, status: r.status === "REDEEMED" ? ("USED" as const) : ("RESERVED" as const), shiftId: r.shiftId, startsAt: sh?.startsAt ?? null, timeZone: sh?.location.timeZone ?? null, savedCents: r.discountCents };
  });
  return {
    percent: st.entitlement.percent, total: st.entitlement.totalBookings, status: st.entitlement.status, counts: st.counts, stage: welcomeStage(st.counts), slots,
    savedCents: rows.filter((r) => r.status === "REDEEMED").reduce((a, r) => a + r.discountCents, 0),
  };
}

// ---------------- admin ----------------

export async function adminClinicWelcome(actor: Actor, clinicOrgId: string) {
  requireAdmin(actor);
  const st = await welcomeState(prisma, clinicOrgId);
  if (!st) return null;
  const rows = await prisma.welcomeRedemption.findMany({ where: { entitlementId: st.entitlement.id }, orderBy: { reservedAt: "desc" }, take: 50 });
  const disputes = await prisma.chargeDispute.findMany({ where: { assignmentId: { in: rows.map((r) => r.assignmentId).filter((x): x is string => !!x) } }, select: { assignmentId: true } });
  const disputed = new Set(disputes.map((d) => d.assignmentId));
  return { ...st, rows: rows.map((r) => ({ ...r, disputed: !!r.assignmentId && disputed.has(r.assignmentId) })) };
}

/** Documented admin exceptions; every one is in the audit log with its note. */
export async function adminAdjust(actor: Actor, clinicOrgId: string, input: { op: "approve" | "add" | "restore" | "note"; note: string; redemptionId?: string }) {
  requireAdmin(actor);
  const note = input.note.trim();
  if (note.length < 3) throw new DomainError("VALIDATION", "Add a short note saying why.");
  const ent = await ensureEntitlement(prisma, clinicOrgId);
  if (!ent) throw new DomainError("VALIDATION", "This clinic has no Welcome Discount (new enrollment is off in Settings).");
  const now = clock.now();
  if (input.op === "approve") {
    await prisma.welcomeEntitlement.update({ where: { id: ent.id }, data: { status: "ACTIVE", reviewReason: `Approved: ${note}`.slice(0, 300) } });
  } else if (input.op === "add") {
    await prisma.welcomeEntitlement.update({ where: { id: ent.id }, data: { totalBookings: { increment: 1 }, note: [ent.note, `+1 booking (${now.toISOString().slice(0, 10)}): ${note}`].filter(Boolean).join("\n").slice(0, 2000) } });
  } else if (input.op === "restore") {
    const r = await prisma.welcomeRedemption.findFirst({ where: { id: input.redemptionId, entitlementId: ent.id, status: "REDEEMED" } });
    if (!r) throw new DomainError("NOT_FOUND", "Only a used discount can be restored.");
    await prisma.welcomeRedemption.update({ where: { id: r.id }, data: { status: "RELEASED", releasedAt: now, releaseReason: `Restored by an admin: ${note}`.slice(0, 200) } });
  } else {
    await prisma.welcomeEntitlement.update({ where: { id: ent.id }, data: { note: [ent.note, `${now.toISOString().slice(0, 10)}: ${note}`].filter(Boolean).join("\n").slice(0, 2000) } });
  }
  await audit(prisma, actor, `welcome.${input.op}`, "WelcomeEntitlement", ent.id, null, { note, redemptionId: input.redemptionId ?? null });
}

/** Admin → Welcome Discount: who has what, what it cost, and whether clinics come back at standard rates. */
export async function welcomeReport(actor: Actor) {
  requireAdmin(actor);
  const s = await getSettings();
  const ents = await prisma.welcomeEntitlement.findMany({ include: { redemptions: true, clinicOrg: { select: { id: true, displayName: true, createdAt: true } } } });
  const orgIds = ents.map((e) => e.clinicOrgId);
  const completed = await prisma.assignment.findMany({
    where: { status: "COMPLETED", shift: { location: { clinicOrgId: { in: orgIds } } } },
    select: { shiftId: true, startsAt: true, clinicTotalCents: true, providerTotalCents: true, mileageCents: true, lodgingEstimateCents: true, airfareCents: true, clinicPriceCents: true, providerPayCents: true, promoDiscountCents: true, shift: { select: { location: { select: { clinicOrgId: true } } } } },
    orderBy: { startsAt: "asc" },
  });
  const byOrg = new Map<string, typeof completed>();
  for (const a of completed) byOrg.set(a.shift.location.clinicOrgId, [...(byOrg.get(a.shift.location.clinicOrgId) ?? []), a]);
  const redeemedShift = new Set(ents.flatMap((e) => e.redemptions.filter((r) => r.status === "REDEEMED").map((r) => r.shiftId)));
  const avail = { 3: 0, 2: 0, 1: 0, 0: 0 } as Record<number, number>;
  let reserved = 0, redeemed = 0, review = 0;
  for (const e of ents) {
    const c = welcomeCounts({ total: e.totalBookings, priorCompleted: e.priorCompleted, reserved: e.redemptions.filter((r) => r.status === "RESERVED").length, redeemed: e.redemptions.filter((r) => r.status === "REDEEMED").length, pending: 0 });
    avail[Math.min(3, Math.max(0, c.remaining))]++;
    reserved += c.reserved;
    redeemed += e.redemptions.filter((r) => r.status === "REDEEMED").length;
    if (e.status === "REVIEW") review++;
  }
  // Card fees estimate (Stripe's standard U.S. card pricing): shown as an estimate.
  const fee = (cents: number) => Math.round(cents * 0.029) + 30;
  const promo = completed.filter((a) => redeemedShift.has(a.shiftId));
  const standard = completed.filter((a) => !redeemedShift.has(a.shiftId));
  const sum = (xs: typeof completed, f: (a: (typeof completed)[number]) => number) => xs.reduce((t, a) => t + f(a), 0);
  const coverage = (a: (typeof completed)[number]) => a.clinicPriceCents - a.promoDiscountCents;
  const econ = (xs: typeof completed) => {
    const clinic = sum(xs, coverage), provider = sum(xs, (a) => a.providerPayCents), fees = sum(xs, (a) => fee(a.clinicTotalCents));
    return { bookings: xs.length, clinicCents: clinic, providerCents: provider, spreadCents: clinic - provider, feesCents: fees, contributionCents: clinic - provider - fees, avgCents: xs.length ? Math.round(clinic / xs.length) : 0 };
  };
  const discountsFunded = ents.reduce((t, e) => t + e.redemptions.filter((r) => r.status === "REDEEMED").reduce((x, r) => x + r.discountCents, 0), 0);
  // Retention: how many clinics reached their 2nd, 3rd and 4th completed booking; repeat within 30/60/90 days of the first.
  const counts = [...byOrg.values()].map((xs) => xs.length);
  const reached = (n: number) => counts.filter((c) => c >= n).length;
  const firstGaps = [...byOrg.values()].filter((xs) => xs.length >= 2).map((xs) => (+xs[1].startsAt - +xs[0].startsAt) / 86_400_000);
  const within = (d: number) => [...byOrg.values()].filter((xs) => xs.length >= 2 && (+xs[1].startsAt - +xs[0].startsAt) / 86_400_000 <= d).length;
  const allGaps = [...byOrg.values()].flatMap((xs) => xs.slice(1).map((a, i) => (+a.startsAt - +xs[i].startsAt) / 86_400_000));
  // Revenue after the introductory bookings: completed bookings beyond each clinic's discounted ones.
  const afterIntro = [...byOrg.entries()].flatMap(([orgId, xs]) => {
    const e = ents.find((x) => x.clinicOrgId === orgId)!;
    return xs.filter((_, i) => i >= e.totalBookings);
  });
  return {
    settings: { enabled: s["welcome.enabled"], percent: s["welcome.percent"], bookings: s["welcome.bookings"], minContributionCents: s["welcome.minContributionCents"] },
    clinics: ents.length, review, available: avail, reserved, redeemed, discountsFundedCents: discountsFunded,
    promo: econ(promo), standard: econ(standard), afterIntro: econ(afterIntro),
    retention: { first: reached(1), second: reached(2), third: reached(3), fourth: reached(4), repeat30: within(30), repeat60: within(60), repeat90: within(90), avgDaysBetween: allGaps.length ? Math.round(allGaps.reduce((a, b) => a + b, 0) / allGaps.length) : null, avgDaysToSecond: firstGaps.length ? Math.round(firstGaps.reduce((a, b) => a + b, 0) / firstGaps.length) : null },
    lifetimeAvgCents: byOrg.size ? Math.round(sum(completed, coverage) / byOrg.size) : 0,
    rows: ents
      .map((e) => ({ id: e.clinicOrgId, name: e.clinicOrg.displayName, status: e.status, total: e.totalBookings, used: Math.min(e.totalBookings, e.priorCompleted + e.redemptions.filter((r) => r.status === "REDEEMED").length), reserved: e.redemptions.filter((r) => r.status === "RESERVED").length, savedCents: e.redemptions.filter((r) => r.status === "REDEEMED").reduce((x, r) => x + r.discountCents, 0), completedBookings: byOrg.get(e.clinicOrgId)?.length ?? 0 }))
      .sort((a, b) => b.completedBookings - a.completedBookings || a.name.localeCompare(b.name)),
  };
}
