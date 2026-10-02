import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { devOutbox } from "@cm/integrations";
import { leads, waitlist } from "@cm/services";
import { enablePair, uid } from "../factories";

const mails = (to: string) => devOutbox.filter((m) => m.to === to && m.channel === "email");

describe("waitlist openings", () => {
  it("emails the waitlist once when their profession opens in their state", async () => {
    const email = `wait-${uid()}@test.dev`;
    await prisma.profession.update({ where: { code: "ATC" }, data: { active: false } });
    await prisma.professionStateConfig.updateMany({ where: { professionCode: "ATC" }, data: { enabled: false } });
    const r = await leads.captureLead({ name: "Olive Tran", email, state: "FL", professionCode: "ATC", source: "waitlist", audience: "PROVIDER" });
    expect(r.alreadyOpen).toBe(false);
    expect(mails(email).at(-1)!.subject).toMatch(/on the .* waitlist/);

    await waitlist.waitlistOpeningSweep();
    expect(mails(email).length).toBe(1); // not open yet

    await enablePair("ATC", "FL");
    await prisma.profession.update({ where: { code: "ATC" }, data: { active: true } });
    await waitlist.waitlistOpeningSweep();
    const open = mails(email).at(-1)!;
    expect(open.subject).toMatch(/now open in Florida/);
    expect(open.body).toMatch(/signup\?role=provider&profession=ATC/);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: r.leadId } })).nextDripAt).toBeNull();

    await waitlist.waitlistOpeningSweep();
    expect(mails(email).length).toBe(2); // once only

    await prisma.professionStateConfig.updateMany({ where: { professionCode: "ATC" }, data: { enabled: false } });
    await prisma.profession.update({ where: { code: "ATC" }, data: { active: false } });
  });

  it("joining for a market that's already open gets the good news instead of 'you're on the list'", async () => {
    const email = `open-${uid()}@test.dev`;
    const r = await leads.captureLead({ name: "Clara Clinic", email, state: "FL", source: "waitlist", audience: "CLINIC" });
    expect(r.alreadyOpen).toBe(true);
    const m = mails(email);
    expect(m.length).toBe(1);
    expect(m[0].subject).toMatch(/now open in Florida/);
    expect(m[0].body).toMatch(/signup\?role=clinic/);
  });

  it("doesn't email someone waiting for a different state", async () => {
    const email = `wy-${uid()}@test.dev`;
    const r = await leads.captureLead({ name: "Wyatt", email, state: "WY", professionCode: "DC", source: "waitlist", audience: "CLINIC" });
    expect(r.alreadyOpen).toBe(false);
    await waitlist.waitlistOpeningSweep();
    expect(mails(email).every((x) => !/now open/.test(x.subject ?? ""))).toBe(true);
  });
});
