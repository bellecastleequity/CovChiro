import { env, isSandbox } from "@cm/config";
import { DomainError } from "@cm/core";
import { prisma } from "@cm/db";
import { setOutboxSink } from "@cm/integrations";
import { createSession } from "../auth";
import { audit, requireAdmin, type Actor } from "../context";
import { assertSandbox } from "./cast";
import { DEMO_DOMAIN, DEMO_PASSWORD, CLINICS, PROVIDERS } from "./data";
import { HORIZON_DAYS } from "./plan";
import { lastRun, queueState, stepLabel } from "./runner";
import { etDay } from "./steps";
import { isTester, listTesters } from "./testers";

export { botsTick } from "./bots";
export { cancelQueue, runQueue, sandboxBusy, startBuild, startTopUp, weeklyTopUp } from "./runner";
export { atTime, realNow, travel } from "./time";
export { DEMO_PASSWORD } from "./data";
export { addTester, isTester, listTesters, removeTester } from "./testers";

// Test site: keep every email and text in the database (Admin → Test site → Outbox).
if (isSandbox()) {
  setOutboxSink((m) => prisma.sandboxMessage.create({ data: { channel: m.channel, to: m.to.slice(0, 300), subject: m.subject?.slice(0, 500) ?? null, body: m.body.slice(0, 20_000), html: m.html?.slice(0, 100_000) ?? null, delivered: m.delivered } }));
}

export const enabled = () => isSandbox();

/** Everything the Admin → Test site page shows. */
export async function overview(actor: Actor) {
  requireAdmin(actor);
  assertSandbox();
  const [builtAt, q, last] = await Promise.all([prisma.setting.findUnique({ where: { key: "sandbox.builtAt" } }), queueState(), lastRun()]);
  const now = new Date();
  const horizon = etDay(HORIZON_DAYS).toJSDate();
  const [open, booked, completed, outboxCount, lastShift] = await Promise.all([
    prisma.shift.count({ where: { startsAt: { gt: now }, status: { in: ["OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING"] } } }),
    prisma.shift.count({ where: { startsAt: { gt: now }, status: { in: ["CONFIRMED"] } } }),
    prisma.assignment.count({ where: { status: "COMPLETED" } }),
    prisma.sandboxMessage.count(),
    prisma.shift.findFirst({ where: { status: { notIn: ["CANCELLED", "DRAFT"] } }, orderBy: { startsAt: "desc" }, select: { startsAt: true } }),
  ]);
  const users = await prisma.user.findMany({
    where: { email: { endsWith: `@${DEMO_DOMAIN}` } },
    select: { id: true, email: true, name: true, role: true, disabledAt: true, provider: { select: { status: true, displayName: true, homeCity: true } }, clinicMembers: { select: { clinicOrg: { select: { displayName: true, status: true } } } } },
    orderBy: { email: "asc" },
  });
  const describe = (email: string) => {
    const [kind, key] = email.split("@")[0].split(".");
    if (kind === "provider") {
      const p = PROVIDERS.find((x) => x.key === key);
      return { yours: !!p?.yours, group: "provider" as const, note: p ? `${p.city} · ${({ active: "verified", pendingLicense: "license waiting for review", pendingMalpractice: "malpractice waiting for review", expiringLicense: "license expiring soon", student: "student", noPayouts: "payout setup unfinished", suspended: "suspended" } as const)[p.kind]}` : "" };
    }
    const c = CLINICS.find((x) => x.key === key);
    return { yours: !!c?.yours, group: kind === "staff" ? ("staff" as const) : ("clinic" as const), note: c ? `${c.locations.map((l) => l.city).join(" + ")}${c.noPayment ? " · no card on file" : ""}${kind === "staff" ? " · staff login" : ""}` : "" };
  };
  return {
    builtAt: (builtAt?.value as string | undefined) ?? null,
    queue: q ? { label: q.label, done: q.done, total: q.specs.length, current: q.specs[q.done] ? stepLabel(q.specs[q.done].k) : null, errors: q.errors.slice(-5), errorCount: q.errors.length, startedAt: q.startedAt } : null,
    last: last ? { label: last.label, finishedAt: last.finishedAt ?? null, errors: last.errors.slice(-8), errorCount: last.errors.length, total: (last as unknown as { total?: number }).total ?? last.done } : null,
    counts: { open, booked, completed, outbox: outboxCount },
    furthestShift: lastShift?.startsAt ?? null,
    horizon,
    password: DEMO_PASSWORD,
    logins: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.provider?.displayName ?? u.clinicMembers[0]?.clinicOrg.displayName ?? u.name,
      person: u.name,
      disabled: !!u.disabledAt,
      ...describe(u.email),
    })),
    emailAllow: env().SANDBOX_EMAIL_ALLOW ?? "",
    smsAllow: env().SANDBOX_SMS_ALLOW ?? "",
    stripe: env().STRIPE_SECRET_KEY ? "test" : "fake",
    /** Owner (not a tester): may build/rebuild/stop and manage testers. */
    owner: !(await isTester(actor.userId)),
    testers: await listTesters(actor),
  };
}

/** The Test outbox: newest first, optionally only one address. */
export async function outbox(actor: Actor, opts: { to?: string | null; take?: number } = {}) {
  requireAdmin(actor);
  assertSandbox();
  return prisma.sandboxMessage.findMany({
    where: opts.to ? { to: { contains: opts.to, mode: "insensitive" } } : {},
    orderBy: { createdAt: "desc" },
    take: Math.min(opts.take ?? 100, 500),
    select: { id: true, channel: true, to: true, subject: true, body: true, delivered: true, createdAt: true },
  });
}

export async function outboxMessage(actor: Actor, id: string) {
  requireAdmin(actor);
  assertSandbox();
  return prisma.sandboxMessage.findUnique({ where: { id } });
}

export async function clearOutbox(actor: Actor) {
  requireAdmin(actor);
  assertSandbox();
  const r = await prisma.sandboxMessage.deleteMany({});
  return `${r.count} messages cleared.`;
}

/**
 * Admin: sign in as a demo clinic or provider (test site only). Returns a new
 * session token for that login; the web layer keeps the admin's own session so
 * "Back to admin" returns without signing in again.
 */
export async function actAs(actor: Actor, userId: string, userAgent?: string) {
  requireAdmin(actor);
  assertSandbox();
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u || !u.email.endsWith(`@${DEMO_DOMAIN}`)) throw new DomainError("NOT_FOUND", "Only demo accounts can be opened this way.");
  if (u.disabledAt) throw new DomainError("CONFLICT", "That login is suspended.");
  await audit(prisma, actor, "sandbox.act_as", "User", u.id, null, { email: u.email });
  return { token: await createSession(u.id, true, userAgent), role: u.role };
}
