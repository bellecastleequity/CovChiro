import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { setClinicLogo } from "@cm/services";
import { makeClinic } from "../factories";

describe("clinic logo", () => {
  it("the owner sets and removes it; only keys under the clinic's own logo folder are accepted", async () => {
    const c = await makeClinic();
    const key = `photos/clinic-logos/${c.org.id}/abc.png`;
    await setClinicLogo(c.actor, key);
    expect((await prisma.clinicOrg.findUniqueOrThrow({ where: { id: c.org.id } })).logoUrl).toBe(key);
    await expect(setClinicLogo(c.actor, `photos/clinic-logos/someone-else/x.png`)).rejects.toThrow(/again/);
    await setClinicLogo(c.actor, null);
    expect((await prisma.clinicOrg.findUniqueOrThrow({ where: { id: c.org.id } })).logoUrl).toBeNull();
    // Staff can't change it.
    await expect(setClinicLogo({ ...c.actor, role: "CLINIC_STAFF" } as never, key)).rejects.toThrow();
  });
});
