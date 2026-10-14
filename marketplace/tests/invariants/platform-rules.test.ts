import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { setModerationProvider } from "@cm/integrations";
import {
  AGREEMENT_VERSION, adminAssign, agreementForSigning, canViewLocationPhoto, messaging, requestAgreement, sha256, signAgreement, signedAgreement, standing,
} from "@cm/services";
import { makeClinic, makeProvider, makeShift } from "../factories";

const ADMIN = { userId: null, role: "PLATFORM_ADMIN" as const };
const actorOf = async (providerId: string) => {
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: providerId } });
  return { userId: p.userId, role: "PROVIDER" as const, providerId, clinicOrgId: null };
};
afterEach(() => setModerationProvider(null));

/** A clinic and provider who have completed one shift together. */
async function pair(days = 12) {
  const clinic = await makeClinic();
  const provider = await makeProvider();
  const shift = await makeShift(clinic.location.id, { days });
  const { assignmentId } = await adminAssign(ADMIN, shift.id, provider.id);
  await prisma.assignment.update({ where: { id: assignmentId }, data: { status: "COMPLETED", completedAt: new Date() } });
  return { clinic, provider, shift, assignmentId };
}

describe("message screening (non-circumvention)", () => {
  it("never delivers contact details — before or after working together — and keeps them for admin review", async () => {
    const { clinic, provider, shift } = await pair(14);
    const thread = await messaging.openThread(clinic.actor, { shiftId: shift.id, providerId: provider.id });
    await expect(messaging.sendMessage(clinic.actor, thread.id, "call me on four oh seven 555 one two three four")).rejects.toThrow(/wasn't sent/);
    await expect(messaging.sendMessage(await actorOf(provider.id), thread.id, "happy to, we can just work directly and skip the fees")).rejects.toThrow(/wasn't sent/);
    expect(await prisma.message.count({ where: { threadId: thread.id } })).toBe(0);
    const blocked = await prisma.blockedMessage.findMany({ where: { threadId: thread.id }, orderBy: { createdAt: "asc" } });
    expect(blocked[0].reasons).toContain("phone");
    expect(blocked[1].reasons).toEqual(["off-platform"]);
    expect(await prisma.adminTask.count({ where: { kind: "FLAGGED_MESSAGES", entityId: thread.id, resolvedAt: null } })).toBe(1);
    await messaging.sendMessage(clinic.actor, thread.id, "Parking is behind the building, see you at 8:30!");
    expect(await prisma.message.count({ where: { threadId: thread.id } })).toBe(1);
  });

  it("the AI check can block what the rules miss, and flags ambiguous messages without blocking", async () => {
    const { clinic, shift, provider } = await pair(16);
    const thread = await messaging.openThread(clinic.actor, { shiftId: shift.id, providerId: provider.id });
    setModerationProvider({ name: "anthropic", review: async (t) => (/coffee/.test(t) ? { decision: "block", reason: "meeting to arrange work elsewhere" } : { decision: "review", reason: "hint" }) });
    await expect(messaging.sendMessage(clinic.actor, thread.id, "let's grab coffee and talk about next year")).rejects.toThrow(/wasn't sent/);
    const r = await messaging.sendMessage(clinic.actor, thread.id, "Hope you'd consider more days with us");
    expect(r.message.flagged).toBe(true);
    const b = await prisma.blockedMessage.findFirstOrThrow({ where: { threadId: thread.id } });
    expect(b).toMatchObject({ source: "AI", reasons: ["ai"] });
  });
});

describe("in-house e-signature", () => {
  it("records consent, typed signature, IP/device and a SHA-256 of the exact text", async () => {
    const provider = await makeProvider();
    const actor = await actorOf(provider.id);
    const url = await requestAgreement(actor);
    const envelope = url.split("/").pop()!;
    const view = await agreementForSigning(actor, envelope);
    expect(view.doc.title).toMatch(/Provider Independent Contractor Agreement/);
    expect(view.doc.parties[1].lines[0]).toContain(provider.legalName);
    await expect(signAgreement(actor, envelope, { typedName: "Pat Provider", consent: true, agree: true, viewedHash: "0".repeat(64) }, { ip: "203.0.113.9", userAgent: "vitest" })).rejects.toThrow(/updated/);
    const id = await signAgreement(actor, envelope, { typedName: "Pat Provider", consent: true, agree: true, viewedHash: view.hash! }, { ip: "203.0.113.9", userAgent: "vitest" });
    const r = await signedAgreement(actor, id);
    expect(r.intact).toBe(true);
    expect(r.sig).toMatchObject({ status: "SIGNED", typedSignature: "Pat Provider", signerIp: "203.0.113.9", signerAgent: "vitest" });
    expect(r.sig.documentHash).toBe(sha256(r.sig.documentText!));
    expect(r.sig.consentAt).toBeTruthy();
    expect((await prisma.provider.findUniqueOrThrow({ where: { id: provider.id } })).agreementVersion).toBe(AGREEMENT_VERSION.PROVIDER);
    // Nobody else can read it.
    const other = await makeProvider();
    await expect(signedAgreement(await actorOf(other.id), id)).rejects.toThrow(/not found/i);
  });

  it("clinic signers must give their title; the clinic's legal name is prefilled", async () => {
    const clinic = await makeClinic();
    const envelope = (await requestAgreement(clinic.actor)).split("/").pop()!;
    const view = await agreementForSigning(clinic.actor, envelope);
    expect(view.doc.parties[1].lines[0]).toContain(clinic.org.legalName);
    expect(view.doc.sections.some((s) => /Non-circumvention/.test(s.heading))).toBe(true);
    await expect(signAgreement(clinic.actor, envelope, { typedName: "Chris Owner", consent: true, agree: true, viewedHash: view.hash! }, { ip: null, userAgent: null })).rejects.toThrow(/title/);
  });
});

describe("standing bookings", () => {
  it("propose → accept books each matching weekday ahead for that provider; ending releases shifts past the notice period", async () => {
    const { clinic, provider } = await pair(60); // outside the 4-week standing window, so no overlap
    const start = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const b = await standing.proposeStanding(clinic.actor, { providerId: provider.id, locationId: clinic.location.id, professionCode: "DC", weekdays: [2, 4], startTime: "09:00", endTime: "17:00", startsOn: start });
    await standing.respondStanding(await actorOf(provider.id), b.id, true);
    const shifts = await prisma.shift.findMany({ where: { standingBookingId: b.id }, include: { assignments: true }, orderBy: { startsAt: "asc" } });
    expect(shifts.length).toBeGreaterThanOrEqual(6); // ~4 weeks × 2 days
    expect(shifts.every((s) => s.assignments.some((a) => a.providerId === provider.id && a.status === "CONFIRMED" && a.selectionMethod === "STANDING"))).toBe(true);
    // Idempotent: a second sweep adds nothing.
    expect(await standing.generateStanding(b.id)).toBe(0);
    const r = await standing.endStanding(clinic.actor, b.id, "Hired permanent staff");
    expect(r.cancelled).toBeGreaterThan(0);
    const after = await prisma.shift.findMany({ where: { standingBookingId: b.id } });
    const cutoff = Date.now() + 14 * 86_400_000;
    expect(after.filter((s) => +s.startsAt > cutoff).every((s) => s.status === "CANCELLED")).toBe(true);
    expect(after.filter((s) => +s.startsAt <= cutoff).every((s) => s.status === "CONFIRMED")).toBe(true);
  });

  it("a change to days or hours waits for the provider; accepting books the new days and frees the dropped ones", async () => {
    const { clinic, provider } = await pair(60);
    const p = await actorOf(provider.id);
    const start = new Date(Date.now() + 1 * 86_400_000).toISOString().slice(0, 10);
    const b = await standing.proposeStanding(clinic.actor, { providerId: provider.id, locationId: clinic.location.id, professionCode: "DC", weekdays: [2, 4], startTime: "13:00", endTime: "17:00", startsOn: start });
    await standing.respondStanding(p, b.id, true);
    const tz = clinic.location.timeZone;
    const live = () => prisma.shift.findMany({ where: { standingBookingId: b.id, status: { not: "CANCELLED" } }, include: { assignments: true }, orderBy: { startsAt: "asc" } });
    const wd = (d: Date) => Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d).replace(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/, (x) => String(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(x) + 1)));
    const before = await live();
    expect(new Set(before.map((x) => wd(x.startsAt)))).toEqual(new Set([2, 4]));

    // Ramp up: Mon/Wed/Thu (Tue dropped). Nothing changes until the provider accepts.
    const r = await standing.proposeStandingChange(clinic.actor, b.id, { weekdays: [1, 3, 4], startTime: "13:00", endTime: "17:00", endsOn: null });
    expect(r).toMatchObject({ applied: false, needsConsent: true });
    expect((await live()).length).toBe(before.length);
    const [row] = await standing.providerStanding(p);
    expect(row.pending).toMatchObject({ weekdays: [1, 3, 4] });

    const a = await standing.respondStandingChange(p, b.id, true);
    expect(a.added).toBeGreaterThan(0);
    const after = await live();
    const freeFrom = Date.now() + 48 * 3_600_000;
    // Tuesdays more than 48 h away were cancelled at no charge; any sooner Tuesday stays booked.
    expect(after.filter((x) => wd(x.startsAt) === 2).every((x) => +x.startsAt <= freeFrom)).toBe(true);
    expect(a.released + a.kept.length).toBe(before.filter((x) => wd(x.startsAt) === 2).length);
    expect(after.some((x) => wd(x.startsAt) === 1) && after.some((x) => wd(x.startsAt) === 3)).toBe(true);
    expect(after.every((x) => x.assignments.some((y) => y.providerId === provider.id && y.status === "CONFIRMED"))).toBe(true);
    const cancelledTue = await prisma.shift.findMany({ where: { standingBookingId: b.id, status: "CANCELLED" }, include: { assignments: true } });
    expect(cancelledTue.every((x) => x.assignments.every((y) => y.cancelledBy === "CLINIC"))).toBe(true);
    expect(await prisma.payout.count({ where: { assignmentId: { in: cancelledTue.flatMap((x) => x.assignments.map((y) => y.id)) }, kind: "LATE_CANCEL" } })).toBe(0);
    expect((await prisma.standingBooking.findUniqueOrThrow({ where: { id: b.id } })).pendingChange).toBeNull();
    // Idempotent afterwards.
    expect(await standing.generateStanding(b.id)).toBe(0);
  });

  it("notes and a later end date apply at once; declining or withdrawing a change keeps the old pattern", async () => {
    const { clinic, provider } = await pair(60);
    const p = await actorOf(provider.id);
    const start = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const end = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const later = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    const b = await standing.proposeStanding(clinic.actor, { providerId: provider.id, locationId: clinic.location.id, professionCode: "DC", weekdays: [5], startTime: "13:00", endTime: "17:00", startsOn: start, endsOn: end });
    // Still a proposal: edited in place.
    await standing.proposeStandingChange(clinic.actor, b.id, { weekdays: [3, 5], startTime: "13:00", endTime: "17:00", endsOn: end });
    expect((await prisma.standingBooking.findUniqueOrThrow({ where: { id: b.id } })).weekdays).toEqual([3, 5]);
    await standing.respondStanding(p, b.id, true);
    const count = () => prisma.shift.count({ where: { standingBookingId: b.id, status: { not: "CANCELLED" } } });
    const n = await count();

    const r = await standing.proposeStandingChange(clinic.actor, b.id, { weekdays: [3, 5], startTime: "13:00", endTime: "17:00", endsOn: later, notes: "Park in the back" });
    expect(r).toMatchObject({ applied: true, needsConsent: false });
    const row = await prisma.standingBooking.findUniqueOrThrow({ where: { id: b.id } });
    expect(row.pendingChange).toBeNull();
    expect(row.notes).toBe("Park in the back");
    expect(await count()).toBeGreaterThanOrEqual(n);

    // Ending earlier needs consent; the provider declines → nothing changes.
    await standing.proposeStandingChange(clinic.actor, b.id, { weekdays: [3, 5], startTime: "13:00", endTime: "17:00", endsOn: end, notes: "Park in the back" });
    await standing.respondStandingChange(p, b.id, false);
    const kept = await prisma.standingBooking.findUniqueOrThrow({ where: { id: b.id } });
    expect(kept.pendingChange).toBeNull();
    expect(kept.endsOn!.toISOString().slice(0, 10)).toBe(later);

    // New hours, then withdrawn by the clinic.
    await standing.proposeStandingChange(clinic.actor, b.id, { weekdays: [3, 5], startTime: "12:00", endTime: "17:00", endsOn: later });
    await standing.withdrawStandingChange(clinic.actor, b.id);
    expect((await prisma.standingBooking.findUniqueOrThrow({ where: { id: b.id } })).startTime).toBe("13:00");
    await expect(standing.respondStandingChange(p, b.id, true)).rejects.toThrow(/no change waiting/);
  });

  it("only with a provider the clinic has completed a shift with", async () => {
    const clinic = await makeClinic();
    const stranger = await makeProvider();
    await expect(standing.proposeStanding(clinic.actor, { providerId: stranger.id, locationId: clinic.location.id, professionCode: "DC", weekdays: [1], startTime: "09:00", endTime: "17:00", startsOn: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10) })).rejects.toThrow(/completing a shift/);
  });
});

describe("clinic location photos", () => {
  it("visible to the clinic and to a provider booked there, not to other providers", async () => {
    const { clinic, provider } = await pair(18);
    const key = `locations/${clinic.location.id}/front.jpg`;
    await prisma.clinicLocation.update({ where: { id: clinic.location.id }, data: { photoKeys: [key] } });
    const upcoming = await makeShift(clinic.location.id, { days: 25 });
    await adminAssign(ADMIN, upcoming.id, provider.id);
    const other = await makeProvider();
    expect(await canViewLocationPhoto(clinic.actor, key)).toBe(true);
    expect(await canViewLocationPhoto(await actorOf(provider.id), key)).toBe(true);
    expect(await canViewLocationPhoto(await actorOf(other.id), key)).toBe(false);
    expect(await canViewLocationPhoto(clinic.actor, `locations/${clinic.location.id}/not-listed.jpg`)).toBe(false);
  });
});

describe("experience levels", () => {
  it("a clinic minimum filters providers, and emergency cover relaxes it unless the clinic opts out", async () => {
    const { getEligibleProviders, emergency } = await import("@cm/services");
    const clinic = await makeClinic();
    const junior = await makeProvider();
    await prisma.providerProfession.updateMany({ where: { providerId: junior.id }, data: { yearsInPractice: 1 } });
    await prisma.clinicOrg.update({ where: { id: clinic.org.id }, data: { minYearsExperience: 5 } });
    const shift = await makeShift(clinic.location.id, { days: 33 });
    await prisma.shift.update({ where: { id: shift.id }, data: { minYearsExperience: 5 } });
    const ids = async () => (await getEligibleProviders(prisma, shift.id)).eligible.map((e) => e.providerId);
    expect(await ids()).not.toContain(junior.id);
    await emergency.activateEmergency(shift.id, "ADMIN", "test");
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } })).minYearsExperience).toBe(0);
    expect(await ids()).toContain(junior.id);
  });

  it("providers can't claim more years than since graduation", async () => {
    const { updateProviderProfile } = await import("@cm/services");
    const p = await makeProvider();
    const pp = await prisma.providerProfession.findFirstOrThrow({ where: { providerId: p.id } });
    const base = { legalName: p.legalName, displayName: p.displayName, phone: "4075550100", homeAddress: "100 Main St, Orlando, FL 32801", maxDriveMinutes: 60 };
    const year = new Date().getFullYear();
    await expect(updateProviderProfile(await actorOf(p.id), { ...base, graduationYear: year - 3, yearsInPractice: { [pp.professionCode]: 8 } } as never)).rejects.toThrow(/can't be more than 3/);
  });
});

describe("request to hire (placement)", () => {
  it("request → admin quote → clinic accepts and pays → provider released and blocked from the clinic's shifts", async () => {
    const { hiring, getEligibleProviders } = await import("@cm/services");
    const admin = await prisma.user.create({ data: { email: `adm-${Date.now()}@test.dev`, name: "Admin", role: "PLATFORM_ADMIN", emailVerifiedAt: new Date() } });
    const ADMIN_USER = { userId: admin.id, role: "PLATFORM_ADMIN" as const, providerId: null, clinicOrgId: null };
    const { clinic, provider } = await pair(40);
    const r = await hiring.requestHire(clinic.actor, { providerId: provider.id, positionType: "FULL_TIME", callbackPhone: "407-555-0100" });
    await expect(hiring.requestHire(clinic.actor, { providerId: provider.id, positionType: "FULL_TIME" })).rejects.toThrow(/already have/);
    await expect(hiring.acceptHire(clinic.actor, r.id, { name: "Chris Owner", title: "Owner", agree: true }, { ip: null })).rejects.toThrow(/isn't ready/);
    const terms = await hiring.draftPlacementTerms(ADMIN_USER, r.id, 750_000);
    expect(terms).toContain("$7,500");
    await hiring.quoteHire(ADMIN_USER, r.id, 750_000, terms);
    const done = await hiring.acceptHire(clinic.actor, r.id, { name: "Chris Owner", title: "Owner", agree: true }, { ip: "198.51.100.4" });
    expect(done.status).toBe("RELEASED");
    const pay = await prisma.payment.findUniqueOrThrow({ where: { id: done.paymentId! } });
    expect(pay).toMatchObject({ type: "CONVERSION_FEE", amountCents: 750_000, status: "SUCCEEDED" });
    expect(await prisma.block.count({ where: { fromType: "CLINIC", fromId: clinic.org.id, toType: "PROVIDER", toId: provider.id } })).toBe(1);
    const next = await makeShift(clinic.location.id, { days: 45 });
    expect((await getEligibleProviders(prisma, next.id)).eligible.map((e) => e.providerId)).not.toContain(provider.id);
    // Paying twice never double-charges.
    await hiring.acceptHire(clinic.actor, r.id, { name: "Chris Owner", title: "Owner", agree: true }, { ip: null });
    expect(await prisma.payment.count({ where: { clinicOrgId: clinic.org.id, type: "CONVERSION_FEE" } })).toBe(1);
  });
});

describe("email-only mode (no texting set up)", () => {
  it("a text-only alert falls back to email when it can't be texted", async () => {
    const { devOutbox } = await import("@cm/integrations");
    const { notify } = await import("@cm/services");
    const clinic = await makeClinic();
    const before = devOutbox.filter((m) => m.channel === "email" && m.to === clinic.user.email).length;
    await notify(prisma, clinic.user.id, { template: "on_my_way", title: "Your provider is on the way", body: "Arriving about 8:45", email: false, sms: true });
    expect(devOutbox.filter((m) => m.channel === "email" && m.to === clinic.user.email).length).toBe(before + 1);
    // Something sent quietly on purpose (no email, no text) stays quiet.
    await notify(prisma, clinic.user.id, { template: "quiet", title: "In-app only", body: "x", email: false, sms: false });
    expect(devOutbox.filter((m) => m.channel === "email" && m.to === clinic.user.email).length).toBe(before + 1);
  });
});

describe("experience × student path", () => {
  it("students can save a future (expected) graduation year with no years practicing; others can't", async () => {
    const { updateProviderProfile } = await import("@cm/services");
    const year = new Date().getFullYear();
    // A real student: not licensed or insured yet (otherwise they'd graduate out of the student path on save).
    const student = await makeProvider({ status: "ONBOARDING", licenses: [], malpractice: null, professions: [{ code: "DC", status: "ONBOARDING" }] });
    const pp = await prisma.providerProfession.findFirstOrThrow({ where: { providerId: student.id } });
    await prisma.provider.update({ where: { id: student.id }, data: { preLicensure: true, preLicensureSince: new Date(), graduationYear: year + 1 } });
    const base = (p: { legalName: string; displayName: string }) => ({ legalName: p.legalName, displayName: p.displayName, phone: "4075550100", homeAddress: "100 Main St, Orlando, FL 32801", maxDriveMinutes: 60, personalInjuryExperience: false, bio: "Chiropractic student." });
    await expect(updateProviderProfile(await actorOf(student.id), { ...base(student), graduationYear: year + 1, yearsInPractice: { [pp.professionCode]: 0 } } as never)).resolves.toBeUndefined();
    await expect(updateProviderProfile(await actorOf(student.id), { ...base(student), graduationYear: year + 1, yearsInPractice: { [pp.professionCode]: 2 } } as never)).rejects.toThrow(/0 until you've graduated/);
    const licensed = await makeProvider();
    await expect(updateProviderProfile(await actorOf(licensed.id), { ...base(licensed), graduationYear: year + 1 } as never)).rejects.toThrow(/can't be in the future/);
  });
});
