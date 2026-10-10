import { AsyncLocalStorage } from "node:async_hooks";
import { DomainError, savedForProviderNote, supplyCheck, waitingDraftAction, type SupplyResult } from "@cm/core";
import { prisma } from "@cm/db";
import { clock, getSettings, type Db } from "./context";
import { buildLoadedShifts, getEligibleProviders, loadShifts, type LoadedShift, type ShiftRowForEligibility } from "./eligibility";
import { notifyClinic } from "./notify";

/**
 * Open states, gated by supply (owner decision Oct 2026): a clinic can post only when at least one
 * provider can take the shift (getEligibleProviders on the would-be shift: licensed, insured, near
 * enough, available, not booked, pay floor met). Otherwise the shift stays a draft "waiting for a
 * provider" (posted automatically when the clinic leaves that on), the attempt is logged as demand
 * (PostingDemand → Growth), and the clinic is texted and emailed (waitingDraftSweep). Rules: core/supply.ts.
 */

export type ShiftSupply = SupplyResult & { nearby: number };

/** Clinic verification holds shifts but never blocks posting, so providers are counted as if the clinic were cleared. */
async function supplyFor(db: Db, shift: LoadedShift, needed: number, clinicRate: boolean, days = 1): Promise<ShiftSupply> {
  const set = await getEligibleProviders(db, { ...shift, facts: { ...shift.facts, clinicCleared: true } });
  const r = supplyCheck({ needed, eligible: set.eligible.length, excluded: set.excluded.map((e) => e.result.failures.map((f) => f.filter)), clinicRate, days });
  return { ...r, nearby: set.eligible.length + set.excluded.length };
}

/** Supply for stored shifts (drafts about to be posted), by id. */
export async function shiftsSupply(db: Db, shiftIds: string[], needed = 1, days = 1): Promise<Map<string, ShiftSupply>> {
  const loaded = await loadShifts(db, shiftIds);
  const modes = new Map((await db.shift.findMany({ where: { id: { in: shiftIds } }, select: { id: true, rateMode: true } })).map((x) => [x.id, x.rateMode === "CLINIC"]));
  const out = new Map<string, ShiftSupply>();
  for (const id of shiftIds) {
    const sh = loaded.get(id);
    if (sh) out.set(id, await supplyFor(db, sh, needed, !!modes.get(id), days));
  }
  return out;
}

/** Live count for the posting wizard: an unsaved shift built from the form (never stored). */
export async function previewSupply(db: Db, row: Omit<ShiftRowForEligibility, "id" | "status">, needed: number, clinicRate: boolean, days = 1): Promise<ShiftSupply> {
  const loaded = (await buildLoadedShifts(db, [{ ...row, id: "preview", status: "DRAFT" }])).get("preview")!;
  return supplyFor(db, loaded, needed, clinicRate, days);
}

const bypass = new AsyncLocalStorage<boolean>();
/** Test site demo builder and bots only: their demo shifts are posted whether or not a demo provider can take them. */
export function withoutSupplyGate<T>(fn: () => Promise<T>): Promise<T> {
  return bypass.run(true, fn);
}

export async function supplyGateOn(db: Db = prisma) {
  if (bypass.getStore()) return false;
  return (await getSettings(db))["market.requireAvailableProvider"];
}

/**
 * Before posting: every day must have enough providers. When one doesn't, all the days stay drafts
 * waiting for a provider (posted by the sweep when autoPost, the default), each short day is logged
 * as demand, and NO_PROVIDER_AVAILABLE is thrown with the clinic-facing reason (details.shiftIds).
 */
export async function assertSupplyForPosting(shiftIds: string[], needed = 1, alsoWaiting: string[] = [], opts: { autoPost?: boolean } = {}) {
  if (!shiftIds.length || !(await supplyGateOn())) return;
  const autoPost = opts.autoPost ?? true;
  const supply = await shiftsSupply(prisma, shiftIds, needed, shiftIds.length);
  const short = shiftIds.filter((id) => supply.get(id) && !supply.get(id)!.ok);
  if (!short.length) return;
  const now = clock.now();
  const saved = [...new Set([...shiftIds, ...alsoWaiting])];
  await prisma.shift.updateMany({ where: { id: { in: saved }, status: "DRAFT" }, data: { waitingForProviderSince: now, providerAvailableNotifiedAt: null, autoPostWhenAvailable: autoPost } });
  const rows = await prisma.shift.findMany({ where: { id: { in: short } }, include: { location: true } });
  for (const sh of rows) {
    const r = supply.get(sh.id)!;
    await prisma.postingDemand.create({
      data: {
        clinicOrgId: sh.location.clinicOrgId, locationId: sh.locationId, shiftId: sh.id, professionCode: sh.professionCode, state: sh.state,
        city: sh.location.city, zip: sh.location.zip, lat: sh.location.lat, lng: sh.location.lng, startsAt: sh.startsAt,
        gap: r.gap ?? "NONE_NEARBY", needed, available: r.available, nearby: r.nearby,
      },
    });
  }
  // Growth: where clinics want providers and none are there yet (one open escalation per location).
  const first = rows[0];
  const r = supply.get(first.id)!;
  if (r.gap === "NONE_NEARBY") {
    const { escalate } = await import("./growth/engine");
    await escalate({
      entityType: "MARKET", entityId: `demand:${first.professionCode}:${first.location.zip.slice(0, 3)}`, label: `${first.location.city}, ${first.state}`, reasonCode: "posting_blocked", intent: "HIGH",
      reason: `A clinic in ${first.location.city}, ${first.state} tried to post a ${first.professionCode} shift and no provider nearby has joined yet.`,
      action: "Recruit providers licensed in this state near this city (Growth → Expansion: set the state to PRELAUNCH or LIVE); the clinic is told the moment one can take it.",
    }).catch(() => undefined);
  }
  throw new DomainError("NO_PROVIDER_AVAILABLE", [r.headline, r.hint, savedForProviderNote(autoPost, saved.length)].filter(Boolean).join(" "), { shiftIds: saved, gap: r.gap, available: r.available, savedAsDraft: true, autoPost });
}

/** Posting a draft that had been waiting: its demand rows record that it went out. */
export async function markDemandPosted(shiftIds: string[]) {
  await prisma.shift.updateMany({ where: { id: { in: shiftIds } }, data: { waitingForProviderSince: null } });
  await prisma.postingDemand.updateMany({ where: { shiftId: { in: shiftIds }, postedAt: null }, data: { postedAt: clock.now() } });
}

/** The clinic login that posts a waiting draft automatically: whoever created it, else the clinic owner. */
async function postingActor(clinicOrgId: string, createdById: string) {
  const members = await prisma.clinicMember.findMany({ where: { clinicOrgId }, include: { user: { select: { id: true, role: true, disabledAt: true } } } });
  const m = members.find((x) => x.userId === createdById && !x.user.disabledAt) ?? members.find((x) => x.role === "CLINIC_OWNER" && !x.user.disabledAt);
  return m ? { userId: m.userId, role: m.user.role, providerId: null, clinicOrgId } : null;
}

/**
 * Every 15 min: drafts waiting for a provider. Multi-day bookings are checked as one (every day needs
 * someone). Once a provider can take it: posted automatically when the clinic left "post it
 * automatically" on (then told), else told once so they can post in one tap (re-armed if the
 * provider is taken first). At the posting cut-off the wait ends with one note; the draft stays.
 */
export async function waitingDraftSweep(limit = 200) {
  const now = clock.now();
  const drafts = await prisma.shift.findMany({
    where: { status: "DRAFT", waitingForProviderSince: { not: null } },
    orderBy: { startsAt: "asc" },
    take: limit,
    include: { location: { select: { clinicOrgId: true, timeZone: true, name: true } } },
  });
  const groups = new Map<string, typeof drafts>();
  for (const d of drafts) {
    const k = d.shiftGroupId ?? d.id;
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  let notified = 0;
  let posted = 0;
  let expired = 0;
  for (const days of groups.values()) {
    const ids = days.map((d) => d.id);
    const first = days[0];
    const supply = await shiftsSupply(prisma, ids, 1, ids.length);
    const available = Math.min(...ids.map((id) => supply.get(id)?.available ?? 0));
    const action = waitingDraftAction({ now, startsAt: first.startsAt, available, notifiedAt: first.providerAvailableNotifiedAt });
    const when = first.startsAt.toLocaleDateString("en-US", { timeZone: first.location.timeZone, weekday: "long", month: "long", day: "numeric" });
    const what = days.length > 1 ? `your ${days.length}-day booking starting ${when}` : `${when}`;
    const providers = available === 1 ? "a provider" : `${available} providers`;
    if (action === "NOTIFY") {
      if (first.autoPostWhenAvailable) {
        const actor = await postingActor(first.location.clinicOrgId, first.createdById);
        let ok = !!actor;
        if (actor) {
          const { postShift } = await import("./shifts");
          for (const id of ids) {
            try {
              await postShift(actor, id, { skipSupply: true });
            } catch (e) {
              ok = false;
              console.error("auto-post of waiting draft failed", id, e);
              break;
            }
          }
        }
        if (ok) {
          posted++;
          await notifyClinic(prisma, first.location.clinicOrgId, {
            template: "provider_available_posted",
            title: `We've posted ${days.length > 1 ? "your booking" : "your shift"} for ${when}`,
            body: `Good news: ${providers} can now cover ${what} at ${first.location.name}, so we posted it for you. You'll hear from us as soon as a provider is confirmed.`,
            link: `/clinic/shifts/${first.id}`,
            ctaLabel: "View the shift",
            email: true,
            sms: true,
          });
          continue;
        }
      }
      notified++;
      await prisma.shift.updateMany({ where: { id: { in: ids } }, data: { providerAvailableNotifiedAt: now } });
      await notifyClinic(prisma, first.location.clinicOrgId, {
        template: "provider_available",
        title: `A provider is available for ${what}`,
        body: `Good news: ${providers} can now cover ${what} at ${first.location.name}. Post it now before they're booked elsewhere.`,
        link: `/clinic/shifts/${first.id}`,
        ctaLabel: "Post it now",
        email: true,
        sms: true,
      });
    } else if (action === "RESET") {
      await prisma.shift.updateMany({ where: { id: { in: ids } }, data: { providerAvailableNotifiedAt: null } });
    } else if (action === "EXPIRE") {
      expired++;
      await prisma.shift.updateMany({ where: { id: { in: ids } }, data: { waitingForProviderSince: null } });
      await notifyClinic(prisma, first.location.clinicOrgId, {
        template: "provider_wait_ended",
        title: `No provider became available for ${what}`,
        body: `We're sorry: no provider became available in time for ${what} at ${first.location.name}. ${days.length > 1 ? "The drafts are" : "The draft is"} still saved if you'd like to use ${days.length > 1 ? "them" : "it"} for another date.`,
        link: `/clinic/shifts/${first.id}`,
        email: true,
      });
    }
  }
  return { checked: groups.size, notified, posted, expired };
}

/** Clinic draft page: is a provider available now, and is the draft waiting for one? (null when the check is off) */
export async function draftSupply(actor: { clinicOrgId?: string | null }, shiftId: string) {
  if (!(await supplyGateOn())) return null;
  const sh = await prisma.shift.findFirst({ where: { id: shiftId, status: "DRAFT", location: { clinicOrgId: actor.clinicOrgId ?? "" } }, select: { id: true, waitingForProviderSince: true, autoPostWhenAvailable: true, shiftGroupId: true } });
  if (!sh) return null;
  const r = (await shiftsSupply(prisma, [sh.id])).get(sh.id);
  if (!r) return null;
  return { waiting: !!sh.waitingForProviderSince, autoPost: sh.autoPostWhenAvailable, ok: r.ok, available: r.available, headline: r.headline, hint: r.hint };
}

/** Growth → Supply & Demand: refused postings by city (where clinics want providers and none could take it). */
export async function demandSummary(days = 90) {
  const since = new Date(+clock.now() - days * 86_400_000);
  const rows = await prisma.postingDemand.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 5000 });
  const by = new Map<string, { state: string; city: string; professionCode: string; attempts: number; clinics: Set<string>; posted: number; gaps: Record<string, number>; lastAt: Date }>();
  for (const r of rows) {
    const k = `${r.professionCode}|${r.state}|${r.city.toLowerCase()}`;
    const g = by.get(k) ?? { state: r.state, city: r.city, professionCode: r.professionCode, attempts: 0, clinics: new Set<string>(), posted: 0, gaps: {}, lastAt: r.createdAt };
    g.attempts++;
    g.clinics.add(r.clinicOrgId);
    if (r.postedAt) g.posted++;
    g.gaps[r.gap] = (g.gaps[r.gap] ?? 0) + 1;
    by.set(k, g);
  }
  return [...by.values()]
    .map((g) => ({ ...g, clinics: g.clinics.size, topGap: Object.entries(g.gaps).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "" }))
    .sort((a, b) => b.clinics - a.clinics || b.attempts - a.attempts);
}
