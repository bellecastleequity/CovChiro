import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { devOutbox } from "@cm/integrations";
import { enrollment, leads, upsertLicense, waitlist } from "@cm/services";
import { makeProvider, uid } from "../factories";

const FAR = new Date(Date.now() + 400 * 86_400_000);

describe("Puerto Rico, U.S. Virgin Islands and the Canada waitlist", () => {
  it("PR and VI are states the site knows (off until enabled); a PR license enrolls and waits for the market", async () => {
    expect(await prisma.stateConfig.findMany({ where: { state: { in: ["PR", "VI"] } }, select: { state: true, enabled: true }, orderBy: { state: "asc" } })).toEqual([
      { state: "PR", enabled: false },
      { state: "VI", enabled: false },
    ]);
    const p = await makeProvider();
    await upsertLicense(p.actor as never, { professionCode: "DC", state: "PR", licenseNumber: `PR-${uid()}`, expiresAt: FAR });
    const s = await enrollment.enrollmentStatus(p.id);
    expect(s.waiting.find((w) => w.state === "PR")).toMatchObject({ stateName: "Puerto Rico" });
  });

  it("a Canadian province on the waitlist is stored, named in the email, and never announced as open", async () => {
    const email = `ca-${uid()}@test.dev`;
    const r = await leads.captureLead({ name: "Maple Chiro", email, state: "ON", professionCode: "DC", source: "waitlist", audience: "PROVIDER" });
    expect(r.alreadyOpen).toBe(false);
    const lead = await prisma.lead.findFirstOrThrow({ where: { email } });
    expect(lead.state).toBe("ON");
    const first = devOutbox.filter((m) => m.to === email).at(-1)!;
    expect(first.body).toMatch(/Ontario, Canada/);
    expect(first.body).toMatch(/your province/);
    await waitlist.waitlistOpeningSweep();
    expect(devOutbox.filter((m) => m.to === email && /now open/.test(m.subject ?? ""))).toHaveLength(0);
  });
});
