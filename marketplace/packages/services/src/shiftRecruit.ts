import { randomBytes } from "node:crypto";
import { DomainError, formatCents, parseVolumeTerms, selectionDeadline, VOLUME_TIER_LABEL } from "@cm/core";
import { prisma } from "@cm/db";
import { audit, clock, getSettings, requireAdmin, requireProvider, type Actor } from "./context";
import { evaluateProviderForShift } from "./eligibility";
import { rankEvaluated } from "./matching";
import { absoluteUrl, notify } from "./notify";

/**
 * "Recruit a colleague" for one shift. An admin makes a link (/s/<token>) and sends it to someone.
 * The link shows a summary (no clinic name or address, same as the shift board). Signing up or
 * signing in as a provider through it claims the shift; as soon as that provider is eligible
 * (INV-1 and every other filter, via the shared eligibility function) they get a normal admin
 * invitation, which stays rank-protected. The shift stays open to everyone else meanwhile.
 */

const HOUR = 3_600_000;
const professionName = async (code: string) => (await prisma.profession.findUnique({ where: { code }, select: { displayName: true } }))?.displayName ?? code;
const OPEN = ["OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING"];

export async function createLink(actor: Actor, shiftId: string, label?: string | null) {
  requireAdmin(actor);
  const shift = await prisma.shift.findUnique({ where: { id: shiftId }, include: { location: true } });
  if (!shift) throw new DomainError("NOT_FOUND", "Shift not found");
  if (!OPEN.includes(shift.status) || +shift.startsAt <= +clock.now()) throw new DomainError("CONFLICT", "This shift isn't open any more.");
  const link = await prisma.shiftRecruitLink.create({ data: { token: randomBytes(9).toString("base64url"), shiftId, createdById: actor.userId ?? null, label: label?.trim().slice(0, 80) || null } });
  await audit(prisma, actor, "shift.recruit_link", "Shift", shiftId, null, { linkId: link.id, label: link.label });
  return { ...link, url: recruitUrl(link.token) };
}

export const recruitUrl = (token: string) => absoluteUrl(`/s/${token}`);

/** A ready-to-send message for text or email. */
export async function shareMessage(token: string) {
  const sum = await summary(token, false);
  if (!sum || sum.state !== "OPEN") return null;
  const d = sum.shift;
  return `Hi! I have a ${d.professionName.toLowerCase()} coverage shift that might suit you: ${d.when}, ${d.city}, ${d.state}. Pays ${d.payLabel}${d.mileageNote ? " plus mileage" : ""}. Take a look and create a free profile to claim it: ${recruitUrl(token)}`;
}

/** Public summary behind a link (null = unknown link). */
export async function summary(token: string, countView = true) {
  const link = await prisma.shiftRecruitLink.findUnique({
    where: { token },
    include: { shift: { include: { location: true } } },
  });
  if (!link) return null;
  if (countView) await prisma.shiftRecruitLink.update({ where: { id: link.id }, data: { views: { increment: 1 } } }).catch(() => undefined);
  const sh = link.shift;
  const tz = sh.location.timeZone;
  const s = await getSettings();
  const open = OPEN.includes(sh.status) && +sh.startsAt > +clock.now();
  const groupDays = sh.shiftGroupId
    ? await prisma.shift.findMany({ where: { shiftGroupId: sh.shiftGroupId, status: { in: OPEN as never } }, orderBy: { startsAt: "asc" }, select: { startsAt: true, endsAt: true } })
    : [];
  const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" });
  const fmtTime = (d: Date) => d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const terms = parseVolumeTerms(sh.volumeTerms);
  const skills = sh.requiredSkillIds.length ? await prisma.skill.findMany({ where: { id: { in: sh.requiredSkillIds } }, select: { name: true } }) : [];
  return {
    state: open ? ("OPEN" as const) : ("CLOSED" as const),
    shiftId: sh.id,
    shift: {
      professionName: await professionName(sh.professionCode),
      date: fmtDay(sh.startsAt),
      time: `${fmtTime(sh.startsAt)} – ${fmtTime(sh.endsAt)}`,
      when: `${fmtDay(sh.startsAt)}, ${fmtTime(sh.startsAt)} – ${fmtTime(sh.endsAt)}`,
      otherDays: groupDays.filter((g) => +g.startsAt !== +sh.startsAt).map((g) => `${fmtDay(g.startsAt)}, ${fmtTime(g.startsAt)} – ${fmtTime(g.endsAt)}`),
      city: sh.location.city,
      state: sh.state,
      payCents: sh.providerPayCents,
      payLabel: formatCents(sh.providerPayCents),
      mileageNote: s["pricing.mileageRateCentsPerMile"] > 0,
      tier: sh.declaredTier ? `${VOLUME_TIER_LABEL[sh.declaredTier]} day` : null,
      expectedPatients: sh.expectedPatients,
      extraVisitCents: terms && sh.declaredTier ? terms.overageProviderCents : null,
      extraVisitsAfter: terms ? terms.ceiling + terms.grace : null,
      lodgingNightCents: sh.lodgingAllowed ? sh.lodgingCapCentsPerNight : null,
      requiredSkills: skills.map((k) => k.name),
      minYearsExperience: sh.minYearsExperience ?? 0,
    },
  };
}

/** Claim a link for a provider (after signup or when signed in). Tries the invitation right away. */
export async function claim(providerId: string, token: string) {
  const link = await prisma.shiftRecruitLink.findUnique({ where: { token } });
  if (!link) throw new DomainError("NOT_FOUND", "That link isn't valid.");
  const c = await prisma.shiftRecruitClaim.upsert({ where: { linkId_providerId: { linkId: link.id, providerId } }, create: { linkId: link.id, providerId }, update: {} });
  const r = await tryInvite(c.id);
  return { shiftId: link.shiftId, ...r };
}

export async function claimAsProvider(actor: Actor, token: string) {
  return claim(requireProvider(actor), token);
}

/** Signup hook: the new account came through a link (cookie). Never throws. */
export async function claimForUser(userId: string, token: string) {
  try {
    const p = await prisma.provider.findUnique({ where: { userId }, select: { id: true } });
    if (p) await claim(p.id, token);
  } catch (e) {
    console.error("shift recruit claim failed", e);
  }
}

/** Friendly next step for each eligibility failure. */
function nextStep(code: string, state: string, profession: string) {
  switch (code) {
    case "LICENSE_STATE_MISMATCH":
    case "LICENSE_PROFESSION_MISMATCH":
    case "LICENSE_EXPIRES_BEFORE_SHIFT":
      return { label: `Add your ${state} ${profession} license (we verify it)`, href: "/provider/credentials" };
    case "MALPRACTICE_INVALID":
      return { label: "Upload your malpractice certificate", href: "/provider/credentials" };
    case "PROVIDER_NOT_ACTIVE":
      return { label: "Finish your profile and payout setup", href: "/provider" };
    case "AGREEMENT_NOT_SIGNED":
      return { label: "Sign the Provider Platform Agreement", href: "/provider/profile#agreement" };
    case "OUTSIDE_AVAILABILITY":
      return { label: "Mark yourself available for this shift", href: null };
    case "TOO_FAR":
      return { label: "It's beyond your drive limit: raise it on your profile if you'd make the trip", href: "/provider/profile" };
    case "SCHEDULE_CONFLICT":
      return { label: "You're booked on another shift at that time", href: "/provider/assignments" };
    case "BELOW_PAY_FLOOR":
      return { label: "It pays less than your minimum pay", href: "/provider/profile#min-pay" };
    case "INSUFFICIENT_EXPERIENCE":
      return { label: "The clinic asks for more years of experience", href: "/provider/profile" };
    case "MISSING_REQUIRED_SKILL":
      return { label: "Add the required skills to your profile", href: "/provider/profile" };
    default:
      return { label: "This shift isn't available to you", href: null };
  }
}

/** Invite the claimant if they're eligible now; otherwise say what's missing. */
export async function tryInvite(claimId: string) {
  const c = await prisma.shiftRecruitClaim.findUniqueOrThrow({ where: { id: claimId }, include: { link: { include: { shift: { include: { location: true } } } }, provider: { select: { userId: true } } } });
  const sh = c.link.shift;
  const now = clock.now();
  if (c.invitedAt) return { invited: true as const, steps: [] };
  if (!OPEN.includes(sh.status) || +sh.startsAt <= +now + 2 * HOUR) return { invited: false as const, closed: true, steps: [] };
  // Already applied, invited or booked another way: nothing to do.
  const existing = await prisma.offer.findFirst({ where: { shiftId: sh.id, providerId: c.providerId, status: { in: ["PENDING", "ACCEPTED_PENDING"] } } });
  const applied = await prisma.application.findFirst({ where: { shiftId: sh.id, providerId: c.providerId, status: "ACTIVE" } });
  if (existing || applied) {
    await prisma.shiftRecruitClaim.update({ where: { id: c.id }, data: { invitedAt: now, offerId: existing?.id ?? null } });
    return { invited: true as const, steps: [] };
  }
  const profName = await professionName(sh.professionCode);
  const ev = await evaluateProviderForShift(prisma, c.providerId, sh.id);
  if (!ev.result.eligible) {
    const seen = new Set<string>();
    const steps = ev.result.failures
      .map((f) => nextStep(f.code, sh.state, profName))
      .filter((st) => (seen.has(st.label) ? false : (seen.add(st.label), true)));
    return { invited: false as const, steps };
  }
  const s = await getSettings();
  const { tier } = selectionDeadline(s["matching.deadlineTiers"], sh.postedAt ?? now, sh.startsAt);
  // A colleague may need a little time to look: at least 12 hours, never closer than 2 hours to the start.
  const expiresAt = new Date(Math.min(+now + Math.max(tier.offerWindowMinutes * 60_000, 12 * HOUR), +sh.startsAt - 2 * HOUR));
  const [ranked] = await rankEvaluated(prisma, ev.shift, [ev]);
  const offer = await prisma.offer.create({ data: { shiftId: sh.id, providerId: c.providerId, source: "ADMIN", expiresAt, matchScore: ranked?.score ?? 0 } });
  await prisma.shiftRecruitClaim.update({ where: { id: c.id }, data: { invitedAt: now, offerId: offer.id } });
  await audit(prisma, { userId: null, role: "PLATFORM_ADMIN" }, "offer.created", "Offer", offer.id, null, { shiftId: sh.id, providerId: c.providerId, via: "recruit_link" });
  const tz = sh.location.timeZone;
  await notify(prisma, c.provider.userId, {
    template: "offer_received",
    title: `Your shift is ready to accept: ${sh.startsAt.toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric" })}`,
    body: `The ${profName.toLowerCase()} shift you were sent (${sh.location.city}, ${sh.state}) is ready for you to review and accept. Respond by ${expiresAt.toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}; it's still open to other providers until someone is confirmed.`,
    link: "/provider/offers",
    ctaLabel: "Review and accept",
    sms: true,
  }).catch(() => undefined);
  return { invited: true as const, steps: [] };
}

/** Job: claimants who weren't eligible yet (verification, availability…) get invited once they are. */
export async function recruitSweep(now = clock.now()) {
  const due = await prisma.shiftRecruitClaim.findMany({
    where: { invitedAt: null, link: { shift: { status: { in: OPEN as never }, startsAt: { gt: new Date(+now + 2 * HOUR) } } } },
    select: { id: true },
    take: 200,
  });
  let invited = 0;
  for (const { id } of due) {
    const r = await tryInvite(id).catch(() => null);
    if (r?.invited) invited++;
  }
  return invited;
}

/** Provider dashboard: shifts sent to me and what's left before I can accept. */
export async function myClaims(actor: Actor) {
  const providerId = requireProvider(actor);
  const rows = await prisma.shiftRecruitClaim.findMany({
    where: { providerId },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { link: { include: { shift: { include: { location: true, assignments: { where: { providerId, status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] } }, select: { id: true } } } } } } },
  });
  const out = [];
  for (const c of rows) {
    const sh = c.link.shift;
    if (+sh.startsAt < +clock.now() - 24 * HOUR) continue;
    const mine = sh.assignments[0]?.id ?? null;
    const open = OPEN.includes(sh.status) && +sh.startsAt > +clock.now();
    let steps: { label: string; href: string | null }[] = [];
    let offerStatus: string | null = null;
    if (open && !c.invitedAt) steps = (await tryInvite(c.id).catch(() => ({ steps: [] as { label: string; href: string | null }[] }))).steps ?? [];
    const fresh = await prisma.shiftRecruitClaim.findUniqueOrThrow({ where: { id: c.id } });
    if (fresh.offerId) offerStatus = (await prisma.offer.findUnique({ where: { id: fresh.offerId }, select: { status: true } }))?.status ?? null;
    out.push({
      claimId: c.id,
      shiftId: sh.id,
      when: sh.startsAt,
      endsAt: sh.endsAt,
      timeZone: sh.location.timeZone,
      city: sh.location.city,
      state: sh.state,
      profession: await professionName(sh.professionCode),
      payCents: sh.providerPayCents,
      state_: mine ? "BOOKED" : !open ? "CLOSED" : fresh.invitedAt ? "INVITED" : "WAITING",
      offerStatus,
      assignmentId: mine,
      steps,
    });
  }
  return out;
}

/** "Mark me available for this shift": an open date covering the shift (claimants only). */
export async function markAvailableForClaim(actor: Actor, claimId: string) {
  const providerId = requireProvider(actor);
  const c = await prisma.shiftRecruitClaim.findFirst({ where: { id: claimId, providerId }, include: { link: { include: { shift: true } } } });
  if (!c) throw new DomainError("NOT_FOUND", "Not found");
  const sh = c.link.shift;
  await prisma.availabilityOpenDate.create({ data: { providerId, startsAt: new Date(+sh.startsAt - 3 * HOUR), endsAt: new Date(+sh.endsAt + 3 * HOUR) } });
  return tryInvite(c.id);
}

/** Admin: the links made for a shift, with who claimed them. */
export async function linksForShift(actor: Actor, shiftId: string) {
  requireAdmin(actor);
  const links = await prisma.shiftRecruitLink.findMany({
    where: { shiftId },
    orderBy: { createdAt: "desc" },
    include: { claims: { include: { provider: { select: { id: true, displayName: true, status: true } } } } },
  });
  return links.map((l) => ({ ...l, url: recruitUrl(l.token) }));
}
