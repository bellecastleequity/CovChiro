import { isSandbox } from "@cm/config";
import { prisma } from "@cm/db";
import { markOnMyWay, reconfirmAttendance } from "../attendance";
import { getEligibleProviders } from "../eligibility";
import { submitRating } from "../lifecycle";
import { sendMessage } from "../messaging";
import { respondToShiftChange } from "../shiftChanges";
import { applyToShift, respondToOffer, selectApplicant } from "../shifts";
import { respondStanding } from "../standing";
import { approveAsClinic, punch } from "../timeclock";
import { confirmVisitsAsClinic, submitVisits } from "../volume";
import { loadCast } from "./cast";
import { APPLY_NOTES, CLINIC_REVIEWS, PROVIDER_REVIEWS } from "./data";
import { sandboxBusy } from "./runner";
import { isUnexpected, recordError } from "./errors";
import { etDay, runSpec } from "./steps";

/**
 * The other side of the marketplace on the test site. Every demo clinic and
 * provider except your two test accounts is a "bot" that behaves like a
 * person would, a few minutes later: providers apply to your clinic's shifts,
 * accept invitations and changes, reconfirm, tap On my way, clock in and out
 * and enter visit counts; clinics pick you when you apply, sign timesheets,
 * confirm counts, rate, and answer messages. All through the normal services,
 * so every rule (eligibility, pricing, payments) applies.
 */

const MIN = 60_000;
const ago = (now: Date, minutes: number) => new Date(+now - minutes * MIN);
/** Stable "random" from an id: the same row always gets the same answer. */
const roll = (id: string) => [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % 100;
const UNFILLED = ["OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING"] as const;

export async function botsTick(now = new Date()) {
  if (!isSandbox()) return "not the test site";
  if (!(await prisma.setting.findUnique({ where: { key: "sandbox.builtAt" } }))) return "no demo yet";
  if (await sandboxBusy()) return "building";
  const cast = await loadCast();
  const botProviders = new Map([...cast.providers.values()].filter((p) => !p.yours).map((p) => [p.id, p]));
  const botClinics = new Map([...cast.clinics.values()].filter((c) => !c.yours).map((c) => [c.orgId, c]));
  const you = [...cast.providers.values()].find((p) => p.yours);
  const yourClinic = [...cast.clinics.values()].find((c) => c.yours);
  const done: string[] = [];
  const act = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      done.push(label);
    } catch (e) {
      // Refusals are normal (someone else was picked, a window closed); anything else is a bug worth seeing.
      if (isUnexpected(e)) await recordError({ source: "bot", message: `${label.replace(/\s\S+$/, "")}: ${(e as Error).message}`, detail: (e as Error).stack ?? null });
      // Bots give up quietly: the state moved on (someone else was picked, a window closed).
      if (process.env.NODE_ENV !== "test" || process.env.BOT_DEBUG) console.log(`[sandbox bot] ${label}: ${(e as Error).message}`);
    }
  };
  const botIds = [...botProviders.keys()];

  // 1. Invitations and dispatch offers to bot providers: most say yes after a few minutes.
  for (const o of await prisma.offer.findMany({ where: { providerId: { in: botIds }, status: "PENDING", expiresAt: { gt: now }, createdAt: { lt: ago(now, 4) } }, take: 20 })) {
    const p = botProviders.get(o.providerId)!;
    await act(`offer ${o.id}`, () => respondToOffer(p.actor, o.id, roll(o.id) < 85));
  }
  // 2. Shift changes and standing proposals to bot providers: accepted.
  for (const ch of await prisma.shiftChange.findMany({ where: { providerId: { in: botIds }, status: "PENDING", createdAt: { lt: ago(now, 5) } }, take: 10 })) {
    await act(`change ${ch.id}`, () => respondToShiftChange(botProviders.get(ch.providerId)!.actor, ch.id, true));
  }
  for (const b of await prisma.standingBooking.findMany({ where: { providerId: { in: botIds }, status: "PROPOSED", createdAt: { lt: ago(now, 5) } }, take: 5 })) {
    await act(`standing ${b.id}`, () => respondStanding(botProviders.get(b.providerId)!.actor, b.id, true));
  }

  // 3. Your clinic's open shifts get applicants (one more per shift every few minutes, up to three).
  if (yourClinic) {
    const open = await prisma.shift.findMany({
      where: { location: { clinicOrgId: yourClinic.orgId }, status: { in: [...UNFILLED] }, startsAt: { gt: new Date(+now + 2 * 60 * MIN) }, postedAt: { lt: ago(now, 3) }, rateMode: "MARKET" },
      include: { applications: { where: { status: "ACTIVE" }, orderBy: { createdAt: "desc" } } },
      orderBy: { postedAt: "desc" },
      take: 25,
    });
    for (const s of open) {
      if (s.applications.length >= 3 || (s.applications[0] && s.applications[0].createdAt > ago(now, 6))) continue;
      const eligible = await getEligibleProviders(prisma, s.id).catch(() => null);
      const applied = new Set(s.applications.map((a) => a.providerId));
      const next = eligible?.eligible.map((e) => e.providerId).find((id) => botProviders.has(id) && !applied.has(id));
      if (next) await act(`apply ${s.id}`, () => applyToShift(botProviders.get(next)!.actor, s.id, { commit: true, note: APPLY_NOTES[roll(next) % APPLY_NOTES.length] }));
    }
  }

  // 4. You applied to a bot clinic's shift: after ~10 minutes the clinic picks you.
  if (you) {
    for (const a of await prisma.application.findMany({ where: { providerId: you.id, status: "ACTIVE", createdAt: { lt: ago(now, 10) }, shift: { status: { in: [...UNFILLED] }, rateMode: "MARKET" } }, include: { shift: { include: { location: true } } }, take: 5 })) {
      const c = botClinics.get(a.shift.location.clinicOrgId);
      if (c) await act(`select you ${a.shiftId}`, () => selectApplicant(c.actor, a.shiftId, you.id));
    }
  }

  // 5. Bot providers' own bookings: reconfirm, On my way, clock in, clock out, visit count.
  const live = await prisma.assignment.findMany({
    where: { providerId: { in: botIds }, status: { in: ["CONFIRMED", "IN_PROGRESS"] }, startsAt: { lt: new Date(+now + 3 * 24 * 60 * MIN) } },
    include: { punches: true, visitCount: true, shift: { include: { location: true } } },
    take: 60,
  });
  for (const a of live) {
    const p = botProviders.get(a.providerId)!;
    const kinds = new Set(a.punches.map((x) => x.kind));
    if (a.reconfirmRequestedAt && !a.reconfirmedAt) await act(`reconfirm ${a.id}`, () => reconfirmAttendance(p.actor, a.id));
    if (!a.onMyWayAt && +now >= +a.startsAt - 50 * MIN && +now < +a.startsAt) await act(`on my way ${a.id}`, () => markOnMyWay(p.actor, a.id));
    if (!kinds.has("IN") && +now >= +a.startsAt - 8 * MIN && +now < +a.endsAt) {
      await act(`punch in ${a.id}`, () => punch(p.actor, a.id, "IN", { lat: a.shift.location.lat + 0.0002, lng: a.shift.location.lng, accuracyM: 15 }));
    }
    if (kinds.has("IN") && !kinds.has("OUT") && +now >= +a.endsAt + 3 * MIN) {
      await act(`punch out ${a.id}`, () => punch(p.actor, a.id, "OUT"));
    }
    if (kinds.has("OUT") && a.visitCount?.providerVisits == null && a.shift.expectedPatients != null) {
      await act(`visits ${a.id}`, () => submitVisits(p.actor, a.id, Math.max(4, (a.shift.expectedPatients ?? 20) + (roll(a.id) % 7) - 3)));
    }
  }
  // Ended bookings punched out but not yet counted (status moved on).
  for (const a of await prisma.assignment.findMany({ where: { providerId: { in: botIds }, status: { in: ["COMPLETED"] }, endsAt: { gt: ago(now, 24 * 60) }, visitCount: { is: null }, punches: { some: { kind: "OUT" } }, shift: { expectedPatients: { not: null } } }, include: { shift: true }, take: 10 })) {
    await act(`late visits ${a.id}`, () => submitVisits(botProviders.get(a.providerId)!.actor, a.id, Math.max(4, (a.shift.expectedPatients ?? 20) + (roll(a.id) % 5) - 2)));
  }

  // 6. Bot clinics sign timesheets (yours included) and confirm counts ~20 minutes later.
  for (const t of await prisma.timesheet.findMany({ where: { status: "SUBMITTED", submittedAt: { lt: ago(now, 20) }, assignment: { shift: { location: { clinicOrgId: { in: [...botClinics.keys()] } } } } }, include: { assignment: { include: { shift: { include: { location: true } } } } }, take: 20 })) {
    const c = botClinics.get(t.assignment.shift.location.clinicOrgId)!;
    await act(`sign ${t.assignmentId}`, () => approveAsClinic(c.actor, t.assignmentId, { approverName: c.ownerName, approverTitle: "Owner" }));
  }
  for (const v of await prisma.visitCount.findMany({ where: { status: "OPEN", providerVisits: { not: null }, clinicVisits: null, providerAt: { lt: ago(now, 25) }, assignment: { shift: { location: { clinicOrgId: { in: [...botClinics.keys()] } } } } }, include: { assignment: { include: { shift: { include: { location: true } } } } }, take: 20 })) {
    await act(`confirm visits ${v.assignmentId}`, () => confirmVisitsAsClinic(botClinics.get(v.assignment.shift.location.clinicOrgId)!.actor, v.assignmentId));
  }

  // 7. Ratings a day after: each bot side rates once.
  for (const a of await prisma.assignment.findMany({ where: { status: "COMPLETED", completedAt: { gt: ago(now, 7 * 24 * 60), lt: ago(now, 60) } }, include: { ratings: true, shift: { include: { location: true } } }, take: 30 })) {
    const c = botClinics.get(a.shift.location.clinicOrgId);
    const p = botProviders.get(a.providerId);
    if (c && !a.ratings.some((r) => r.raterType === "CLINIC")) await act(`clinic rates ${a.id}`, () => submitRating(c.actor, a.id, { stars: 4 + (roll(a.id) % 2), categories: {}, comment: CLINIC_REVIEWS[roll(a.id) % CLINIC_REVIEWS.length] }));
    if (p && !a.ratings.some((r) => r.raterType === "PROVIDER")) await act(`provider rates ${a.id}`, () => submitRating(p.actor, a.id, { stars: 4 + (roll(a.id + "p") % 2), categories: {}, comment: PROVIDER_REVIEWS[roll(a.id) % PROVIDER_REVIEWS.length] }));
  }

  // 8. Messages you send to a bot get one friendly reply after a few minutes.
  for (const t of await prisma.messageThread.findMany({ where: { lastMessageAt: { gt: ago(now, 3 * 24 * 60), lt: ago(now, 3) } }, include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } }, take: 30 })) {
    const last = t.messages[0];
    if (!last) continue;
    const fromYou = (last.senderType === "CLINIC" && t.clinicOrgId === yourClinic?.orgId) || (last.senderType === "PROVIDER" && t.providerId === you?.id);
    if (!fromYou) continue;
    const replyAs = last.senderType === "CLINIC" ? botProviders.get(t.providerId)?.actor : botClinics.get(t.clinicOrgId)?.actor;
    if (!replyAs) continue;
    const text = last.senderType === "CLINIC" ? "Thanks for the details! That works for me. See you then." : "Thanks for reaching out! We'll have everything ready for you.";
    await act(`reply ${t.id}`, () => sendMessage(replyAs, t.id, text));
  }

  // 9. Once a day: a short-notice (rush) shift for tomorrow near Orlando, so the premium shows on the board.
  const today = etDay(0).toISODate();
  const key = "sandbox.lastRush";
  const last = (await prisma.setting.findUnique({ where: { key } }))?.value;
  if (last !== today) {
    await prisma.setting.upsert({ where: { key }, create: { key, value: today!, updatedAt: now }, update: { value: today!, updatedAt: now } });
    const clinic = roll(today!) % 2 ? "lakeside" : "baldwin";
    if (etDay(1).weekday !== 7) await act("rush shift", () => runSpec({ k: "open", c: clinic, day: 1, start: 9, end: 17, patients: 22, x: { notes: "Short notice: our doctor is out tomorrow." } }, roll(today!), { userId: null, role: "PLATFORM_ADMIN", providerId: null, clinicOrgId: null }));
  }
  return done.length ? `${done.length} actions` : "nothing to do";
}
