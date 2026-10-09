import { marketsToOpen, US_STATES } from "@cm/core";
import { prisma } from "@cm/db";
import { audit, clock, getSettings, SYSTEM } from "./context";

/**
 * Open states (owner decision Oct 2026): every U.S. state is open for posting, and the
 * available-doctor check (supply.ts) is the gate. Hourly sweep switches on each state and each
 * profession in market.openProfessions unless the admin closed it (market.closedStates, kept by
 * the switches on Admin → States). Rows are switched on for real, so the DB invariants (INV-6
 * trigger, psc_enable_checklist), landing pages, waitlist and Growth all see the same thing.
 * Prices come from the state's own regions, else pricing.nationalRateRegion.
 */
const NOTE = "Opened automatically (owner's open-states decision, Oct 2026). The state's own legal review is still to do.";

export async function openAllMarkets(): Promise<{ states: string[]; pairs: string[] }> {
  const s = await getSettings();
  if (!s["market.openAllStates"]) return { states: [], pairs: [] };
  const directory = s["market.boardDirectoryUrls"];
  const professions = await prisma.profession.findMany({ where: { code: { in: s["market.openProfessions"] } } });
  const openable = professions.filter((p) => directory[p.code] && (!p.requiresSupervisionDefault || p.defaultSupervisingProfessionCodes.length > 0));
  if (!openable.length) return { states: [], pairs: [] };
  const [stateRows, pairRows] = await Promise.all([
    prisma.stateConfig.findMany({ select: { state: true, enabled: true } }),
    prisma.professionStateConfig.findMany({ where: { professionCode: { in: openable.map((p) => p.code) } }, select: { professionCode: true, state: true, enabled: true } }),
  ]);
  const plan = marketsToOpen({ states: Object.keys(US_STATES), closed: s["market.closedStates"], professions: openable.map((p) => p.code), stateRows, pairRows });
  const now = clock.now();
  const board = directory[openable[0].code];
  for (const state of plan.states) {
    const row = await prisma.stateConfig.findUnique({ where: { state } });
    const data = {
      enabled: true,
      legalReviewComplete: true,
      legalReviewNotes: row?.legalReviewNotes ?? NOTE,
      boardLookupUrl: row?.boardLookupUrl ?? board,
      enabledAt: now,
      enabledById: null,
    };
    if (row) await prisma.stateConfig.update({ where: { state }, data });
    else await prisma.stateConfig.create({ data: { state, ...data } });
  }
  for (const { professionCode, state } of plan.pairs) {
    const p = openable.find((x) => x.code === professionCode)!;
    const row = await prisma.professionStateConfig.findUnique({ where: { professionCode_state: { professionCode, state } } });
    const data = {
      enabled: true,
      legalReviewComplete: true,
      legalReviewNotes: row?.legalReviewNotes ?? NOTE,
      boardLookupUrl: row?.boardLookupUrl ?? directory[professionCode],
      supervisionRequired: row?.supervisionRequired ?? p.requiresSupervisionDefault,
      supervisingProfessionCodes: row?.supervisingProfessionCodes.length ? row.supervisingProfessionCodes : p.defaultSupervisingProfessionCodes,
      malpracticeMinOccurrenceCents: row?.malpracticeMinOccurrenceCents ?? p.defaultMalpracticeMinOccurrenceCents,
      malpracticeMinAggregateCents: row?.malpracticeMinAggregateCents ?? p.defaultMalpracticeMinAggregateCents,
      enabledAt: now,
      enabledById: null,
    };
    // Licensed at the state level is the default; a row an admin set up differently keeps its credential rule.
    if (row) await prisma.professionStateConfig.update({ where: { professionCode_state: { professionCode, state } }, data });
    else await prisma.professionStateConfig.create({ data: { professionCode, state, ...data } });
    if (!p.active) await prisma.profession.update({ where: { code: professionCode }, data: { active: true } });
  }
  const pairs = plan.pairs.map((x) => `${x.professionCode}:${x.state}`);
  if (plan.states.length || pairs.length) {
    await audit(prisma, SYSTEM, "market.auto_opened", "StateConfig", "ALL", null, { states: plan.states, pairs });
    // Providers licensed there and the waitlist hear right away (the hourly sweep is the backstop).
    await (await import("./waitlist")).waitlistOpeningSweep().catch(() => undefined);
  }
  return { states: plan.states, pairs };
}
