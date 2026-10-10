import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { validNpi } from "@cm/core";
import { setNppesProvider, type NppesRecord } from "@cm/integrations";
import { growth } from "@cm/services";
import { makeProvider, uid } from "../factories";

/**
 * Provider CSV import (owner request Oct 2026): rows matched to the NPI registry, people already on
 * the platform skipped, emails kept only under the contact-discovery rule.
 */
const admin = { userId: null, role: "PLATFORM_ADMIN" as const, providerId: null, clinicOrgId: null };
afterEach(() => setNppesProvider(null));

/** A random valid NPI. */
function npi() {
  for (;;) {
    const base = String(100_000_000 + Math.floor(Math.random() * 800_000_000));
    for (let d = 0; d < 10; d++) if (validNpi(`${base}${d}`)) return `${base}${d}`;
  }
}
const person = (n: string, first: string, last: string, tax = ["111N00000X"]): NppesRecord => ({
  npi: n, kind: "individual", name: "", firstName: first.toUpperCase(), lastName: last.toUpperCase(), credential: "DC", taxonomyCodes: tax,
  location: { line1: `${100 + Math.floor(Math.random() * 800)} Bay St`, line2: null, city: "TAMPA", state: "FL", zip: "33602", phone: null },
});

describe("provider CSV import", () => {
  it("matches the registry, keeps only acceptable emails and skips people already on the platform", async () => {
    const last = `Zq${uid().slice(0, 6)}`;
    const ana = person(npi(), "Ana", last);
    const solo = person(npi(), "Priya", `Nair${uid().slice(0, 4)}`);
    const pt = person(npi(), "Paul", "Tee", ["225100000X"]);
    const named = person(npi(), "Lena", `Byname${uid().slice(0, 5)}`);
    const recs = [ana, solo, pt, named];
    setNppesProvider({ name: "fake", search: async () => [], lookup: async (n) => recs.find((r) => r.npi === n) ?? null, findPeople: async (q) => recs.filter((r) => r.lastName === q.lastName.toUpperCase()) });
    const existing = await makeProvider();
    const onPlatformNpi = npi();
    await prisma.provider.update({ where: { id: existing.id }, data: { npi: onPlatformNpi } });

    const csv = [
      "NPI,First Name,Last Name,Email,State,Practice role,Providers",
      `${ana.npi},Ana,${last},dr.${last.toLowerCase()}@bayfamilychiro.example,FL,,`, // own name → kept
      `${solo.npi},Priya,${solo.lastName},frontdesk@nairchiro.example,FL,owner,1`, // solo owner's practice mailbox → kept
      `${pt.npi},Paul,Tee,paul@tee.example,FL,,`, // wrong profession → skipped
      `,Lena,${named.lastName},lena.${named.lastName!.toLowerCase()}@gmail.com,FL,,`, // found by name; free-mail email refused
      `${onPlatformNpi},Jo,Done,jo@done.example,FL,,`, // already on the platform
      `1234567890,Bad,Npi,bad@npi.example,FL,,`, // bad check digit
      `,NoState,Person,x@y.example,,,`, // can't be looked up
    ].join("\n");
    const r = await growth.importProviderProspects(admin, csv, "Test list");
    expect(r).toMatchObject({ inserted: 3, updated: 0, withEmail: 2, emailRejected: 1, skipped: 4 });
    expect(r.reasons).toMatchObject({ not_this_profession: 1, on_platform: 1, bad_npi: 1, no_npi_or_name: 1, email_personal_freemail: 1 });

    const a = await prisma.providerProspect.findUniqueOrThrow({ where: { npi: ana.npi } });
    expect(a).toMatchObject({ source: "Test list", email: `dr.${last.toLowerCase()}@bayfamilychiro.example`, emailOrigin: "import", contactStatus: "VERIFIED", stage: "CONTACT_VERIFIED", state: "FL", city: "Tampa" });
    expect((await prisma.providerProspect.findUniqueOrThrow({ where: { npi: solo.npi } })).practiceRole).toBe("OWNER");
    const l = await prisma.providerProspect.findUniqueOrThrow({ where: { npi: named.npi } });
    expect(l.email).toBeNull();
    expect(await prisma.providerProspect.findUnique({ where: { npi: onPlatformNpi } })).toBeNull();

    // Importing again updates instead of duplicating.
    const again = await growth.importProviderProspects(admin, `npi,email\n${ana.npi},dr.${last.toLowerCase()}@bayfamilychiro.example`, "Again");
    expect(again).toMatchObject({ inserted: 0, updated: 1 });
    expect((await prisma.providerProspect.findUniqueOrThrow({ where: { npi: ana.npi } })).source).toBe("Test list");
  });

  it("needs a header it can use", async () => {
    await expect(growth.importProviderProspects(admin, "name,phone\nA,1", "x")).rejects.toThrow(/npi/);
  });
});
