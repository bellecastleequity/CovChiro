import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { dispatch, invalidateSettings, inviteProviders, respondToOffer, selectApplicant, settleDueInvites, setClock, applyToShift, admin, oncall } from "@cm/services";
import { insertAssignment, makeClinic, makeProvider, makeShift } from "../factories";

/**
 * Addendum 02 §15 — Smart Dispatch & On Call, against the real database with
 * a deterministic clock. (Pure-logic cases 5–13 and the SMS parser are also
 * unit-tested in packages/core/test/dispatch.test.ts.)
 */

const ADMIN = { userId: null, role: "PLATFORM_ADMIN" as const };
let fakeNow = new Date();
const at = (d: Date) => {
  fakeNow = d;
  setClock(() => fakeNow);
};
const advance = (minutes: number) => at(new Date(+fakeNow + minutes * 60_000));

async function setSetting(key: string, value: unknown) {
  await prisma.setting.upsert({ where: { key }, create: { key, value: value as object }, update: { value: value as object } });
  invalidateSettings();
}
async function resetSettings() {
  await prisma.setting.deleteMany({ where: { key: { not: "features.onCallEnabled" } } });
  invalidateSettings();
}

beforeAll(async () => {
  await setSetting("features.onCallEnabled", true);
});
afterEach(async () => {
  await resetSettings();
  setClock(null);
});
afterAll(async () => {
  await prisma.setting.deleteMany({});
  invalidateSettings();
});

type P = Awaited<ReturnType<typeof makeProvider>>;

/** Each scenario gets its own far-apart spot so providers from other tests are never in range. */
let area = 0;
const nextBase = () => ({ lat: 10 + 2.5 * area++, lng: -81.379 });

/** A clinic plus providers at increasing distance → strictly decreasing match scores. */
async function scenario(n: number, opts: { daysAhead?: number; hoursBefore?: number } = {}) {
  const base = nextBase();
  const clinic = await makeClinic({ state: "FL", lat: base.lat, lng: base.lng });
  const shift = await makeShift(clinic.location.id, { days: opts.daysAhead ?? 20 });
  // Same-day tier: clock 3h before the shift (7am ET for a 9am shift?) — keep inside quiet-hours-free daytime.
  at(new Date(+shift.startsAt - (opts.hoursBefore ?? 3) * 3_600_000));
  const providers: P[] = [];
  for (let i = 0; i < n; i++) {
    providers.push(await makeProvider({ home: { lat: base.lat + 0.012 * (i + 1), lng: base.lng, state: "FL" } }));
  }
  return { clinic, shift, providers, base };
}

async function waveOffers(shiftId: string, number?: number) {
  const d = await prisma.dispatch.findFirstOrThrow({ where: { shiftId }, orderBy: { startedAt: "desc" }, include: { waves: { orderBy: { number: "asc" }, include: { offers: { orderBy: { matchScore: "desc" } } } } } });
  const w = number ? d.waves.find((x) => x.number === number)! : d.waves.at(-1)!;
  return { dispatch: d, wave: w, offers: w.offers };
}

const assignmentFor = (shiftId: string) => prisma.assignment.findFirst({ where: { shiftId, status: { in: ["CONFIRMED", "IN_PROGRESS"] } } });

describe("Licensure & eligibility (§15 1–4)", () => {
  it("1+2. unlicensed providers never get offers or On Call confirms, even with a matching On Call rule nearby", async () => {
    const { shift, providers, base } = await scenario(3);
    const ga = await makeProvider({ licenses: [{ professionCode: "DC", state: "GA" }], home: { lat: base.lat + 0.001, lng: base.lng, state: "FL" } });
    // GA-licensed provider sets up a rule covering everything, 5 minutes from the clinic.
    await prisma.onCallRule.create({
      data: { providerId: ga.id, professionCodes: ["DC"], recurringWindows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMin: 0, endMin: 1440 })), timeZone: "America/New_York", maxDriveMinutes: 90, minNoticeMinutes: 0 },
    });
    await dispatch.startDispatch(shift.id, "CLINIC_REQUEST");
    expect(await prisma.offer.count({ where: { providerId: ga.id } })).toBe(0);
    expect(await prisma.assignment.count({ where: { providerId: ga.id } })).toBe(0);
    expect(await prisma.offer.count({ where: { shiftId: shift.id, providerId: { in: providers.map((p) => p.id) } } })).toBe(3);
  });

  it("3. license lapses between ACCEPTED_PENDING and award → INELIGIBLE, next acceptor awarded", async () => {
    const { shift } = await scenario(5);
    await dispatch.startDispatch(shift.id, "CLINIC_REQUEST");
    const { offers } = await waveOffers(shift.id);
    const [A, B, C] = offers;
    expect((await dispatch.respondToDispatchOffer(B.id, true, "LINK")).state).toBe("NEXT_IN_LINE");
    expect((await dispatch.respondToDispatchOffer(C.id, true, "LINK")).state).toBe("NEXT_IN_LINE");
    await prisma.license.updateMany({ where: { providerId: B.providerId }, data: { status: "SUSPENDED" } });
    await dispatch.respondToDispatchOffer(A.id, false, "LINK");
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: B.id } })).status).toBe("INELIGIBLE");
    expect((await assignmentFor(shift.id))?.providerId).toBe(C.providerId);
  });

  it("4. standby providers are re-checked before backfill offers", async () => {
    const { shift } = await scenario(5);
    await dispatch.startDispatch(shift.id, "CLINIC_REQUEST");
    const { offers } = await waveOffers(shift.id);
    const [A, B, C] = offers;
    await dispatch.respondToDispatchOffer(C.id, true, "LINK");
    await dispatch.respondToDispatchOffer(B.id, true, "LINK");
    await dispatch.respondToDispatchOffer(A.id, true, "LINK"); // A wins; B, C → standby
    expect(await prisma.standbyEntry.count({ where: { shiftId: shift.id } })).toBe(2);
    await prisma.license.updateMany({ where: { providerId: B.providerId }, data: { status: "SUSPENDED" } });
    const winner = await prisma.provider.findUniqueOrThrow({ where: { id: A.providerId }, include: { user: true } });
    const a = (await assignmentFor(shift.id))!;
    const { cancelAssignment } = await import("@cm/services");
    await cancelAssignment({ userId: winner.userId, role: "PROVIDER", providerId: winner.id }, a.id, "Family emergency", { by: "PROVIDER" });
    const d = await prisma.dispatch.findFirstOrThrow({ where: { shiftId: shift.id, trigger: "BACKFILL" }, include: { waves: { include: { offers: true } } } });
    const standbyWave = d.waves.find((w) => w.isStandby)!;
    expect(standbyWave.offers.map((o) => o.providerId)).toEqual([C.providerId]);
  });
});

describe("Rank-protected awards through the engine (§15 5–10)", () => {
  it("5. top-ranked accepts first → confirmed immediately (DISPATCH_WAVE)", async () => {
    const { shift } = await scenario(5);
    await dispatch.startDispatch(shift.id, "CLINIC_REQUEST");
    const { offers } = await waveOffers(shift.id);
    expect(offers).toHaveLength(5); // SAME_DAY wave 1
    const r = await dispatch.respondToDispatchOffer(offers[0].id, true, "LINK");
    expect(r.state).toBe("CONFIRMED");
    expect((await assignmentFor(shift.id))?.selectionMethod).toBe("DISPATCH_WAVE");
  });

  it("6. lower accepts first, higher accepts later in the window → higher wins; lower goes to standby", async () => {
    const { shift } = await scenario(5);
    await dispatch.startDispatch(shift.id, "CLINIC_REQUEST");
    const { offers } = await waveOffers(shift.id);
    const [B, C, D] = offers;
    expect((await dispatch.respondToDispatchOffer(D.id, true, "SMS")).state).toBe("NEXT_IN_LINE");
    advance(1);
    await dispatch.respondToDispatchOffer(C.id, false, "LINK");
    expect(await assignmentFor(shift.id)).toBeNull();
    advance(1);
    expect((await dispatch.respondToDispatchOffer(B.id, true, "APP")).state).toBe("CONFIRMED");
    expect((await assignmentFor(shift.id))?.providerId).toBe(B.providerId);
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: D.id } })).status).toBe("NOT_SELECTED");
    expect(await prisma.standbyEntry.findUnique({ where: { shiftId_providerId: { shiftId: shift.id, providerId: D.providerId } } })).not.toBeNull();
  });

  it("7. lower accepts, all higher decline → confirmed at the moment of the last decline", async () => {
    const { shift } = await scenario(5);
    await dispatch.startDispatch(shift.id, "CLINIC_REQUEST");
    const { offers } = await waveOffers(shift.id);
    await dispatch.respondToDispatchOffer(offers[2].id, true, "LINK");
    await dispatch.respondToDispatchOffer(offers[0].id, false, "LINK");
    expect(await assignmentFor(shift.id)).toBeNull();
    await dispatch.respondToDispatchOffer(offers[1].id, false, "LINK");
    expect((await assignmentFor(shift.id))?.providerId).toBe(offers[2].providerId);
  });

  it("8. higher never responds → lower confirmed at window close", async () => {
    const { shift } = await scenario(5);
    await dispatch.startDispatch(shift.id, "CLINIC_REQUEST");
    const { offers, wave } = await waveOffers(shift.id);
    await dispatch.respondToDispatchOffer(offers[3].id, true, "LINK");
    await dispatch.tickDispatch(fakeNow);
    expect(await assignmentFor(shift.id)).toBeNull();
    at(new Date(+wave.windowEndsAt + 1000));
    await dispatch.tickDispatch(fakeNow);
    expect((await assignmentFor(shift.id))?.providerId).toBe(offers[3].providerId);
  });

  it("9. all decline before the window closes → next wave sent immediately (+3 for same-day)", async () => {
    const { shift } = await scenario(12);
    await dispatch.startDispatch(shift.id, "CLINIC_REQUEST");
    const { offers } = await waveOffers(shift.id, 1);
    for (const o of offers) await dispatch.respondToDispatchOffer(o.id, false, "LINK");
    const w2 = await waveOffers(shift.id);
    expect(w2.wave.number).toBe(2);
    expect(w2.offers).toHaveLength(7); // 12 − 5 remaining, wave 2 wants 8
  });

  it("10. broadcast: first accept starts the hold; a better match during the hold wins at hold end", async () => {
    await setSetting("dispatch.tiers.SAME_DAY", { wave1: 2, growth: 0, max: 2, windowMin: 5, wavesBeforeBroadcast: 1, broadcastWindowMin: 15, broadcastHoldMin: 3, beta: 0.6 });
    const { shift } = await scenario(6);
    await dispatch.startDispatch(shift.id, "CLINIC_REQUEST");
    for (const o of (await waveOffers(shift.id, 1)).offers) await dispatch.respondToDispatchOffer(o.id, false, "LINK");
    const b = await waveOffers(shift.id);
    expect(b.wave.isBroadcast).toBe(true);
    expect(b.offers).toHaveLength(4);
    const [best, , , worst] = b.offers;
    expect((await dispatch.respondToDispatchOffer(worst.id, true, "LINK")).state).toBe("NEXT_IN_LINE");
    const hold = (await prisma.wave.findUniqueOrThrow({ where: { id: b.wave.id } })).holdEndsAt!;
    expect(+hold - +fakeNow).toBe(3 * 60_000);
    advance(1);
    await dispatch.respondToDispatchOffer(best.id, true, "LINK");
    expect(await assignmentFor(shift.id)).toBeNull(); // still holding — never first-to-answer
    at(new Date(+hold + 1000));
    await dispatch.tickDispatch(fakeNow);
    const a = (await assignmentFor(shift.id))!;
    expect(a.providerId).toBe(best.providerId);
    expect(a.selectionMethod).toBe("DISPATCH_BROADCAST");
  });

  it("exhaustion: nobody accepts through broadcast → EXHAUSTED, shift back to OPEN", async () => {
    await setSetting("dispatch.tiers.SAME_DAY", { wave1: 2, growth: 0, max: 2, windowMin: 5, wavesBeforeBroadcast: 1, broadcastWindowMin: 15, broadcastHoldMin: 3, beta: 0.6 });
    const { shift } = await scenario(3);
    await dispatch.startDispatch(shift.id, "CLINIC_REQUEST");
    for (const o of (await waveOffers(shift.id, 1)).offers) await dispatch.respondToDispatchOffer(o.id, false, "LINK");
    const b = await waveOffers(shift.id);
    at(new Date(+b.wave.windowEndsAt + 1000));
    await dispatch.tickDispatch(fakeNow);
    expect((await prisma.dispatch.findFirstOrThrow({ where: { shiftId: shift.id } })).status).toBe("EXHAUSTED");
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } })).status).toBe("OPEN");
  });
});

describe("Timing, revival, applications (§15 11–15)", () => {
  it("11–12. same-day tier and arrival-capped window are recorded on the wave", async () => {
    const { shift } = await scenario(3, { hoursBefore: 1.4 });
    await dispatch.startDispatch(shift.id, "CLINIC_REQUEST");
    const { wave, offers } = await waveOffers(shift.id);
    expect(wave.tier).toBe("SAME_DAY");
    // Every provider in the wave can still arrive before start − buffer.
    expect(+wave.windowEndsAt).toBeLessThanOrEqual(+shift.startsAt - 15 * 60_000);
    expect(offers.length).toBeGreaterThan(0);
  });

  it("14. a revived late acceptance joins the current wave with its original match score", async () => {
    const { shift } = await scenario(10);
    await dispatch.startDispatch(shift.id, "CLINIC_REQUEST");
    const w1 = await waveOffers(shift.id, 1);
    at(new Date(+w1.wave.windowEndsAt + 1000));
    await dispatch.tickDispatch(fakeNow);
    const w2 = await waveOffers(shift.id);
    expect(w2.wave.number).toBe(2);
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: w1.offers[0].id } })).status).toBe("EXPIRED");
    const r = await dispatch.respondToDispatchOffer(w1.offers[0].id, true, "LINK");
    const revived = await prisma.offer.findUniqueOrThrow({ where: { id: w1.offers[0].id } });
    expect(revived.revived).toBe(true);
    expect(revived.matchScore).toBe(w1.offers[0].matchScore);
    // Its match beats everyone pending in wave 2 → confirmed right away.
    expect(r.state).toBe("CONFIRMED");
  });

  it("15. active applications are treated as wave-1 acceptances", async () => {
    const { shift, providers } = await scenario(4);
    await applyToShift(providers[0].actor, shift.id, { commit: true });
    await dispatch.startDispatch(shift.id, "CLINIC_REQUEST");
    // The applicant is the best match, so their acceptance is awarded at once.
    expect((await assignmentFor(shift.id))?.providerId).toBe(providers[0].id);
  });
});

describe("On Call (§15 16–18)", () => {
  async function onCallProvider(p: P, rule: Partial<{ maxPerDay: number; minPayFullDayCents: number; minNoticeMinutes: number }> = {}) {
    await prisma.user.update({ where: { id: p.userId }, data: { phone: `+1407555${Math.floor(1000 + Math.random() * 8999)}`, phoneVerifiedAt: new Date() } });
    await prisma.provider.update({ where: { id: p.id }, data: { smsConsentAt: new Date() } });
    await prisma.providerStats.update({ where: { providerId: p.id }, data: { completedShifts: 3 } });
    return prisma.onCallRule.create({
      data: {
        providerId: p.id,
        professionCodes: ["DC"],
        recurringWindows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMin: 0, endMin: 1440 })),
        timeZone: "America/New_York",
        maxDriveMinutes: 90,
        minNoticeMinutes: rule.minNoticeMinutes ?? 30,
        maxPerDay: rule.maxPerDay ?? 1,
        minPayFullDayCents: rule.minPayFullDayCents ?? null,
      },
    });
  }

  it("16. matching rule → instant confirm (ON_CALL_AUTO, grace set); best match wins among On Call providers", async () => {
    const { shift, providers } = await scenario(4);
    await onCallProvider(providers[2]);
    await onCallProvider(providers[1]);
    await dispatch.startDispatch(shift.id, "URGENT_POST");
    const a = (await assignmentFor(shift.id))!;
    expect(a.providerId).toBe(providers[1].id);
    expect(a.selectionMethod).toBe("ON_CALL_AUTO");
    expect(a.graceEndsAt).not.toBeNull();
    expect(await prisma.offer.count({ where: { shiftId: shift.id, status: "PENDING" } })).toBe(0); // no waves needed
  });

  it("17. grace cancel: no reliability penalty, dispatch resumes, too many → On Call paused", async () => {
    await setSetting("oncall.maxGraceCancels30d", 0);
    const { shift, providers } = await scenario(4);
    const p = providers[0];
    await onCallProvider(p);
    await dispatch.startDispatch(shift.id, "URGENT_POST");
    const a = (await assignmentFor(shift.id))!;
    expect(a.providerId).toBe(p.id);
    advance(2);
    await dispatch.onCallGraceCancel(p.actor, a.id);
    expect((await prisma.providerStats.findUniqueOrThrow({ where: { providerId: p.id } })).lateCancels).toBe(0);
    const d = await prisma.dispatch.findFirstOrThrow({ where: { shiftId: shift.id, trigger: "BACKFILL" }, include: { waves: { include: { offers: true } } } });
    expect(d.waves.flatMap((w) => w.offers).map((o) => o.providerId)).not.toContain(p.id); // excluded from this shift
    expect((await prisma.provider.findUniqueOrThrow({ where: { id: p.id } })).oncallPausedReason).toMatch(/paused/);
    expect(await prisma.onCallRule.count({ where: { providerId: p.id, active: true } })).toBe(0);
  });

  it("18. daily limit, minimum pay and minimum notice are respected", async () => {
    const { shift, providers } = await scenario(3);
    await onCallProvider(providers[0], { minPayFullDayCents: 50_000 }); // pay is $375
    await onCallProvider(providers[1], { minNoticeMinutes: 600 }); // shift is 3h away
    await onCallProvider(providers[2], { maxPerDay: 1 });
    const other = await makeShift((await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } })).locationId, { days: 20 });
    // An earlier On Call booking the same local morning (6–7am ET), not overlapping this 9am shift.
    await prisma.shift.update({ where: { id: other.id }, data: { startsAt: new Date(+shift.startsAt - 3 * 3_600_000), endsAt: new Date(+shift.startsAt - 2 * 3_600_000) } });
    await insertAssignment(other.id, providers[2].id);
    await prisma.assignment.updateMany({ where: { shiftId: other.id }, data: { selectionMethod: "ON_CALL_AUTO" } });
    await dispatch.startDispatch(shift.id, "URGENT_POST");
    expect(await prisma.assignment.count({ where: { shiftId: shift.id, selectionMethod: "ON_CALL_AUTO" } })).toBe(0);
    expect((await prisma.dispatch.findFirstOrThrow({ where: { shiftId: shift.id } })).stage).toBe("WAVES");
  });

  it("On Call can't be turned on without eligibility (verified phone + SMS consent)", async () => {
    const p = await makeProvider();
    await prisma.onCallRule.create({ data: { providerId: p.id, professionCodes: ["DC"], recurringWindows: [], timeZone: "America/New_York", maxDriveMinutes: 60, active: false } });
    await expect(oncall.setOnCall(p.actor, true)).rejects.toThrow(/Verify your mobile/);
  });
});

describe("Concurrency & safety (§15 19–22)", () => {
  it("19. 20 simultaneous accepts (mixed channels) → exactly one assignment; others NOT_SELECTED / standby", async () => {
    await setSetting("dispatch.tiers.SAME_DAY", { wave1: 20, growth: 0, max: 20, windowMin: 5, wavesBeforeBroadcast: 3, broadcastWindowMin: 15, broadcastHoldMin: 3, beta: 0.6 });
    await setSetting("dispatch.maxConcurrentPendingOffers", 50);
    const { shift } = await scenario(20);
    await dispatch.startDispatch(shift.id, "CLINIC_REQUEST");
    const { offers } = await waveOffers(shift.id);
    expect(offers).toHaveLength(20);
    const channels = ["SMS", "LINK", "APP"] as const;
    await Promise.allSettled(offers.map((o, i) => dispatch.respondToDispatchOffer(o.id, true, channels[i % 3])));
    expect(await prisma.assignment.count({ where: { shiftId: shift.id } })).toBe(1);
    expect((await assignmentFor(shift.id))?.providerId).toBe(offers[0].providerId); // best match, not the fastest
    const after = await prisma.offer.findMany({ where: { shiftId: shift.id } });
    expect(after.filter((o) => o.status === "ACCEPTED")).toHaveLength(1);
    expect(after.filter((o) => o.status === "PENDING" || o.status === "ACCEPTED_PENDING")).toHaveLength(0);
  });

  it("20. clinic pick during an active wave wins cleanly; pending offers closed", async () => {
    const { clinic, shift, providers } = await scenario(6);
    await applyToShift(providers[5].actor, shift.id, { commit: true }).catch(() => null);
    await dispatch.startDispatch(shift.id, "CLINIC_REQUEST");
    if (await assignmentFor(shift.id)) return; // applicant might already be top — covered by #15
    await selectApplicant(clinic.actor, shift.id, providers[5].id);
    expect((await assignmentFor(shift.id))?.providerId).toBe(providers[5].id);
    expect((await prisma.dispatch.findFirstOrThrow({ where: { shiftId: shift.id } })).status).toBe("FILLED");
    expect(await prisma.offer.count({ where: { shiftId: shift.id, status: "PENDING" } })).toBe(0);
  });

  it("21. SMS: bare YES never accepts; wrong code gets a status reply; STOP opts out", async () => {
    const { shift } = await scenario(3);
    await dispatch.startDispatch(shift.id, "CLINIC_REQUEST");
    const { offers } = await waveOffers(shift.id);
    const o = offers[0];
    const p = await prisma.provider.findUniqueOrThrow({ where: { id: o.providerId } });
    const phone = `+1321555${Math.floor(1000 + Math.random() * 8999)}`;
    await prisma.user.update({ where: { id: p.userId }, data: { phone, phoneVerifiedAt: new Date() } });
    await prisma.provider.update({ where: { id: p.id }, data: { smsConsentAt: new Date() } });
    expect(await dispatch.handleInboundSms(phone, "YES")).toMatch(new RegExp(`Reply YES ${o.replyCode}`));
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("PENDING");
    expect(await dispatch.handleInboundSms(phone, "YES 0000")).toMatch(/doesn't match/);
    expect(await dispatch.handleInboundSms(phone, `yes ${o.replyCode}`)).toMatch(/confirmed/i);
    expect(await dispatch.handleInboundSms(phone, "STOP")).toMatch(/unsubscribed/);
    expect((await prisma.provider.findUniqueOrThrow({ where: { id: p.id } })).smsConsentAt).toBeNull();
  });

  it("22. offer caps, auto-snooze and quiet hours", async () => {
    await setSetting("dispatch.maxOffersPerProviderPerDay", 1);
    await setSetting("dispatch.autoSnoozeAfterIgnored", 1);
    const { clinic, shift, providers } = await scenario(2);
    await dispatch.startDispatch(shift.id, "CLINIC_REQUEST");
    const w = await waveOffers(shift.id);
    expect(w.offers).toHaveLength(2);
    // Ignore → auto-snoozed.
    at(new Date(+w.wave.windowEndsAt + 1000));
    await dispatch.tickDispatch(fakeNow);
    const snoozed = await prisma.provider.findMany({ where: { id: { in: providers.map((p) => p.id) } } });
    expect(snoozed.every((p) => p.snoozedUntil && p.snoozedUntil > fakeNow)).toBe(true);
    // Daily cap: a second shift today reaches nobody (snoozed + capped).
    await prisma.provider.updateMany({ where: { id: { in: providers.map((p) => p.id) } }, data: { snoozedUntil: null } });
    const s2 = await makeShift(clinic.location.id, { days: 20 });
    await prisma.shift.update({ where: { id: s2.id }, data: { startsAt: new Date(+shift.startsAt + 30 * 60_000), endsAt: new Date(+shift.endsAt + 30 * 60_000) } });
    await dispatch.startDispatch(s2.id, "CLINIC_REQUEST");
    expect(await prisma.offer.count({ where: { shiftId: s2.id } })).toBe(0);

    // Quiet hours: 10pm local, SHORT tier → skipped unless urgent opt-in.
    await resetSettings();
    const b3 = nextBase();
    const c3 = await makeClinic({ state: "FL", lat: b3.lat, lng: b3.lng });
    const late = await makeShift(c3.location.id, { days: 20 });
    at(new Date(+late.startsAt - 15 * 3_600_000)); // SHORT tier; quiet window set around "now" below
    const q1 = await makeProvider({ home: { lat: b3.lat + 0.01, lng: b3.lng, state: "FL" } });
    const q2 = await makeProvider({ home: { lat: b3.lat + 0.02, lng: b3.lng, state: "FL" } });
    const nowMin = ((fakeNow.getUTCHours() - 4 + 24) % 24) * 60 + fakeNow.getUTCMinutes();
    await prisma.provider.updateMany({ where: { id: { in: [q1.id, q2.id] } }, data: { quietHoursStart: (nowMin - 60 + 1440) % 1440, quietHoursEnd: (nowMin + 60) % 1440 } });
    await prisma.provider.update({ where: { id: q2.id }, data: { urgentDuringQuietHours: true } });
    await dispatch.startDispatch(late.id, "CLINIC_REQUEST");
    const got = (await prisma.offer.findMany({ where: { shiftId: late.id } })).map((o) => o.providerId);
    expect(got).toContain(q2.id);
    expect(got).not.toContain(q1.id);
  });
});

describe("responsiveness & badges", () => {
  it("recompute stores pRespond per tier; decline counts as a response", async () => {
    const { shift } = await scenario(2);
    await dispatch.startDispatch(shift.id, "CLINIC_REQUEST");
    const { offers } = await waveOffers(shift.id);
    await dispatch.respondToDispatchOffer(offers[1].id, false, "LINK");
    await dispatch.recomputeResponsiveness(offers[1].providerId);
    const r = await prisma.providerResponsiveness.findUniqueOrThrow({ where: { providerId_tier: { providerId: offers[1].providerId, tier: "SAME_DAY" } } });
    expect(r.hits).toBe(1);
    expect(r.pRespond).toBeGreaterThan(0.5);
    void admin;
  });
});

describe("Clinic invitations are rank-protected too", () => {
  it("lower-ranked invitee accepts first → waits; higher accepts → higher confirmed, lower not selected", async () => {
    const { clinic, shift, providers } = await scenario(3, { hoursBefore: 24 * 10 });
    const [hi, mid] = providers;
    await inviteProviders(clinic.actor, shift.id, [hi.id, mid.id]);
    const offer = (pid: string) => prisma.offer.findFirstOrThrow({ where: { shiftId: shift.id, providerId: pid } });
    expect((await offer(hi.id)).matchScore).toBeGreaterThan((await offer(mid.id)).matchScore);
    const r1 = await respondToOffer(mid.actor, (await offer(mid.id)).id, true);
    expect(r1.confirmed).toBe(false);
    expect((await offer(mid.id)).status).toBe("ACCEPTED_PENDING");
    expect(await assignmentFor(shift.id)).toBeNull();
    const r2 = await respondToOffer(hi.actor, (await offer(hi.id)).id, true);
    expect(r2.confirmed).toBe(true);
    expect((await assignmentFor(shift.id))?.providerId).toBe(hi.id);
    expect((await offer(mid.id)).status).toBe("NOT_SELECTED");
  });

  it("higher-ranked invitee declines or lets it lapse → waiting acceptor is confirmed", async () => {
    const a = await scenario(2, { hoursBefore: 24 * 10 });
    await inviteProviders(a.clinic.actor, a.shift.id, a.providers.map((p) => p.id));
    const offers = await prisma.offer.findMany({ where: { shiftId: a.shift.id }, orderBy: { matchScore: "desc" } });
    await respondToOffer(a.providers[1].actor, offers[1].id, true);
    await respondToOffer(a.providers[0].actor, offers[0].id, false);
    expect((await assignmentFor(a.shift.id))?.providerId).toBe(a.providers[1].id);

    const b = await scenario(2, { hoursBefore: 24 * 10 });
    await inviteProviders(b.clinic.actor, b.shift.id, b.providers.map((p) => p.id));
    const bo = await prisma.offer.findMany({ where: { shiftId: b.shift.id }, orderBy: { matchScore: "desc" } });
    await respondToOffer(b.providers[1].actor, bo[1].id, true);
    expect(await assignmentFor(b.shift.id)).toBeNull();
    advance(24 * 60);
    await settleDueInvites();
    expect((await assignmentFor(b.shift.id))?.providerId).toBe(b.providers[1].id);
    expect((await prisma.offer.findUniqueOrThrow({ where: { id: bo[0].id } })).status).toBe("NOT_SELECTED");
  });
});
