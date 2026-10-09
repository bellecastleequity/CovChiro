import { DateTime } from "luxon";
import { brand, env, isSandbox } from "@cm/config";
import { DomainError } from "@cm/core";
import { prisma } from "@cm/db";
import { requireAdmin, type Actor } from "../context";
import { autoCompleteDue, startDueShifts, submitRating } from "../lifecycle";
import { openThread, sendMessage } from "../messaging";
import { sendEmail } from "../notify";
import { releaseDuePayouts } from "../payouts";
import { applyToShift, createShift, quoteForClinic, selectApplicant, shiftBoard } from "../shifts";
import { approveAsClinic, punch } from "../timeclock";
import { confirmVisitsAsClinic, submitVisits, volumeSweep } from "../volume";
import { createClinic, createProvider, demoEmail, keepDemoAgreementsCurrent } from "./cast";
import { DEMO_PASSWORD, type DemoClinic, type DemoProvider } from "./data";
import { recordError } from "./errors";
import { isTester } from "./testers";
import { atTime, realNow, travel } from "./time";
import { hashPassword } from "../auth";
import { ZONE } from "./steps";

/**
 * Nightly self-check on the test site: one shift is taken all the way through the
 * real app (quote, post, board, a license check, apply, book with deposit, the
 * contact-details filter, clock in/out, visits, sign-off, completion and balance
 * charge, ratings, payout, emails) by its own two accounts, a few days in the
 * past, so it never disturbs the demo. Each step passes or fails on its own; the
 * owner gets one email a day with the result. Failures also go to the error log.
 */

const CHECK_CLINIC: DemoClinic = {
  key: "selfcheck", name: "Self-Check Chiropractic", legal: "Self-Check Chiropractic LLC", owner: "Robo Clinic", perWeek: 0,
  locations: [{ name: "Self-check office", address: "200 S Orange Ave", city: "Orlando", zip: "32801", lat: 28.5383, lng: -81.3792, patientsPerDay: 30, ehr: "ChiroTouch", arrival: "Automated check: no one is really here." }],
};
const CHECK_PROVIDER: DemoProvider = {
  key: "selfcheck", first: "Robo", last: "Provider", city: "Orlando", zip: "32803", lat: 28.5536, lng: -81.3473, grad: 2012, kind: "active",
  days: [0, 1, 2, 3, 4, 5, 6], drive: 60, bio: "Automated self-check account. It works one shift a night to prove the whole flow still works.",
};

export interface CheckResult { name: string; ok: boolean; ms: number; detail?: string | null }
export interface SelfCheckRun { startedAt: string; finishedAt: string; ok: boolean; trigger: "nightly" | "manual"; results: CheckResult[] }

const KEY = "sandbox.selfcheck";
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

async function ensureAccounts() {
  const admin = await prisma.user.findFirst({ where: { role: "PLATFORM_ADMIN", disabledAt: null }, orderBy: { createdAt: "asc" } });
  const adminActor: Actor = { userId: admin?.id ?? null, role: "PLATFORM_ADMIN", providerId: null, clinicOrgId: null };
  const hash = await hashPassword(DEMO_PASSWORD);
  if (!(await prisma.user.findUnique({ where: { email: demoEmail("selfcheck", "clinic") } }))) await createClinic(CHECK_CLINIC, hash, 90);
  if (!(await prisma.user.findUnique({ where: { email: demoEmail("selfcheck", "provider") } }))) await createProvider(CHECK_PROVIDER, hash, 91, adminActor);
  await keepDemoAgreementsCurrent();
  const cu = await prisma.user.findUniqueOrThrow({ where: { email: demoEmail("selfcheck", "clinic") }, include: { clinicMembers: { include: { clinicOrg: { include: { locations: true } } } } } });
  const pu = await prisma.user.findUniqueOrThrow({ where: { email: demoEmail("selfcheck", "provider") }, include: { provider: true } });
  const org = cu.clinicMembers[0].clinicOrg;
  return {
    clinic: { actor: { userId: cu.id, role: "CLINIC_OWNER", providerId: null, clinicOrgId: org.id } as Actor, locationId: org.locations[0].id, email: cu.email, name: cu.name },
    provider: { actor: { userId: pu.id, role: "PROVIDER", providerId: pu.provider!.id, clinicOrgId: null } as Actor, id: pu.provider!.id, email: pu.email },
  };
}

/**
 * A past day the check provider hasn't worked yet (2-60 days ago, most recent first). Each run uses one
 * day; the nightly run frees one a day as the window slides, so manual "Run now"s eat into the spare ones.
 */
const LOOKBACK_DAYS = 60;
async function freeDay(providerId: string) {
  const today = DateTime.fromMillis(realNow(), { zone: ZONE }).startOf("day");
  for (let back = 2; back <= LOOKBACK_DAYS; back++) {
    const d = today.minus({ days: back });
    const taken = await prisma.assignment.count({ where: { providerId, startsAt: { gte: d.toJSDate(), lt: d.plus({ days: 1 }).toJSDate() } } });
    if (!taken) return d;
  }
  throw new DomainError("CONFLICT", `Every day in the last ${LOOKBACK_DAYS} days already has a self-check shift (each run uses one). Tonight's run will have a free day again.`);
}

export async function runSelfCheck(trigger: "nightly" | "manual" = "manual"): Promise<SelfCheckRun> {
  // Pause the site's other background jobs while it runs (they'd act on the check's past-dated shift).
  const flag = "sandbox.selfcheckRunning";
  const until = { until: new Date(realNow() + 15 * MIN).toISOString() };
  await prisma.setting.upsert({ where: { key: flag }, create: { key: flag, value: until, updatedAt: new Date(realNow()) }, update: { value: until, updatedAt: new Date(realNow()) } });
  try {
    return await runChecks(trigger);
  } finally {
    await prisma.setting.deleteMany({ where: { key: flag } });
  }
}

async function runChecks(trigger: "nightly" | "manual"): Promise<SelfCheckRun> {
  const startedAt = new Date(realNow()).toISOString();
  const results: CheckResult[] = [];
  /** One named step: passes unless it throws (or its own assertion fails). */
  const check = async (name: string, fn: () => Promise<unknown>) => {
    const t0 = realNow();
    try {
      await fn();
      results.push({ name, ok: true, ms: realNow() - t0 });
      return true;
    } catch (e) {
      const detail = (e as Error).message.split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 400);
      results.push({ name, ok: false, ms: realNow() - t0, detail });
      await recordError({ source: "selfcheck", message: `${name}: ${detail}`, detail: (e as Error).stack ?? null });
      return false;
    }
  };
  const must = (cond: unknown, why: string) => {
    if (!cond) throw new Error(why);
  };

  let a: Awaited<ReturnType<typeof ensureAccounts>> | null = null;
  await check("Self-check accounts are ready", async () => {
    a = await ensureAccounts();
  });
  if (a) {
    const { clinic, provider } = a as Awaited<ReturnType<typeof ensureAccounts>>;
    const day = await freeDay(provider.id);
    const start = day.set({ hour: 8 }).toJSDate();
    const end = day.set({ hour: 17 }).toJSDate();
    const postedAt = +start - 6 * DAY;
    const mailSince = new Date(realNow());
    const input = { locationId: clinic.locationId, professionCode: "DC", startsAt: start, endsAt: end, expectedPatients: 24, notes: "Automated self-check shift." };
    await atTime(postedAt, async () => {
      let shiftId = "";
      let assignmentId = "";
      const step = async (when: number, name: string, fn: () => Promise<unknown>) => {
        travel(when);
        return check(name, fn);
      };
      await step(postedAt, "Price quote", async () => {
        const q = (await quoteForClinic(clinic.actor, input)) as { totalCents?: number; coverageCents?: number };
        must((q.coverageCents ?? 0) > 0, "the quote came back with no price");
      });
      if (!(await step(postedAt + MIN, "Clinic posts a shift", async () => {
        shiftId = (await createShift(clinic.actor, input, { post: true })).shiftId;
        const s = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
        must(["OPEN", "FAVORITES_ONLY", "SELECTING"].includes(s.status), `shift is ${s.status}, expected it open`);
      }))) return;
      await step(postedAt + 5 * MIN, "Shift shows on the provider's board", async () => {
        const board = await shiftBoard(provider.actor);
        must(board.some((b) => b.id === shiftId), "the shift isn't on the provider's Find shifts board");
      });
      await step(postedAt + 6 * MIN, "An unlicensed provider can't apply", async () => {
        const tran = await prisma.provider.findFirst({ where: { user: { email: demoEmail("tran", "provider") } }, include: { user: true } });
        if (!tran) return; // demo not built: nothing to compare with
        let refused = false;
        await applyToShift({ userId: tran.userId, role: "PROVIDER", providerId: tran.id, clinicOrgId: null }, shiftId, { commit: true }).catch(() => (refused = true));
        must(refused, "a provider whose license isn't verified was allowed to apply");
      });
      if (!(await step(postedAt + 2 * HOUR, "Provider applies", () => applyToShift(provider.actor, shiftId, { commit: true, note: "Self-check" })))) return;
      if (!(await step(postedAt + 4 * HOUR, "Clinic books the provider (deposit charged)", async () => {
        await selectApplicant(clinic.actor, shiftId, provider.id);
        const asg = await prisma.assignment.findFirstOrThrow({ where: { shiftId, status: "CONFIRMED" } });
        assignmentId = asg.id;
        const dep = await prisma.payment.findFirst({ where: { assignmentId, type: "DEPOSIT" } });
        must(dep?.status === "SUCCEEDED", `deposit is ${dep?.status ?? "missing"}`);
      }))) return;
      await step(postedAt + 5 * HOUR, "Phone numbers are blocked in messages", async () => {
        const t = await openThread(clinic.actor, { shiftId, providerId: provider.id });
        let blocked = false;
        await sendMessage(provider.actor, t.id, "Just text me at 407 555 0123 instead").catch((e) => (blocked = e instanceof DomainError));
        must(blocked, "a message with a phone number was delivered");
      });
      if (!(await step(+start - 8 * MIN, "Provider clocks in", async () => {
        await punch(provider.actor, assignmentId, "IN", { lat: 28.5384, lng: -81.3791, accuracyM: 10 });
      }))) return;
      await step(+start + MIN, "Shift starts", async () => {
        await startDueShifts(new Date());
        const asg = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
        must(asg.status === "IN_PROGRESS", `booking is ${asg.status}, expected IN_PROGRESS`);
      });
      if (!(await step(+end + 4 * MIN, "Provider clocks out (timesheet sent)", async () => {
        await punch(provider.actor, assignmentId, "OUT");
        const ts = await prisma.timesheet.findUnique({ where: { assignmentId } });
        must(ts?.status === "SUBMITTED", `timesheet is ${ts?.status ?? "missing"}`);
      }))) return;
      await step(+end + 10 * MIN, "Provider enters the visit count", () => submitVisits(provider.actor, assignmentId, 25));
      await step(+end + 40 * MIN, "Clinic signs the timesheet", async () => {
        await approveAsClinic(clinic.actor, assignmentId, { approverName: clinic.name, approverTitle: "Owner" });
        const ts = await prisma.timesheet.findUnique({ where: { assignmentId } });
        must(ts?.status === "APPROVED", `timesheet is ${ts?.status}`);
      });
      await step(+end + 45 * MIN, "Clinic confirms the visit count", () => confirmVisitsAsClinic(clinic.actor, assignmentId));
      await step(+end + 3 * HOUR, "Shift completes (balance charged)", async () => {
        await autoCompleteDue(new Date());
        await volumeSweep(new Date());
        const asg = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
        must(asg.status === "COMPLETED", `booking is ${asg.status}, expected COMPLETED`);
        const bal = await prisma.payment.findFirst({ where: { assignmentId, type: "BALANCE" } });
        must(!bal || bal.status === "SUCCEEDED", `balance charge is ${bal?.status}`);
      });
      await step(+end + 26 * HOUR, "Both sides rate", async () => {
        await submitRating(clinic.actor, assignmentId, { stars: 5, categories: {}, comment: "Self-check" });
        await submitRating(provider.actor, assignmentId, { stars: 5, categories: {}, comment: "Self-check" });
      });
      await step(+end + 3 * DAY + 2 * HOUR, "Provider is paid", async () => {
        await releaseDuePayouts(new Date());
        const owed = await prisma.payout.findMany({ where: { assignmentId } });
        must(owed.length > 0, "no payout was created");
        must(owed.every((p) => p.status === "PAID"), `payouts: ${owed.map((p) => p.status).join(", ")}`);
      });
    });
    await check("Emails were produced (kept in the outbox)", async () => {
      const n = await prisma.sandboxMessage.count({ where: { createdAt: { gte: mailSince }, to: { in: [clinic.email, provider.email] } } });
      must(n > 0, "no booking or timesheet emails were generated");
    });
  }

  const run: SelfCheckRun = { startedAt, finishedAt: new Date(realNow()).toISOString(), ok: results.every((r) => r.ok), trigger, results };
  const prev = ((await prisma.setting.findUnique({ where: { key: KEY } }))?.value as { history?: { at: string; ok: boolean; failed: string[] }[] } | undefined)?.history ?? [];
  const history = [{ at: run.finishedAt, ok: run.ok, failed: results.filter((r) => !r.ok).map((r) => r.name) }, ...prev].slice(0, 30);
  const now = new Date();
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: { last: run, history } as object, updatedAt: now }, update: { value: { last: run, history } as object, updatedAt: now } });
  return run;
}

export async function selfCheckState() {
  const v = (await prisma.setting.findUnique({ where: { key: KEY } }))?.value as { last?: SelfCheckRun; history?: { at: string; ok: boolean; failed: string[] }[] } | undefined;
  return { last: v?.last ?? null, history: v?.history ?? [] };
}

/** Admin "Run now" (owner or tester). */
export async function runSelfCheckNow(actor: Actor) {
  requireAdmin(actor);
  if (!isSandbox()) throw new DomainError("FORBIDDEN", "This only works on the test site.");
  const r = await runSelfCheck("manual");
  const failed = r.results.filter((x) => !x.ok);
  return failed.length ? `${failed.length} of ${r.results.length} checks failed: ${failed.map((f) => f.name).join(", ")}.` : `All ${r.results.length} checks passed.`;
}

/** Job (2:35 AM Eastern): run once a night and email the owner(s) the result. One email a day. */
export async function nightlySelfCheck() {
  if (!isSandbox()) return "not the test site";
  if (!(await prisma.setting.findUnique({ where: { key: "sandbox.builtAt" } }))) return "no demo yet";
  const r = await runSelfCheck("nightly");
  const failed = r.results.filter((x) => !x.ok);
  const admins = await prisma.user.findMany({ where: { role: "PLATFORM_ADMIN", disabledAt: null }, select: { id: true, email: true } });
  const owners = [];
  for (const u of admins) if (!(await isTester(u.id))) owners.push(u.email);
  const base = env().APP_BASE_URL.replace(/\/$/, "");
  for (const to of owners) {
    await sendEmail(to, {
      subject: failed.length ? `Test site self-check: ${failed.length} of ${r.results.length} failed` : `Test site self-check: all ${r.results.length} passed`,
      heading: failed.length ? "Something broke on the test site" : "Everything still works",
      paragraphs: failed.length
        ? [`Last night's self-check took one shift through the whole app on the test site. These steps failed:`, ...failed.map((f) => `✗ ${f.name}: ${f.detail ?? ""}`), "If this release is headed for the live site, hold it until these pass. The Errors list has the details."]
        : [`Last night's self-check took one shift from posting to payout on the test site: ${r.results.length} steps, all passed.`],
      cta: { label: "Open the test site", url: `${base}/admin/sandbox#selfcheck` },
      footerNote: `${brand().name} test site · one email a day`,
      essential: true,
    }).catch((e) => console.error("[sandbox] self-check email failed", e));
  }
  return failed.length ? `${failed.length} failed` : "all passed";
}
