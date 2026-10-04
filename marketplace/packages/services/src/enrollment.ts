import { NATIONAL_CREDENTIAL, US_STATES } from "@cm/core";
import { prisma } from "@cm/db";
import { getSettings, requireAdmin, type Actor } from "./context";
import { notify } from "./notify";
import { livePairs } from "./waitlist";

/**
 * Nationwide provider enrollment (owner decision Oct 2026). Providers of an active profession
 * can sign up and finish every onboarding step in any state, open or not. Eligibility is
 * untouched: no shifts exist where the profession × state isn't live.
 *  - Trailblazer badge: submitting a license for a state before that pair opens holds a place
 *    in line (TrailblazerSpot). The first enrollment.trailblazerSpots active places per pair earn
 *    the badge, shown once that license is verified. A rejected or removed license gives the
 *    place to the next in line; no new places once the pair is live.
 *  - When a pair opens, every provider holding a license there (not rejected) is told once.
 *  - The verification queue lists open-market credentials first; the rest are low priority.
 */

const pairKey = (professionCode: string, state: string) => `${professionCode}:${state}`;
export const stateName = (state: string) => US_STATES[state as keyof typeof US_STATES] ?? state;

export async function liveSet(): Promise<Set<string>> {
  return new Set((await livePairs()).map((p) => pairKey(p.professionCode, p.state)));
}

// ---------------- Trailblazer places ----------------

/** A license was submitted: hold (or re-take) a place in line if that state isn't open yet. */
export async function reserveTrailblazer(providerId: string, professionCode: string, state: string) {
  if (state === NATIONAL_CREDENTIAL) return;
  if ((await liveSet()).has(pairKey(professionCode, state))) return;
  const where = { providerId_professionCode_state: { providerId, professionCode, state } };
  const existing = await prisma.trailblazerSpot.findUnique({ where });
  if (!existing) await prisma.trailblazerSpot.create({ data: { providerId, professionCode, state } }).catch(() => undefined);
  else if (existing.releasedAt) await prisma.trailblazerSpot.update({ where, data: { reservedAt: new Date(), releasedAt: null } });
}

/** License rejected or removed: the place goes to the next in line. */
export async function releaseTrailblazer(providerId: string, professionCode: string, state: string) {
  await prisma.trailblazerSpot.updateMany({ where: { providerId, professionCode, state, releasedAt: null }, data: { releasedAt: new Date() } });
}

/** The provider ids holding the first places for a pair, in order. */
async function holders(professionCode: string, state: string, spots: number): Promise<string[]> {
  const rows = await prisma.trailblazerSpot.findMany({
    where: { professionCode, state, releasedAt: null },
    orderBy: [{ reservedAt: "asc" }, { id: "asc" }],
    take: spots,
    select: { providerId: true },
  });
  return rows.map((r) => r.providerId);
}

/** States in which each provider has earned the badge (a top place and that license verified). */
export async function trailblazerStates(providerIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!providerIds.length) return out;
  const spots = (await getSettings())["enrollment.trailblazerSpots"];
  const mine = await prisma.trailblazerSpot.findMany({ where: { providerId: { in: providerIds }, releasedAt: null } });
  if (!mine.length) return out;
  const pairs = [...new Map(mine.map((m) => [pairKey(m.professionCode, m.state), m])).values()];
  const tops = new Map<string, Set<string>>();
  for (const p of pairs) tops.set(pairKey(p.professionCode, p.state), new Set(await holders(p.professionCode, p.state, spots)));
  const verified = await prisma.license.findMany({
    where: { providerId: { in: providerIds }, status: "VERIFIED", OR: mine.map((m) => ({ professionCode: m.professionCode, state: m.state })) },
    select: { providerId: true, professionCode: true, state: true },
  });
  const ok = new Set(verified.map((v) => `${v.providerId}:${pairKey(v.professionCode, v.state)}`));
  for (const m of mine) {
    const k = pairKey(m.professionCode, m.state);
    if (!tops.get(k)?.has(m.providerId) || !ok.has(`${m.providerId}:${k}`)) continue;
    out.set(m.providerId, [...(out.get(m.providerId) ?? []), m.state]);
  }
  return out;
}

// ---------------- the provider's markets ----------------

export interface WaitingMarket {
  state: string;
  stateName: string;
  professionCode: string;
  /** Their place in line, when they hold one. */
  place: number | null;
  /** In the top places (the badge shows once the license is verified). */
  trailblazer: boolean;
  licenseVerified: boolean;
  spots: number;
  spotsLeft: number;
}

/**
 * Where the provider can work. States come from their licenses (not rejected), or their home
 * state before they've added one. `inOpenMarket` = at least one of them is live.
 */
export async function enrollmentStatus(providerId: string) {
  const s = await getSettings();
  const spots = s["enrollment.trailblazerSpots"];
  const p = await prisma.provider.findUnique({
    where: { id: providerId },
    select: { homeState: true, professions: { select: { professionCode: true } }, licenses: { where: { status: { not: "REJECTED" } }, select: { professionCode: true, state: true, status: true } } },
  });
  if (!p) return { inOpenMarket: true, openStates: [] as string[], waiting: [] as WaitingMarket[] };
  const live = await liveSet();
  const candidates = new Map<string, { professionCode: string; state: string; verified: boolean }>();
  for (const l of p.licenses) if (l.state !== NATIONAL_CREDENTIAL) candidates.set(pairKey(l.professionCode, l.state), { professionCode: l.professionCode, state: l.state, verified: l.status === "VERIFIED" });
  // National credentials count where the state accepts them; any live pair for that profession then counts as open.
  const national = p.licenses.filter((l) => l.state === NATIONAL_CREDENTIAL).map((l) => l.professionCode);
  if (!candidates.size && p.homeState) for (const pr of p.professions) candidates.set(pairKey(pr.professionCode, p.homeState), { professionCode: pr.professionCode, state: p.homeState, verified: false });
  if (!candidates.size) return { inOpenMarket: true, openStates: [], waiting: [] };
  const openStates = [...candidates.values()].filter((c) => live.has(pairKey(c.professionCode, c.state))).map((c) => c.state);
  const nationalOpen = national.length > 0 && (await livePairs()).some((lp) => national.includes(lp.professionCode));
  const waiting: WaitingMarket[] = [];
  for (const c of candidates.values()) {
    if (live.has(pairKey(c.professionCode, c.state))) continue;
    const order = await holders(c.professionCode, c.state, 100_000);
    const idx = order.indexOf(providerId);
    waiting.push({
      state: c.state,
      stateName: stateName(c.state),
      professionCode: c.professionCode,
      place: idx >= 0 ? idx + 1 : null,
      trailblazer: idx >= 0 && idx < spots,
      licenseVerified: c.verified,
      spots,
      spotsLeft: Math.max(0, spots - order.length),
    });
  }
  return { inOpenMarket: openStates.length > 0 || nationalOpen, openStates, waiting };
}

// ---------------- opening announcement ----------------

const ANNOUNCED = "enrollment.announcedPairs";

/**
 * Tell enrolled providers when their state opens (once each). The first run only records the
 * pairs already open, so nobody in an existing market is told "we're open".
 */
export async function announceOpenings() {
  const live = await livePairs();
  const row = await prisma.setting.findUnique({ where: { key: ANNOUNCED } });
  const known = new Set(Array.isArray(row?.value) ? (row!.value as string[]) : []);
  const keys = live.map((p) => pairKey(p.professionCode, p.state));
  if (!row) {
    await prisma.setting.upsert({ where: { key: ANNOUNCED }, create: { key: ANNOUNCED, value: keys }, update: { value: keys } });
    return { sent: 0 };
  }
  let sent = 0;
  const spots = (await getSettings())["enrollment.trailblazerSpots"];
  for (const p of live) {
    const k = pairKey(p.professionCode, p.state);
    if (known.has(k)) continue;
    const top = new Set(await holders(p.professionCode, p.state, spots));
    const licensed = await prisma.license.findMany({
      where: { professionCode: p.professionCode, state: p.state, status: { not: "REJECTED" }, provider: { status: { notIn: ["SUSPENDED", "DEACTIVATED"] } } },
      select: { providerId: true, status: true, provider: { select: { userId: true } } },
    });
    for (const l of licensed) {
      const claimed = await prisma.digestSend.createMany({ data: [{ key: `opened:${l.providerId}:${k}`, userId: l.provider.userId }], skipDuplicates: true });
      if (!claimed.count) continue;
      await notify(prisma, l.provider.userId, {
        template: "market_opened",
        title: `We're open in ${stateName(p.state)}!`,
        body: [
          `${p.noun} coverage shifts are opening in ${stateName(p.state)}, and you're among the first to know.`,
          top.has(l.providerId) ? "As a Trailblazer, you're one of the first providers there clinics will see." : "",
          l.status === "VERIFIED" ? "Keep your availability up to date so you're offered the shifts that suit you." : "We're reviewing your license now; finish any remaining setup steps so you're ready the moment it's verified.",
        ].filter(Boolean).join(" "),
        link: "/provider",
        ctaLabel: "Open my dashboard",
        sms: true,
      }).catch(() => undefined);
      sent++;
    }
    known.add(k);
  }
  await prisma.setting.update({ where: { key: ANNOUNCED }, data: { value: [...known] } });
  return { sent };
}

// ---------------- admin ----------------

/** Enrolled providers per state that isn't open yet (Admin → Supply). */
export async function waitingByState(actor: Actor) {
  requireAdmin(actor);
  const live = await liveSet();
  const spots = (await getSettings())["enrollment.trailblazerSpots"];
  const rows = await prisma.license.groupBy({ by: ["professionCode", "state", "status"], where: { state: { not: NATIONAL_CREDENTIAL }, status: { not: "REJECTED" } }, _count: true });
  const taken = await prisma.trailblazerSpot.groupBy({ by: ["professionCode", "state"], where: { releasedAt: null }, _count: true });
  const out = new Map<string, { professionCode: string; state: string; stateName: string; enrolled: number; verified: number; trailblazers: number; spots: number }>();
  for (const r of rows) {
    const k = pairKey(r.professionCode, r.state);
    if (live.has(k)) continue;
    const e = out.get(k) ?? { professionCode: r.professionCode, state: r.state, stateName: stateName(r.state), enrolled: 0, verified: 0, trailblazers: 0, spots };
    e.enrolled += r._count;
    if (r.status === "VERIFIED") e.verified += r._count;
    out.set(k, e);
  }
  for (const t of taken) {
    const e = out.get(pairKey(t.professionCode, t.state));
    if (e) e.trailblazers = Math.min(spots, t._count);
  }
  return [...out.values()].sort((a, b) => b.enrolled - a.enrolled || a.stateName.localeCompare(b.stateName));
}
