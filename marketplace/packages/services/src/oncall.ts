import { z } from "zod";
import { DomainError, describeOnCallRule } from "@cm/core";
import { prisma } from "@cm/db";
import { audit, clock, requireProvider, type Actor } from "./context";
import { onCallEligibility, ruleFacts } from "./dispatch";

/** On Call rules (Addendum 02 §4.2). Rules can never widen INV-1: matching always starts from getEligibleProviders. */

export const OnCallRuleInput = z.object({
  professionCodes: z.array(z.string()).min(1, "Choose at least one profession."),
  recurringWindows: z.array(z.object({ weekday: z.number().int().min(0).max(6), startMin: z.number().int().min(0).max(1440), endMin: z.number().int().min(1).max(1440) })).default([]),
  dateWindows: z.array(z.object({ startsAt: z.coerce.date(), endsAt: z.coerce.date() })).default([]),
  maxDriveMinutes: z.coerce.number().int().min(5).max(600),
  minPayHalfDayCents: z.coerce.number().int().min(0).nullable().optional(),
  minPayFullDayCents: z.coerce.number().int().min(0).nullable().optional(),
  minPayHourlyCents: z.coerce.number().int().min(0).nullable().optional(),
  minNoticeMinutes: z.coerce.number().int().min(0).max(10_080).default(90),
  maxPerDay: z.coerce.number().int().min(1).max(3).default(1),
  maxPerWeek: z.coerce.number().int().min(1).max(14).default(5),
  favoritesOnly: z.boolean().default(false),
  minClinicRating: z.coerce.number().min(1).max(5).nullable().optional(),
  allowOvernight: z.boolean().default(false),
  active: z.boolean().default(true),
});

export async function onCallOverview(actor: Actor) {
  const providerId = requireProvider(actor);
  const [p, rules, resp, eligibility, professions] = await Promise.all([
    prisma.provider.findUniqueOrThrow({ where: { id: providerId }, include: { user: true, professions: { where: { status: "ACTIVE" } } } }),
    prisma.onCallRule.findMany({ where: { providerId }, orderBy: { createdAt: "asc" } }),
    prisma.providerResponsiveness.findMany({ where: { providerId } }),
    onCallEligibility(prisma, providerId),
    prisma.profession.findMany(),
  ]);
  const names = Object.fromEntries(professions.map((x) => [x.code, x.displayName]));
  const now = clock.now();
  return {
    provider: p,
    eligibility,
    onCallNow: rules.some((r) => r.active && (!r.pausedUntil || r.pausedUntil <= now)),
    rules: rules.map((r) => ({ ...r, summary: describeOnCallRule(ruleFacts(r), names) })),
    responsiveness: resp,
    activeProfessions: p.professions.map((x) => ({ code: x.professionCode, name: names[x.professionCode] ?? x.professionCode })),
  };
}

export async function saveOnCallRule(actor: Actor, raw: z.input<typeof OnCallRuleInput>, ruleId?: string) {
  const providerId = requireProvider(actor);
  const input = OnCallRuleInput.parse(raw);
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: providerId }, include: { professions: { where: { status: "ACTIVE" } } } });
  const allowed = new Set(p.professions.map((x) => x.professionCode));
  if (input.professionCodes.some((c) => !allowed.has(c))) throw new DomainError("VALIDATION", "On Call can only include professions you're active in.");
  if (input.maxDriveMinutes > p.maxDriveMinutes) throw new DomainError("VALIDATION", `Max drive can't exceed your profile limit of ${p.maxDriveMinutes} minutes.`);
  if (!input.recurringWindows.length && !input.dateWindows.length) throw new DomainError("VALIDATION", "Add at least one day or date range.");
  const data = {
    ...input,
    minPayHalfDayCents: input.minPayHalfDayCents ?? null,
    minPayFullDayCents: input.minPayFullDayCents ?? null,
    minPayHourlyCents: input.minPayHourlyCents ?? null,
    minClinicRating: input.minClinicRating ?? null,
    dateWindows: input.dateWindows.map((w) => ({ startsAt: w.startsAt.toISOString(), endsAt: w.endsAt.toISOString() })),
    timeZone: p.homeTimeZone,
  };
  const rule = ruleId
    ? await prisma.onCallRule.update({ where: { id: ruleId, providerId }, data })
    : await prisma.onCallRule.create({ data: { ...data, providerId } });
  await audit(prisma, actor, "oncall.rule_saved", "OnCallRule", rule.id, null, data);
  return rule;
}

export async function setOnCall(actor: Actor, on: boolean, pausedUntil?: Date | null) {
  const providerId = requireProvider(actor);
  if (on) {
    const e = await onCallEligibility(prisma, providerId);
    if (!e.ok) throw new DomainError("FORBIDDEN", e.reasons.join(" · "));
    if (!(await prisma.onCallRule.count({ where: { providerId } }))) throw new DomainError("VALIDATION", "Set up your On Call rules first.");
  }
  await prisma.onCallRule.updateMany({ where: { providerId }, data: { active: on, pausedUntil: on ? null : (pausedUntil ?? null) } });
  if (!on && pausedUntil) await prisma.onCallRule.updateMany({ where: { providerId }, data: { active: true, pausedUntil } });
  await audit(prisma, actor, on ? "oncall.on" : pausedUntil ? "oncall.paused" : "oncall.off", "Provider", providerId, null, { pausedUntil });
}

export async function deleteOnCallRule(actor: Actor, ruleId: string) {
  const providerId = requireProvider(actor);
  await prisma.onCallRule.deleteMany({ where: { id: ruleId, providerId } });
}
