import { prisma } from "@cm/db";
import { CLINICS, PROVIDERS, type DemoClinic, type DemoProvider } from "./data";
import { etDay, type Extras, type Spec } from "./steps";
import { realNow } from "./time";

/**
 * What the demo should contain. The planner looks at what already exists and
 * only adds what's missing, so the same function builds the first demo and the
 * Sunday top-up (keeping at least 37 days of shifts ahead).
 */

export const HORIZON_DAYS = 37;
const HISTORY_WEEKS = 3;

/** Small seeded random numbers: the same week plans the same way. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const miles = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 3959;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const BOT_CLINICS = CLINICS.filter((c) => !c.yours && !c.noPayment);
const WORKERS = PROVIDERS.filter((p) => p.kind === "active" && !p.yours);

/** Bot providers who can reach a clinic, nearest first. Straight-line miles under ~70% of their drive limit. */
function nearby(c: DemoClinic, opts: { overnight?: boolean } = {}) {
  const l = c.locations[0];
  return WORKERS
    .map((p) => ({ p, d: miles(l, p) }))
    .filter(({ p, d }) => d <= (p.drive ?? 60) * 0.7 || (opts.overnight && p.overnight && d <= 120))
    .sort((a, b) => a.d - b.d)
    .map(({ p }) => p);
}

const worksOn = (p: DemoProvider, weekday: number) => (p.days ?? [1, 2, 3, 4, 5, 6]).includes(weekday);
/** Luxon weekday (1 = Mon … 7 = Sun) of a day offset, as 0 = Sun … 6 = Sat. */
const weekdayOf = (offset: number, now: number) => etDay(offset, now).weekday % 7;

class Calendar {
  /** provider key → day offsets they're already working (booked or planned). */
  busy = new Map<string, Set<number>>();
  take(p: string, day: number) {
    const s = this.busy.get(p) ?? new Set<number>();
    if (s.has(day)) return false;
    s.add(day);
    this.busy.set(p, s);
    return true;
  }
  free(p: string, day: number) {
    return !this.busy.get(p)?.has(day);
  }
}

/** Shift shapes clinics post, in rotation: hours, expected visits and options. */
const SHAPES: { start: number; end: number; patients: number | null; x?: Extras }[] = [
  { start: 8, end: 17, patients: 32 },
  { start: 8, end: 17, patients: 14 },
  { start: 8, end: 12.5, patients: 16 },
  { start: 13, end: 18, patients: 18 },
  { start: 9, end: 18, patients: 26, x: { minYears: 5 } },
  { start: 8, end: 17, patients: 24, x: { required: ["Webster"], notes: "Several prenatal patients: Webster certification required." } },
  { start: 8, end: 17, patients: null, x: { instantBook: true, notes: "Instant book is on: the first qualified provider to accept is booked." } },
  { start: 7.5, end: 16, patients: 30, x: { preferred: ["Activator"] } },
];

async function existingDays() {
  const from = etDay(-HISTORY_WEEKS * 7 - 2).toJSDate();
  const rows = await prisma.shift.findMany({
    where: { startsAt: { gte: from }, status: { notIn: ["CANCELLED", "DRAFT"] }, location: { clinicOrg: { members: { some: { user: { email: { endsWith: "@sandbox.test" } } } } } } },
    select: { startsAt: true, rateMode: true, shiftGroupId: true, lodgingAllowed: true, instantBook: true, location: { select: { clinicOrg: { select: { members: { select: { user: { select: { email: true } } } } } } } }, assignments: { where: { status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] } }, select: { provider: { select: { user: { select: { email: true } } } } } } },
  });
  return rows.map((r) => ({
    day: Math.round((+etDay(0, +r.startsAt).toJSDate() - +etDay(0).toJSDate()) / 86_400_000),
    clinic: r.location.clinicOrg.members.map((m) => m.user.email.split("@")[0].split(".")[1]).find(Boolean) ?? "",
    providers: r.assignments.map((a) => a.provider.user.email.split("@")[0].split(".")[1]),
    rateMode: r.rateMode,
    group: r.shiftGroupId,
    lodging: r.lodgingAllowed,
  }));
}

/**
 * Open shifts (with applicants for the near ones) and bookings so that every
 * clinic has its usual weekly need for the next HORIZON_DAYS, and your two
 * test accounts always have something to act on.
 */
export async function topUpPlan(now = realNow()): Promise<Spec[]> {
  const out: Spec[] = [];
  const have = await existingDays();
  const cal = new Calendar();
  for (const h of have) for (const p of h.providers) cal.take(p, h.day);
  const rand = rng(Math.floor(now / (7 * 86_400_000)));
  const r = (n: number) => Math.floor(rand() * n);
  const count = (clinic: string, from: number, to: number) => have.filter((h) => h.clinic === clinic && h.day >= from && h.day < to).length;
  let shape = r(SHAPES.length);

  // Weeks of the horizon (day 1 = tomorrow). A clinic's need is counted per 7-day block.
  for (let w = 0; w * 7 < HORIZON_DAYS; w++) {
    const from = 1 + w * 7;
    const to = Math.min(from + 7, HORIZON_DAYS + 1);
    for (const c of [...BOT_CLINICS, ...CLINICS.filter((x) => x.yours)]) {
      const want = c.yours ? 2 : c.perWeek;
      const helpers = nearby(c, { overnight: true });
      for (let n = count(c.key, from, to); n < want; n++) {
        // A workday (not Sunday) in this block.
        let day = from + r(to - from);
        for (let tries = 0; weekdayOf(day, now) === 0 && tries < 7; tries++) day = from + ((day - from + 1) % (to - from));
        if (weekdayOf(day, now) === 0) continue;
        const sh = SHAPES[shape++ % SHAPES.length];
        const weekday = weekdayOf(day, now);
        const avail = helpers.filter((p) => worksOn(p, weekday) && cal.free(p.key, day));
        const far = c.key === "pensacola" || c.key === "gville";
        const x = { ...(sh.x ?? {}), ...(far ? { lodging: true, notes: "We're a drive from most providers: lodging allowance included." } : {}) };
        // Within a week: a third get booked; the rest are open with 1-3 applicants.
        if (day <= 7 && !c.yours && avail.length && rand() < 0.35) {
          const p = avail[0];
          cal.take(p.key, day);
          out.push({ k: "booked", c: c.key, p: p.key, day, start: sh.start, end: sh.end, patients: sh.patients, via: rand() < 0.5 ? "apply" : "invite", x, message: rand() < 0.3 });
        } else {
          const applicants = day <= 14 && !x.instantBook ? avail.slice(0, 1 + r(3)).map((p) => p.key) : [];
          out.push({ k: "open", c: c.key, day, start: sh.start, end: sh.end, patients: sh.patients, applicants, x, loc: c.locations.length > 1 ? r(c.locations.length) : 0 });
        }
        have.push({ day, clinic: c.key, providers: [], rateMode: "MARKET", group: null, lodging: !!x.lodging });
      }
    }
  }

  // Your test provider: two bookings and two invitations in the coming week (+ one at your own clinic).
  const you = PROVIDERS.find((p) => p.yours)!;
  const yourBookings = have.filter((h) => h.providers.includes(you.key) && h.day >= 0 && h.day <= 7).length;
  const near = BOT_CLINICS.filter((c) => miles(c.locations[0], you) <= (you.drive ?? 60) * 0.7);
  for (let i = yourBookings, d = 2; i < 3 && d <= 8; d++) {
    if (weekdayOf(d, now) === 0 || !cal.free(you.key, d)) continue;
    const atYours = i === 2;
    const c = atYours ? CLINICS.find((x) => x.yours)! : near[(i + r(near.length)) % near.length];
    cal.take(you.key, d);
    out.push({ k: "booked", c: c.key, p: you.key, day: d, start: 8, end: 17, patients: 24, via: i % 2 ? "invite" : "apply", message: i === 0 });
    i++;
  }
  const yourInvites = await prisma.offer.count({ where: { status: "PENDING", provider: { user: { email: "provider.you@sandbox.test" } } } });
  for (let i = yourInvites, d = 9; i < 2 && d <= 14; d++) {
    if (weekdayOf(d, now) === 0 || !cal.free(you.key, d)) continue;
    out.push({ k: "open", c: near[(i + 1) % near.length].key, day: d, start: 9, end: 17, patients: 20, invite: [you.key] });
    i++;
  }

  // Your test clinic: one booked shift with a bot provider in the next week.
  const yours = CLINICS.find((c) => c.yours)!;
  if (!have.some((h) => h.clinic === yours.key && h.day >= 1 && h.day <= 7 && h.providers.some((p) => p !== you.key))) {
    const helpers = nearby(yours);
    for (let d = 3; d <= 7; d++) {
      const p = helpers.find((x) => worksOn(x, weekdayOf(d, now)) && cal.free(x.key, d));
      if (weekdayOf(d, now) === 0 || !p) continue;
      cal.take(p.key, d);
      out.push({ k: "booked", c: yours.key, p: p.key, day: d, start: 8, end: 17, patients: 30, via: "apply", message: true });
      break;
    }
  }

  // Always at least one of each special kind ahead.
  if (!have.some((h) => h.rateMode === "CLINIC" && h.day > 4)) {
    out.push({ k: "clinicRate", c: "miami", day: 10 + r(10), start: 8, end: 17, pct: 85, release: true, applicants: nearby(BOT_CLINICS.find((c) => c.key === "miami")!).slice(0, 1).map((p) => p.key) });
  }
  if (!have.some((h) => h.group && h.day > 2)) {
    const base = 15 + r(5);
    const days = [base, base + 1, base + 2].filter((d) => weekdayOf(d, now) !== 0);
    out.push({ k: "multiday", c: "lakeside", days, start: 8, end: 17 });
  }
  return out;
}

/** History (past three weeks, worked and paid), the special cases, then the forward top-up. */
export async function initialPlan(now = realNow()): Promise<Spec[]> {
  const out: Spec[] = [{ k: "wipe" }, { k: "config" }, { k: "cast" }, { k: "promo", code: "WELCOME20" }];
  const rand = rng(Math.floor(now / 86_400_000));
  const r = (n: number) => Math.floor(rand() * n);
  const cal = new Calendar();
  const you = PROVIDERS.find((p) => p.yours)!;
  const yours = CLINICS.find((c) => c.yours)!;

  // Past weeks: each clinic's usual shifts, worked by nearby providers.
  for (let day = -HISTORY_WEEKS * 7; day <= -1; day++) {
    const weekday = weekdayOf(day, now);
    if (weekday === 0) continue;
    for (const c of BOT_CLINICS) {
      if (rand() > Math.min(c.perWeek, 2) / 6) continue;
      const p = nearby(c).find((x) => worksOn(x, weekday) && cal.free(x.key, day));
      if (!p) continue;
      cal.take(p.key, day);
      const patients = [14, 22, 28, 34][r(4)];
      out.push({ k: "history", c: c.key, p: p.key, day, start: 8, end: 17, patients, visits: patients + r(9) - 3, outcome: day === -1 ? "signoff" : rand() < 0.08 ? "countDispute" : "paid" });
    }
  }
  // Your accounts' history: your clinic used three providers; you worked at nearby clinics and at your own.
  const yourHelpers = ["marcus", "priya", "julia", "daniel"];
  for (const [i, day] of [-19, -16, -12, -9, -5, -2, -1].entries()) {
    if (weekdayOf(day, now) === 0) continue;
    // Rotate so your clinic has worked with several providers.
    const p = [...yourHelpers.slice(i % 4), ...yourHelpers.slice(0, i % 4)].find((k) => cal.free(k, day));
    if (!p) continue;
    cal.take(p, day);
    out.push({ k: "history", c: yours.key, p, day, start: 8, end: 17, patients: 30, visits: 28 + (i % 5), outcome: day === -1 ? "signoff" : i === 2 ? "countDispute" : "paid" });
  }
  for (const [i, day] of [-18, -15, -11, -8, -4, -3].entries()) {
    if (weekdayOf(day, now) === 0 || !cal.free(you.key, day)) continue;
    cal.take(you.key, day);
    out.push({ k: "history", c: ["lakeside", "baldwin", yours.key][i % 3], p: you.key, day, start: 8, end: 17, patients: 24, visits: 22 + i, outcome: i === 4 ? "dispute" : "paid" });
  }
  // A late-cancel emergency happening now (another provider can still take it), and the special cases.
  out.push(
    { k: "favorite", c: yours.key, p: "auto" },
    { k: "favorite", c: yours.key, p: "auto", rank: 1 },
    { k: "favorite", c: "lakeside", p: "auto" },
    { k: "favorite", c: "bay", p: "auto" },
    { k: "standing", c: "bay", p: "james", weekday: 2, startsInDays: 3, accept: true },
    { k: "standing", c: "lakeside", p: you.key, weekday: 4, startsInDays: 5, accept: false },
    { k: "multiProvider", c: "bay", day: 12 + r(4), start: 8, end: 17, n: 2, confirm: ["sofia"] },
    { k: "clinicRate", c: yours.key, day: 18, start: 8, end: 17, pct: 82, release: false },
    { k: "clinicRate", c: "ftl", day: 9, start: 8, end: 17, pct: 88, release: true, applicants: ["david"] },
    { k: "draft", c: yours.key, day: 21, start: 8, end: 17 },
    { k: "cancelled", c: "baldwin", day: 6, start: 8, end: 17 },
    { k: "change", c: "baldwin", p: you.key, day: 11, start: 8, end: 17, newStart: 9, newEnd: 18 },
    { k: "emergency", c: "lakeside", p: "alicia" },
    { k: "multiday", c: yours.key, days: [24, 25, 26].filter((d) => weekdayOf(d, now) !== 0), start: 8, end: 17 },
    { k: "open", c: yours.key, day: 4, start: 8, end: 17, patients: 30, x: { promo: "WELCOME20" } },
    { k: "hire", c: "lakeside", p: "auto" },
    { k: "support", who: yours.key, side: "clinic", subject: "Can we post a shift for two locations?", body: "We might open a second office next year. Can one account post for both?" },
    { k: "support", who: you.key, side: "provider", subject: "When does my pay arrive?", body: "I finished a shift last week; when should I expect the transfer?" },
    // Everything ahead (computed from what exists by then), then wrap up.
    { k: "topup" },
    { k: "finish" },
  );
  return out;
}
