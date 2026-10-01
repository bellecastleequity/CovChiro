import { DomainError, dollars, normalizeReferralCode, personalCode, qualifiesAt, referralCodeFor, referralDecision, referrerDisplayName } from "@cm/core";
import { prisma, type Role } from "@cm/db";
import { audit, clock, getSettings, requireAdmin, SYSTEM, type Actor } from "./context";
import { absoluteUrl, notify, notifyAdmins } from "./notify";

/**
 * Referral program (core/referrals.ts has the rules).
 *  - Everyone gets a personal code and link /r/<code>. Signing up through it (or with the cm_ref
 *    cookie it sets) records a Referral for the new account.
 *  - Job referralSweep: once the invited person's first shift is done (provider: COMPLETED;
 *    clinic: COMPLETED and the balance paid) and referrals.holdDays have passed, both sides are
 *    rewarded. Clean ones pay automatically (referrals.autoPayClean); anything odd is FLAGGED for
 *    Admin → Referrals; self-referrals and banned accounts are REJECTED.
 *  - Providers are paid through the pay ledger (an ADJUSTMENT payout, sent by releaseDuePayouts,
 *    so Stripe Connect as usual). Clinics get a one-time "$ off" credit (FIXED PromoCode bound to
 *    their email) that applies itself to their next shift; like every promo it comes out of the
 *    platform margin, never provider pay.
 */

const CLINIC_ROLES: Role[] = ["CLINIC_OWNER", "CLINIC_STAFF"];
const kindOf = (role: Role) => (role === "PROVIDER" ? "provider" : CLINIC_ROLES.includes(role) ? "clinic" : null);

/** The user's code, created the first time it's needed. */
export async function referralCodeForUser(userId: string): Promise<string> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true, name: true } });
  if (u.referralCode) return u.referralCode;
  for (let i = 0; i < 8; i++) {
    const code = referralCodeFor(u.name);
    const taken = await prisma.user.findFirst({ where: { referralCode: code }, select: { id: true } });
    if (taken) continue;
    const r = await prisma.user.updateMany({ where: { id: userId, referralCode: null }, data: { referralCode: code } });
    if (r.count) return code;
    return (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true } })).referralCode!;
  }
  throw new Error("Couldn't make a unique referral code");
}

export const referralLink = (code: string) => absoluteUrl(`/r/${code}`);

/** Public: who an invitation is from (first name + last initial), for /r/<code> and the signup banner. */
export async function invitation(rawCode: string | null | undefined) {
  const code = normalizeReferralCode(rawCode);
  if (!code) return null;
  const s = await getSettings();
  if (!s["referrals.enabled"]) return null;
  const u = await prisma.user.findFirst({ where: { referralCode: code, disabledAt: null }, select: { name: true, role: true } });
  if (!u || !kindOf(u.role)) return null;
  return { code, from: referrerDisplayName(u.name), fromKind: kindOf(u.role)!, friendRewardCents: s["referrals.refereeRewardCents"], referrerRewardCents: s["referrals.referrerRewardCents"] };
}

/** Called by signup. Never throws: a bad or stale code just means no referral. */
export async function recordReferralSignup(refereeUserId: string, rawCode: string | null | undefined) {
  try {
    const code = normalizeReferralCode(rawCode);
    if (!code) return null;
    const s = await getSettings();
    if (!s["referrals.enabled"]) return null;
    const [referrer, referee] = await Promise.all([
      prisma.user.findFirst({ where: { referralCode: code, disabledAt: null } }),
      prisma.user.findUnique({ where: { id: refereeUserId } }),
    ]);
    if (!referrer || !referee || referrer.id === referee.id || !kindOf(referrer.role) || !kindOf(referee.role)) return null;
    const expiresAt = new Date(clock.now().getTime() + s["referrals.expiryMonths"] * 30 * 86_400_000);
    const row = await prisma.referral.upsert({ where: { refereeUserId }, create: { code, referrerUserId: referrer.id, refereeUserId, expiresAt }, update: {} });
    await audit(prisma, { userId: refereeUserId, role: referee.role }, "referral.signup", "Referral", row.id, null, { code, referrerUserId: referrer.id });
    await notify(prisma, referrer.id, {
      template: "referral_signup",
      title: `${referee.name.split(/\s+/)[0]} joined with your link`,
      body: `You'll get ${dollars(s["referrals.referrerRewardCents"])} once they complete their first ${kindOf(referee.role) === "clinic" ? "posted shift" : "shift"}. Keep sharing: there's no limit.`,
      link: kindOf(referrer.role) === "clinic" ? "/clinic/refer" : "/provider/refer",
      ctaLabel: "See your referrals",
    }).catch((e) => console.error("referral signup notice failed", e));
    return row;
  } catch (e) {
    console.error("recordReferralSignup failed", e);
    return null;
  }
}

/** The invited person's first finished shift, if any. */
async function firstShift(userId: string, role: Role) {
  if (role === "PROVIDER") {
    const p = await prisma.provider.findUnique({ where: { userId }, select: { id: true } });
    if (!p) return null;
    return prisma.assignment.findFirst({ where: { providerId: p.id, status: "COMPLETED" }, orderBy: { endsAt: "asc" }, select: { id: true, endsAt: true, _count: { select: { disputes: true } } } });
  }
  const orgIds = (await prisma.clinicMember.findMany({ where: { userId }, select: { clinicOrgId: true } })).map((m) => m.clinicOrgId);
  if (!orgIds.length) return null;
  return prisma.assignment.findFirst({
    where: { status: "COMPLETED", shift: { location: { clinicOrgId: { in: orgIds } } }, payments: { some: { type: "BALANCE", status: "SUCCEEDED" } } },
    orderBy: { endsAt: "asc" },
    select: { id: true, endsAt: true, _count: { select: { disputes: true } } },
  });
}

async function accountState(userId: string, role: Role) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true, disabledAt: true } });
  let suspended = false;
  let disabled = !!u.disabledAt;
  if (role === "PROVIDER") {
    const p = await prisma.provider.findUnique({ where: { userId }, select: { status: true } });
    suspended = p?.status === "SUSPENDED";
    disabled ||= p?.status === "DEACTIVATED";
  } else {
    const orgs = await prisma.clinicOrg.findMany({ where: { members: { some: { userId } } }, select: { status: true } });
    suspended = orgs.some((o) => o.status === "SUSPENDED");
    disabled ||= orgs.length > 0 && orgs.every((o) => o.status === "DEACTIVATED");
  }
  return { userId, phone: u.phone, disabled, suspended };
}

/** Job (hourly): expire stale invitations; reward, flag or reject the ones whose first shift is done. */
export async function referralSweep(now = clock.now()) {
  const s = await getSettings();
  const expired = await prisma.referral.updateMany({ where: { status: "PENDING", expiresAt: { lt: now } }, data: { status: "EXPIRED" } });
  const pending = await prisma.referral.findMany({ where: { status: "PENDING" }, include: { referrer: true, referee: true }, take: 500 });
  let rewarded = 0;
  let flagged = 0;
  let rejected = 0;
  for (const r of pending) {
    const shift = await firstShift(r.refereeUserId, r.referee.role);
    if (!shift || qualifiesAt(shift.endsAt, s["referrals.holdDays"]) > now) continue;
    const flaggedAsSpam = (await prisma.auditLog.count({ where: { action: "user.signup_flagged", entityId: r.refereeUserId } })) > 0;
    const { decision, reasons } = referralDecision({
      referrer: await accountState(r.referrerUserId, r.referrer.role),
      referee: { ...(await accountState(r.refereeUserId, r.referee.role)), flaggedAsSpam },
      qualifyingShiftDisputed: shift._count.disputes > 0,
    });
    const base = { qualifyingAssignmentId: shift.id, qualifiedAt: now, flagReasons: reasons };
    if (decision === "reject") {
      await prisma.referral.update({ where: { id: r.id }, data: { ...base, status: "REJECTED", note: reasons.join(", ") } });
      rejected++;
    } else if (decision === "flag" || !s["referrals.autoPayClean"]) {
      await prisma.referral.update({ where: { id: r.id }, data: { ...base, status: "FLAGGED", flagReasons: decision === "flag" ? reasons : ["waiting for approval (automatic payment is off)"] } });
      flagged++;
      if (decision === "flag") {
        await notifyAdmins(prisma, { template: "referral_flagged", title: `Referral reward needs a look: ${r.referee.name}`, body: `Invited by ${r.referrer.name}. ${reasons.join(", ")}.`, link: "/admin/referrals?status=FLAGGED", ctaLabel: "Review" }).catch(() => undefined);
      }
    } else {
      await prisma.referral.update({ where: { id: r.id }, data: base });
      await payReferral(SYSTEM, r.id);
      rewarded++;
    }
  }
  return { expired: expired.count, rewarded, flagged, rejected };
}

/** Give one side its reward. Providers: pay-ledger payout. Clinics: one-time credit toward their next shift. */
async function grant(userId: string, role: Role, cents: number, why: string, referralId: string) {
  if (cents <= 0) return {};
  const s = await getSettings();
  if (role === "PROVIDER") {
    const p = await prisma.provider.findUnique({ where: { userId }, select: { id: true } });
    if (!p) return {};
    const payout = await prisma.payout.create({ data: { providerId: p.id, kind: "ADJUSTMENT", description: why.slice(0, 300), amountCents: cents, status: "SCHEDULED", releaseAt: clock.now() } });
    return { payoutId: payout.id };
  }
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
  for (let i = 0; i < 6; i++) {
    const code = personalCode("CREDIT");
    if (await prisma.promoCode.findUnique({ where: { code } })) continue;
    await prisma.promoCode.create({
      data: {
        code, kind: "FIXED", value: cents, description: `Referral credit (${referralId})`, assignedEmail: u.email, maxUses: 1, maxUsesPerClinic: 1,
        expiresAt: new Date(clock.now().getTime() + s["referrals.creditExpiryDays"] * 86_400_000),
      },
    });
    return { creditCode: code };
  }
  throw new Error("Couldn't make a unique credit code");
}

/** Pay both sides once. Safe to call twice: the status flip happens first and only one caller wins. */
export async function payReferral(actor: Actor, id: string) {
  const s = await getSettings();
  const claimed = await prisma.referral.updateMany({ where: { id, status: { in: ["PENDING", "FLAGGED"] }, qualifiedAt: { not: null } }, data: { status: "REWARDED", rewardedAt: clock.now(), decidedById: actor.userId } });
  if (!claimed.count) return null;
  const r = await prisma.referral.findUniqueOrThrow({ where: { id }, include: { referrer: true, referee: true } });
  const refereeFirst = r.referee.name.split(/\s+/)[0];
  const referrerAmount = s["referrals.referrerRewardCents"];
  const refereeAmount = s["referrals.refereeRewardCents"];
  const a = await grant(r.referrerUserId, r.referrer.role, referrerAmount, `Referral bonus: ${r.referee.name} completed their first shift`, r.id);
  const b = await grant(r.refereeUserId, r.referee.role, refereeAmount, `Welcome bonus: your first shift (invited by ${referrerDisplayName(r.referrer.name)})`, r.id);
  await prisma.referral.update({
    where: { id },
    data: {
      referrerRewardCents: a.payoutId || a.creditCode ? referrerAmount : 0, refereeRewardCents: b.payoutId || b.creditCode ? refereeAmount : 0,
      referrerPayoutId: a.payoutId ?? null, refereePayoutId: b.payoutId ?? null, referrerCreditCode: a.creditCode ?? null, refereeCreditCode: b.creditCode ?? null,
    },
  });
  await audit(prisma, actor, "referral.rewarded", "Referral", id, null, { referrer: a, referee: b, referrerAmount, refereeAmount });
  const tell = async (userId: string, role: Role, cents: number, g: { payoutId?: string; creditCode?: string }, title: string) => {
    if (!g.payoutId && !g.creditCode) return;
    const clinic = !!g.creditCode;
    await notify(prisma, userId, {
      template: "referral_reward",
      title,
      body: clinic
        ? `A ${dollars(cents)} credit (code ${g.creditCode}) comes off your next shift automatically.`
        : `${dollars(cents)} has been added to your pay and goes out with your next payment through Stripe.`,
      link: clinic ? "/clinic/refer" : "/provider/earnings",
      ctaLabel: clinic ? "Refer another clinic or provider" : "View earnings",
    }).catch((e) => console.error("referral reward notice failed", e));
  };
  await tell(r.referrerUserId, r.referrer.role, referrerAmount, a, `You earned ${dollars(referrerAmount)}: ${refereeFirst} completed their first shift`);
  await tell(r.refereeUserId, r.referee.role, refereeAmount, b, `Your ${dollars(refereeAmount)} welcome bonus is here`);
  return { referrer: a, referee: b };
}

export async function approveReferral(actor: Actor, id: string) {
  requireAdmin(actor);
  const r = await payReferral(actor, id);
  if (!r) throw new DomainError("CONFLICT", "This referral isn't waiting for approval.");
  return r;
}

export async function rejectReferral(actor: Actor, id: string, note: string) {
  requireAdmin(actor);
  const r = await prisma.referral.updateMany({ where: { id, status: { in: ["PENDING", "FLAGGED"] } }, data: { status: "REJECTED", note: note.trim().slice(0, 500) || "Rejected", decidedById: actor.userId } });
  if (!r.count) throw new DomainError("CONFLICT", "Only pending or flagged referrals can be rejected.");
  await audit(prisma, actor, "referral.rejected", "Referral", id, null, { note });
}

/** Admin queue. */
export async function referralQueue(actor: Actor, status?: string) {
  requireAdmin(actor);
  const [rows, counts, paid] = await Promise.all([
    prisma.referral.findMany({
      where: status ? { status } : {},
      include: { referrer: { select: { name: true, email: true, role: true } }, referee: { select: { name: true, email: true, role: true } } },
      orderBy: [{ updatedAt: "desc" }],
      take: 300,
    }),
    prisma.referral.groupBy({ by: ["status"], _count: true }),
    prisma.referral.aggregate({ where: { status: "REWARDED" }, _sum: { referrerRewardCents: true, refereeRewardCents: true } }),
  ]);
  return {
    rows,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) as Record<string, number>,
    paidCents: (paid._sum.referrerRewardCents ?? 0) + (paid._sum.refereeRewardCents ?? 0),
  };
}

/** The Refer & earn page for a provider or clinic user. */
export async function myReferrals(userId: string) {
  const s = await getSettings();
  const code = await referralCodeForUser(userId);
  const rows = await prisma.referral.findMany({ where: { referrerUserId: userId }, include: { referee: { select: { name: true, role: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
  const earned = rows.filter((r) => r.status === "REWARDED").reduce((a, r) => a + r.referrerRewardCents, 0);
  return {
    enabled: s["referrals.enabled"],
    code,
    link: referralLink(code),
    referrerRewardCents: s["referrals.referrerRewardCents"],
    friendRewardCents: s["referrals.refereeRewardCents"],
    earnedCents: earned,
    joined: rows.length,
    waiting: rows.filter((r) => r.status === "PENDING" || r.status === "FLAGGED").length,
    rows: rows.map((r) => ({ id: r.id, name: referrerDisplayName(r.referee.name), kind: kindOf(r.referee.role), status: r.status, rewardCents: r.referrerRewardCents, createdAt: r.createdAt })),
  };
}

/** A clinic's unused referral credit, applied to its next shift when no other code is entered. */
export async function referralCreditFor(clinicOrgId: string, now = clock.now()): Promise<string | null> {
  const members = await prisma.clinicMember.findMany({ where: { clinicOrgId }, select: { userId: true } });
  if (!members.length) return null;
  const ids = members.map((m) => m.userId);
  const refs = await prisma.referral.findMany({
    where: { status: "REWARDED", OR: [{ referrerUserId: { in: ids }, referrerCreditCode: { not: null } }, { refereeUserId: { in: ids }, refereeCreditCode: { not: null } }] },
    select: { referrerUserId: true, referrerCreditCode: true, refereeCreditCode: true },
  });
  const codes = refs.map((r) => (ids.includes(r.referrerUserId) ? r.referrerCreditCode : r.refereeCreditCode)).filter((c): c is string => !!c);
  if (!codes.length) return null;
  const promo = await prisma.promoCode.findFirst({
    where: { code: { in: codes }, active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], redemptions: { none: { clinicOrgId, voidedAt: null } } },
    orderBy: { expiresAt: "asc" },
  });
  return promo && (promo.maxUses === null || promo.usedCount < promo.maxUses) ? promo.code : null;
}
