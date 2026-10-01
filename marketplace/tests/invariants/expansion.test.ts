import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { devOutbox, setNppesProvider, type NppesQuery, type NppesRecord } from "@cm/integrations";
import { accounts, admin as adminSvc, auth, createShift, growth, invalidateSettings, postShift, updateDraftShift } from "@cm/services";
import { futureWeekday, makeClinic, makeProvider, uid } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };

async function setting(key: string, value: unknown) {
  await adminSvc.updateSetting(admin, key, value);
  invalidateSettings();
}
const agents = async (on: Record<string, boolean>) => setting("growth.agents", { ...(await import("@cm/config")).defaultSettings()["growth.agents"], ...on });

beforeAll(async () => {
  await growth.ensureGrowthDefaults();
  await setting("growth.postalAddress", "1 Main St, Orlando, FL 32801");
  await setting("growth.clinicMarketing", true);
});

afterEach(async () => {
  setNppesProvider(null);
  await setting("growth.agents", { ...(await import("@cm/config")).defaultSettings()["growth.agents"] });
  await setting("growth.outreachMode", "review");
});

// A PT practice and a chiropractor in one city; the registry is searched by taxonomy name.
function registry(city: string) {
  const n = () => String(1000000000 + Math.floor(Math.random() * 8_999_999_999)).slice(0, 10);
  const loc = (line1: string) => ({ line1, line2: null, city: city.toUpperCase(), state: "GA", zip: "30303", phone: null });
  const recs: (NppesRecord & { taxonomy: string })[] = [
    { taxonomy: "Physical Therapist", npi: n(), kind: "individual", name: "", firstName: "LEE", lastName: "PARK", credential: "PT", taxonomyCodes: ["225100000X"], location: loc(`${uid().slice(0, 4)} Peach St`) },
    { taxonomy: "Chiropractor", npi: n(), kind: "individual", name: "", firstName: "ANA", lastName: "RIVERA", credential: "DC", taxonomyCodes: ["111N00000X"], location: loc(`${uid().slice(0, 4)} Oak St`) },
  ];
  const searched: NppesQuery[] = [];
  return {
    searched,
    search: async (q: NppesQuery) => {
      searched.push(q);
      return q.skip ? [] : recs.filter((r) => r.taxonomy === q.taxonomy && (q.enumerationType === "NPI-1") === (r.kind === "individual"));
    },
  };
}

describe("growth expansion: profession × state targets", () => {
  it("OFF does nothing; PRELAUNCH discovers that profession's practices in that state", async () => {
    const city = `Ptville${uid()}`;
    const reg = registry(city);
    setNppesProvider({ name: "fake", search: reg.search });
    await agents({ clinicProspecting: true });
    await growth.saveTargetCities(admin, "PT", "GA", [city]);

    await growth.discoverySweep({ professionCode: "PT", state: "GA" });
    expect(reg.searched.some((q) => q.city === city)).toBe(false); // OFF

    await growth.setTargetStatus(admin, "PT", "GA", "PRELAUNCH");
    await growth.discoverySweep({ professionCode: "PT", state: "GA" });
    expect(reg.searched.filter((q) => q.city === city).every((q) => q.taxonomy === "Physical Therapist" && q.state === "GA")).toBe(true);
    const rows = await prisma.clinicProspect.findMany({ where: { city } });
    expect(rows.map((r) => [r.clinicName, r.professionCodes])).toEqual([["Dr. Lee Park, PT", ["PT"]]]);
    // Prelaunch adds no schools for PT (no built-in list) but never errors; DC's list is there.
    expect(await prisma.school.count({ where: { professionCode: "DC" } })).toBeGreaterThan(10);
  });

  it("Live is refused while the marketplace is off for that pair", async () => {
    await expect(growth.setTargetStatus(admin, "OT", "GA", "LIVE")).rejects.toThrow(/States & professions/);
  });

  it("clinic outreach only where the target is LIVE and the marketplace is on", async () => {
    await agents({ clinicOutreach: true });
    const mk = async (state: string, professionCodes: string[]) => {
      const p = await growth.saveProspect(admin, { clinicName: `Clinic ${uid()}`, ownerName: "Dr. Kim Lee", email: `office-${uid()}@clinic.dev`, city: "Somewhere", zip: "30303", providerCount: 1 });
      await prisma.clinicProspect.update({ where: { id: p.id }, data: { state, professionCodes } });
      return p.id;
    };
    const flDc = await mk("FL", ["DC"]); // seeded LIVE + marketplace on
    const gaPt = await mk("GA", ["PT"]); // prelaunch
    const gaDc = await mk("GA", ["DC"]); // no target
    // LIVE with the marketplace off (e.g. switched off later in States & professions) is held too,
    // even though chiropractic has approved outreach emails.
    await prisma.growthTarget.upsert({ where: { professionCode_state: { professionCode: "DC", state: "WY" } }, create: { professionCode: "DC", state: "WY", status: "LIVE" }, update: { status: "LIVE" } });
    const wyDc = await mk("WY", ["DC"]);

    await growth.growthTick();
    const drafted = async (id: string) => prisma.communication.count({ where: { entityId: id, promptKey: "CLINIC_FIRST_CONTACT" } });
    expect(await drafted(flDc)).toBe(1);
    expect(await drafted(gaPt)).toBe(0);
    expect(await drafted(gaDc)).toBe(0);
    expect(await drafted(wyDc)).toBe(0);
    expect(await growth.outreachAllowed("DC", "FL")).toBe(true);
    expect(await growth.outreachAllowed("DC", "WY")).toBe(false);
  });

  it("a profession never gets another profession's wording: no approved PT emails = PT providers skipped", async () => {
    await growth.setTargetStatus(admin, "PT", "GA", "PRELAUNCH");
    const pt = await makeProvider({ licenses: [{ professionCode: "PT", state: "GA" }], home: { lat: 33.75, lng: -84.39, state: "GA" } });
    await growth.growthTick();
    expect(await prisma.communication.count({ where: { entityId: pt.id } })).toBe(0);
    expect(await growth.promptReadiness("PT")).toMatchObject({ providerMissing: expect.arrayContaining(["PROVIDER_WELCOME"]) });

    // Starter drafts are drafts: still nothing sent until a person approves and activates them.
    expect(await growth.createStarterDrafts(admin, "PT")).toBeGreaterThan(0);
    const welcome = await prisma.promptTemplate.findFirstOrThrow({ where: { key: "PROVIDER_WELCOME", professionCode: "PT" } });
    expect(welcome.status).toBe("DRAFT");
    expect(welcome.body.toLowerCase()).not.toContain("chiropract");
    await growth.growthTick();
    expect(await prisma.communication.count({ where: { entityId: pt.id } })).toBe(0);

    for (const k of ["PROVIDER_WELCOME", "PROVIDER_LICENSE_REMINDER", "PROVIDER_MALPRACTICE_REMINDER", "PROVIDER_COVERAGE_READY", "PROVIDER_REACTIVATION"]) {
      const row = await prisma.promptTemplate.findFirstOrThrow({ where: { key: k, professionCode: "PT" } });
      await growth.promptStatus(admin, row.id, "approve");
      await growth.promptStatus(admin, row.id, "activate");
    }
    // Activating PT's version leaves chiropractic's active.
    expect(await prisma.promptTemplate.count({ where: { key: "PROVIDER_WELCOME", professionCode: "DC", active: true } })).toBe(1);
    await growth.growthTick();
    const sent = await prisma.communication.findMany({ where: { entityId: pt.id } });
    expect(sent.map((c) => c.promptKey)).toContain("PROVIDER_WELCOME");
    expect(sent.every((c) => c.promptVersion === null || c.promptKey !== "PROVIDER_WELCOME" || c.promptVersion === welcome.version)).toBe(true);
  });

  it("providers are matched to the market they're licensed or live in", () => {
    const targets = [
      { professionCode: "DC", state: "FL", status: "LIVE" },
      { professionCode: "DC", state: "GA", status: "PRELAUNCH" },
      { professionCode: "PT", state: "TX", status: "OFF" },
    ];
    expect(growth.providerTargetFrom({ professions: ["DC"], licenseStates: ["GA"], homeState: "FL", intendedStates: [] }, targets)?.state).toBe("GA");
    expect(growth.providerTargetFrom({ professions: ["DC"], licenseStates: [], homeState: "NC", intendedStates: [] }, targets)?.state).toBe("FL");
    expect(growth.providerTargetFrom({ professions: ["PT"], licenseStates: ["TX"], homeState: "TX", intendedStates: [] }, targets)).toBeNull();
  });
});

describe("account moderation", () => {
  it("suspend stops matching, ban blocks sign-in and re-signup, reinstate undoes it", async () => {
    const p = await makeProvider();
    await accounts.moderateAccount(admin, { kind: "provider", id: p.id, action: "suspend", reason: "Paperwork check" });
    expect((await prisma.provider.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("SUSPENDED");

    await accounts.moderateAccount(admin, { kind: "provider", id: p.id, action: "ban", reason: "Repeated no-shows" });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: p.user.id } });
    expect(user.disabledAt).not.toBeNull();
    expect(await accounts.isEmailBanned(user.email.toUpperCase())).toBe(true);
    await prisma.user.update({ where: { id: user.id }, data: { email: `moved-${uid()}@test.dev` } });
    await expect(auth.signup({ role: "provider", name: "Again", email: user.email, password: "a-long-password-1", professionCodes: ["DC"], acceptTerms: true })).rejects.toThrow(/can't create an account/);
    await prisma.user.update({ where: { id: user.id }, data: { email: user.email } });

    await accounts.moderateAccount(admin, { kind: "provider", id: p.id, action: "reinstate", reason: "" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: p.user.id } })).disabledAt).toBeNull();
    expect(await accounts.isEmailBanned(user.email)).toBe(false);
    expect((await prisma.provider.findUniqueOrThrow({ where: { id: p.id } })).status).not.toBe("SUSPENDED");
  });

  it("a suspended clinic can't post; delete erases an account with history and removes one without", async () => {
    const c = await makeClinic();
    const { startsAt, endsAt } = futureWeekday(12);
    const { shiftId } = await createShift(c.actor, { locationId: c.location.id, professionCode: "DC", startsAt, endsAt }, { post: false });
    await accounts.moderateAccount(admin, { kind: "clinic", id: c.org.id, action: "suspend", reason: "Billing dispute" });
    await expect(postShift(c.actor, shiftId)).rejects.toThrow(/suspended/);

    await accounts.deleteAccount(admin, "clinic", c.org.id, "Owner asked us to close it");
    const org = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: c.org.id } }); // shift history keeps the shell
    expect(org).toMatchObject({ displayName: "Deleted clinic", status: "DEACTIVATED", billingEmail: null });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: c.user.id } })).email).toMatch(/@deleted\.invalid$/);

    const bare = await prisma.user.create({ data: { email: `bare-${uid()}@test.dev`, name: "Bare", role: "PROVIDER" } });
    const bp = await prisma.provider.create({ data: { userId: bare.id, legalName: "Bare", displayName: "Bare" } });
    expect(await accounts.deleteAccount(admin, "provider", bp.id, "Signed up by mistake")).toBe("Deleted.");
    expect(await prisma.user.findUnique({ where: { id: bare.id } })).toBeNull();
  });
});

describe("editing a saved draft shift", () => {
  it("re-validates and re-prices the draft; posted shifts can't be edited this way", async () => {
    const c = await makeClinic();
    const a = futureWeekday(14);
    const { shiftId } = await createShift(c.actor, { locationId: c.location.id, professionCode: "DC", startsAt: a.startsAt, endsAt: a.endsAt }, { post: false });
    const before = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    const b = futureWeekday(21, 13, 3);
    await updateDraftShift(c.actor, shiftId, { locationId: c.location.id, professionCode: "DC", startsAt: b.startsAt, endsAt: b.endsAt, notes: "Bring your own table cover" }, { post: false });
    const after = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(after).toMatchObject({ status: "DRAFT", notes: "Bring your own table cover" });
    expect(+after.startsAt).toBe(+b.startsAt);
    expect(+after.endsAt).toBe(+b.endsAt);
    expect(after.durationTier).not.toBe(before.durationTier); // re-priced by the rate engine: 3 hours is a half day
    await expect(updateDraftShift(c.actor, shiftId, { locationId: c.location.id, professionCode: "DC", startsAt: b.endsAt, endsAt: b.startsAt }, { post: false })).rejects.toThrow(/end time/);

    await prisma.shift.update({ where: { id: shiftId }, data: { status: "OPEN" } });
    await expect(updateDraftShift(c.actor, shiftId, { locationId: c.location.id, professionCode: "DC", startsAt: b.startsAt, endsAt: b.endsAt }, { post: false })).rejects.toThrow(/Only drafts/);
    expect(devOutbox).toBeDefined();
  });
});
