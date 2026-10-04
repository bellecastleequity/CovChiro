import { randomUUID } from "node:crypto";
import {
  clinicRewardEvents,
  DEFAULT_REWARD_POINTS,
  DomainError,
  providerRewardEvents,
  REWARD_RULES,
  rewardLevel,
  type RewardAudience,
  type RewardEventDraft,
} from "@cm/core";
import { prisma } from "@cm/db";
import { audit, clock, getSettings, requireAdmin, requireClinic, requireProvider, type Actor } from "./context";
import { notify, notifyClinic } from "./notify";

/**
 * Rewards (points and levels) for providers and clinics. core/rewards.ts decides which events an
 * account has earned from its facts; this file gathers the facts and writes RewardEvent rows
 * (refKey unique, so syncing again never double-counts). Synced when a provider's onboarding
 * changes (recomputeProviderStatus), when someone opens their Rewards page or dashboard, and by
 * job rewardsSweep for recently active accounts. Points are a loyalty yardstick, never money.
 */

async function config() {
  const s = await getSettings();
  return {
    s,
    enabled: s["rewards.enabled"],
    points: { ...DEFAULT_REWARD_POINTS, ...s["rewards.points"] },
    levels: s["rewards.levels"],
  };
}

const total = async (accountType: RewardAudience, accountId: string) =>
  (await prisma.rewardEvent.aggregate({ where: { accountType, accountId }, _sum: { points: true } }))._sum.points ?? 0;

async function write(accountType: RewardAudience, accountId: string, drafts: RewardEventDraft[], tellLevelUp: (level: string) => Promise<void>) {
  if (!drafts.length) return 0;
  const c = await config();
  const had = await prisma.rewardEvent.count({ where: { accountType, accountId } });
  const before = await total(accountType, accountId);
  const r = await prisma.rewardEvent.createMany({ data: drafts.map((d) => ({ accountType, accountId, kind: d.kind, points: d.points, refKey: d.refKey, note: d.note ?? null })), skipDuplicates: true });
  if (!r.count) return 0;
  const after = await total(accountType, accountId);
  const from = rewardLevel(before, c.levels).level;
  const to = rewardLevel(after, c.levels).level;
  // The first sync of an existing account catches up silently; after that, level-ups are celebrated.
  if (had > 0 && to !== from && after > before) await tellLevelUp(to).catch(() => undefined);
  return r.count;
}

// ---------------- facts ----------------

export async function syncProvider(providerId: string) {
  const c = await config();
  if (!c.enabled) return 0;
  const { providerChecklist } = await import("./onboarding");
  const p = await prisma.provider.findUnique({
    where: { id: providerId },
    select: {
      id: true, userId: true, npi: true, status: true,
      licenses: { where: { status: "VERIFIED" }, select: { id: true }, take: 1 },
      malpractice: { where: { status: "VERIFIED" }, select: { id: true }, take: 1 },
      availability: { select: { id: true }, take: 1 },
      openDates: { select: { id: true }, take: 1 },
    },
  });
  if (!p) return 0;
  const { common, perProfession } = await providerChecklist(providerId);
  const assignments = await prisma.assignment.findMany({
    where: { providerId, status: { in: ["COMPLETED", "CANCELLED", "NO_SHOW"] } },
    select: {
      id: true, status: true, startsAt: true, cancelledAt: true, cancelledBy: true,
      punches: { select: { kind: true, at: true, source: true }, orderBy: { at: "asc" } },
      // Only once revealed: points must never give away a rating early.
      ratings: { where: { raterType: "CLINIC", revealedAt: { not: null } }, select: { stars: true } },
      shift: { select: { premiumsApplied: true, emergencyAt: true, rescueOfShiftId: true } },
    },
    orderBy: { startsAt: "desc" },
    take: 2000,
  });
  const referrals = await prisma.referral.findMany({ where: { referrerUserId: p.userId, status: "REWARDED" }, select: { id: true } });
  const { trailblazerStates } = await import("./enrollment");
  const trail = (await trailblazerStates([providerId])).get(providerId) ?? [];
  const drafts = providerRewardEvents(
    {
      id: p.id,
      emailVerified: common.emailVerified,
      profile: common.profile && common.homeBase,
      photo: common.photo,
      npi: !!p.npi,
      licenseVerified: p.licenses.length > 0,
      malpracticeVerified: p.malpractice.length > 0,
      payouts: common.payouts,
      agreement: common.agreement,
      availability: p.availability.length > 0 || p.openDates.length > 0,
      ready: perProfession.some((x) => x.status === "ACTIVE" && x.license && x.malpractice) && common.agreement && common.payouts,
      assignments: assignments.map((a) => {
        const kinds = (a.shift.premiumsApplied as { kind: string }[] | null) ?? [];
        return {
          id: a.id,
          status: a.status,
          startsAt: a.startsAt,
          cancelledAt: a.cancelledAt,
          cancelledBy: a.cancelledBy,
          firstInAt: a.punches.find((x) => x.kind === "IN")?.at ?? null,
          cleanPunches: a.punches.some((x) => x.kind === "IN") && a.punches.some((x) => x.kind === "OUT") && a.punches.every((x) => x.source === "LIVE"),
          clinicStars: a.ratings[0]?.stars ?? null,
          urgent: !!a.shift.emergencyAt || !!a.shift.rescueOfShiftId || (Array.isArray(kinds) && kinds.some((k) => k.kind === "URGENT" || k.kind === "RUSH")),
        };
      }),
      rewardedReferralIds: referrals.map((r) => r.id),
      trailblazerStates: trail,
    },
    c.points,
    { lateGraceMinutes: c.s["timeclock.lateGraceMinutes"], lateCancelHours: c.s["payments.providerLateCancelHours"] },
  );
  return write("PROVIDER", providerId, drafts, (level) =>
    notify(prisma, p.userId, { template: "rewards_level", title: `You've reached ${level}!`, body: `Thanks for being a great part of the network. See your points and what's next on your Rewards page.`, link: "/provider/rewards", ctaLabel: "See my rewards", email: false }).then(() => undefined),
  );
}

export async function syncClinic(clinicOrgId: string) {
  const c = await config();
  if (!c.enabled) return 0;
  const org = await prisma.clinicOrg.findUnique({
    where: { id: clinicOrgId },
    select: { id: true, hasPaymentMethod: true, agreementSignedAt: true, locations: { select: { id: true }, take: 1 }, members: { select: { user: { select: { id: true, emailVerifiedAt: true } } } } },
  });
  if (!org) return 0;
  const posted = await prisma.shift.count({ where: { location: { clinicOrgId }, postedAt: { not: null } } });
  const assignments = await prisma.assignment.findMany({
    where: { shift: { location: { clinicOrgId } }, status: { in: ["COMPLETED", "CANCELLED"] } },
    select: {
      id: true, status: true, startsAt: true, cancelledAt: true, cancelledBy: true,
      shift: { select: { postedAt: true } },
      timesheet: { select: { submittedAt: true, approvedAt: true, approvalMethod: true } },
      ratings: { where: { raterType: "CLINIC" }, select: { id: true } },
    },
    orderBy: { startsAt: "desc" },
    take: 2000,
  });
  const userIds = org.members.map((m) => m.user.id);
  const referrals = await prisma.referral.findMany({ where: { referrerUserId: { in: userIds }, status: "REWARDED" }, select: { id: true } });
  const drafts = clinicRewardEvents(
    {
      id: org.id,
      emailVerified: org.members.some((m) => !!m.user.emailVerifiedAt),
      location: org.locations.length > 0,
      paymentMethod: org.hasPaymentMethod,
      agreement: !!org.agreementSignedAt,
      posted: posted > 0,
      assignments: assignments.map((a) => ({
        id: a.id,
        status: a.status,
        startsAt: a.startsAt,
        postedAt: a.shift.postedAt,
        cancelledAt: a.cancelledAt,
        cancelledBy: a.cancelledBy,
        timesheetSubmittedAt: a.timesheet?.submittedAt ?? null,
        timesheetApprovedAt: a.timesheet?.approvedAt ?? null,
        clinicSigned: ["PORTAL", "EMAIL_LINK", "ONSITE"].includes(a.timesheet?.approvalMethod ?? ""),
        ratedProvider: a.ratings.length > 0,
      })),
      rewardedReferralIds: referrals.map((r) => r.id),
    },
    c.points,
    { lateCancelHours: c.s["payments.clinicFreeCancelHours"] },
  );
  return write("CLINIC", clinicOrgId, drafts, (level) =>
    notifyClinic(prisma, clinicOrgId, { template: "rewards_level", title: `Your clinic reached ${level}!`, body: "Thanks for booking with us. See your points and what's next on your Rewards page.", link: "/clinic/rewards", ctaLabel: "See our rewards", email: false }).then(() => undefined),
  );
}

// ---------------- views ----------------

const LABEL = new Map(REWARD_RULES.map((r) => [r.key, r.label]));

async function summaryFor(accountType: RewardAudience, accountId: string) {
  const c = await config();
  const [points, history] = await Promise.all([
    total(accountType, accountId),
    prisma.rewardEvent.findMany({ where: { accountType, accountId }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const rules = REWARD_RULES.filter((r) => r.audience === accountType)
    .map((r) => ({ ...r, points: c.points[r.key] ?? r.points }))
    .filter((r) => r.points !== 0);
  return {
    enabled: c.enabled,
    points,
    ...rewardLevel(points, c.levels),
    levels: c.levels,
    rules,
    history: history.map((h) => ({ id: h.id, at: h.createdAt, points: h.points, label: h.kind === "manual" ? (h.note ?? "Bonus from the team") : (LABEL.get(h.kind) ?? h.kind), note: h.kind === "manual" ? null : h.note })),
  };
}

/** The provider's own rewards (synced first, so it's current). */
export async function myProviderRewards(actor: Actor) {
  const providerId = requireProvider(actor);
  await syncProvider(providerId).catch(() => undefined);
  return summaryFor("PROVIDER", providerId);
}

export async function myClinicRewards(actor: Actor) {
  const orgId = requireClinic(actor);
  await syncClinic(orgId).catch(() => undefined);
  return summaryFor("CLINIC", orgId);
}

/** Small dashboard card: level and points only (no sync: the page and the sweep keep it current). */
export async function rewardsChip(accountType: RewardAudience, accountId: string) {
  const c = await config();
  if (!c.enabled) return null;
  const points = await total(accountType, accountId);
  return { points, ...rewardLevel(points, c.levels) };
}

// ---------------- admin ----------------

export async function leaderboard(actor: Actor, opts: { audience: RewardAudience; days?: number | null; state?: string | null; take?: number }) {
  requireAdmin(actor);
  const c = await config();
  const since = opts.days ? new Date(+clock.now() - opts.days * 86_400_000) : null;
  const rows = await prisma.rewardEvent.groupBy({
    by: ["accountId"],
    where: { accountType: opts.audience, ...(since ? { createdAt: { gte: since } } : {}) },
    _sum: { points: true },
    orderBy: { _sum: { points: "desc" } },
    take: 500,
  });
  const ids = rows.map((r) => r.accountId);
  const lifetime = new Map(
    (await prisma.rewardEvent.groupBy({ by: ["accountId"], where: { accountType: opts.audience, accountId: { in: ids } }, _sum: { points: true } })).map((r) => [r.accountId, r._sum.points ?? 0]),
  );
  const names = new Map<string, { name: string; state: string | null; href: string }>();
  if (opts.audience === "PROVIDER") {
    for (const p of await prisma.provider.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, homeState: true } })) names.set(p.id, { name: p.displayName, state: p.homeState, href: `/admin/providers/${p.id}` });
  } else {
    for (const o of await prisma.clinicOrg.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, locations: { select: { state: true }, take: 1 } } })) names.set(o.id, { name: o.displayName, state: o.locations[0]?.state ?? null, href: `/admin/clinics/${o.id}` });
  }
  return rows
    .map((r) => ({ accountId: r.accountId, points: r._sum.points ?? 0, lifetime: lifetime.get(r.accountId) ?? 0, ...(names.get(r.accountId) ?? { name: "(removed)", state: null, href: "" }) }))
    .filter((r) => !opts.state || r.state === opts.state)
    .map((r) => ({ ...r, level: rewardLevel(r.lifetime, c.levels).level }))
    .slice(0, opts.take ?? 50);
}

/** A manual bonus or correction (negative), with a reason the person sees in their history. */
export async function awardPoints(actor: Actor, input: { accountType: RewardAudience; accountId: string; points: number; note: string }) {
  requireAdmin(actor);
  const note = input.note.trim().slice(0, 200);
  if (!note) throw new DomainError("VALIDATION", "Add a short reason; they'll see it in their points history.");
  if (!Number.isInteger(input.points) || input.points === 0 || Math.abs(input.points) > 100_000) throw new DomainError("VALIDATION", "Points must be a whole number, positive or negative.");
  const exists = input.accountType === "PROVIDER" ? await prisma.provider.count({ where: { id: input.accountId } }) : await prisma.clinicOrg.count({ where: { id: input.accountId } });
  if (!exists) throw new DomainError("NOT_FOUND", "Account not found");
  const e = await prisma.rewardEvent.create({ data: { accountType: input.accountType, accountId: input.accountId, kind: "manual", points: input.points, refKey: `manual:${randomUUID()}`, note, createdById: actor.userId } });
  await audit(prisma, actor, "rewards.awarded", input.accountType === "PROVIDER" ? "Provider" : "ClinicOrg", input.accountId, null, { points: input.points, note });
  return e;
}

/** Job rewardsSweep (hourly): accounts with recent activity, and everyone once a day. */
export async function rewardsSweep(now = clock.now()) {
  const c = await config();
  if (!c.enabled) return { providers: 0, clinics: 0, events: 0 };
  const lastFull = await prisma.setting.findUnique({ where: { key: "rewards.lastFullSync" } });
  const full = !lastFull || +now - +new Date(lastFull.value as string) > 24 * 3_600_000;
  const since = new Date(+now - 3 * 86_400_000);
  const recent = full
    ? null
    : await prisma.assignment.findMany({
        where: { OR: [{ endsAt: { gte: since, lte: now } }, { cancelledAt: { gte: since } }, { timesheet: { approvedAt: { gte: since } } }] },
        select: { providerId: true, shift: { select: { location: { select: { clinicOrgId: true } } } } },
        take: 5000,
      });
  const providerIds = full ? (await prisma.provider.findMany({ select: { id: true } })).map((p) => p.id) : [...new Set(recent!.map((a) => a.providerId))];
  const clinicIds = full ? (await prisma.clinicOrg.findMany({ select: { id: true } })).map((o) => o.id) : [...new Set(recent!.map((a) => a.shift.location.clinicOrgId))];
  let events = 0;
  for (const id of providerIds) events += await syncProvider(id).catch(() => 0);
  for (const id of clinicIds) events += await syncClinic(id).catch(() => 0);
  if (full) await prisma.setting.upsert({ where: { key: "rewards.lastFullSync" }, create: { key: "rewards.lastFullSync", value: now.toISOString() }, update: { value: now.toISOString() } });
  return { providers: providerIds.length, clinics: clinicIds.length, events, full };
}

/** Find the account behind a login email (admin award form). */
export async function accountByEmail(actor: Actor, audience: RewardAudience, email: string) {
  requireAdmin(actor);
  const user = await prisma.user.findFirst({ where: { email: { equals: email.trim(), mode: "insensitive" } }, select: { id: true, provider: { select: { id: true, displayName: true } }, clinicMembers: { select: { clinicOrg: { select: { id: true, displayName: true } } }, take: 1 } } });
  if (audience === "PROVIDER" && user?.provider) return { accountId: user.provider.id, name: user.provider.displayName };
  if (audience === "CLINIC" && user?.clinicMembers[0]) return { accountId: user.clinicMembers[0].clinicOrg.id, name: user.clinicMembers[0].clinicOrg.displayName };
  throw new DomainError("NOT_FOUND", `No ${audience === "PROVIDER" ? "provider" : "clinic"} login with that email.`);
}
