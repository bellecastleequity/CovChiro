import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { growth } from "@cm/services";

/** Apollo's trial plan has no API, so its CSV exports go through the ordinary clinic import (owner request Oct 2026). */
const admin = { userId: null, role: "PLATFORM_ADMIN" as const, providerId: null, clinicOrgId: null };

describe("Apollo export → clinic import", () => {
  it("imports U.S. clinics once each, with verified emails only", async () => {
    const csv = [
      "First Name,Last Name,Title,Company Name,Email,Email Status,Website,City,State,Country,Company Address,Company City,Company State,Company Country,Company Phone",
      'Ana,Rivera,Owner,Apollo Bay Chiro 7781,ana@apollobay7781.com,Verified,http://apollobay7781.com,Tampa,Florida,United States,"100 Bay St, Tampa, Florida 33602, United States",Tampa,Florida,United States,+1 813-555-0100',
      'Ben,Lee,Office Manager,Apollo Bay Chiro 7781,ben@apollobay7781.com,Unavailable,http://apollobay7781.com,Tampa,Florida,United States,"100 Bay St, Tampa, Florida 33602, United States",Tampa,Florida,United States,+1 813-555-0100',
      "Cara,Diaz,Owner,Apollo North 7781,cara@apollonorth7781.ca,Verified,,Toronto,Ontario,Canada,,Toronto,Ontario,Canada,",
      "Dan,Ng,Owner,Apollo Lake 7781,dan@apollolake7781.com,Guessed,,Orlando,Florida,United States,,Orlando,Florida,United States,",
    ].join("\n");
    const r = await growth.importProspects(admin, csv, "Apollo export test");
    expect(r).toMatchObject({ inserted: 2, apollo: { notUs: 1, unverifiedEmails: 2, merged: 1 } });
    const bay = await prisma.clinicProspect.findFirstOrThrow({ where: { clinicName: "Apollo Bay Chiro 7781" } });
    expect(bay).toMatchObject({ email: "ana@apollobay7781.com", ownerName: "Ana Rivera", state: "FL", zip: "33602", city: "Tampa" });
    const lake = await prisma.clinicProspect.findFirstOrThrow({ where: { clinicName: "Apollo Lake 7781" } });
    expect(lake.email).toBeNull();
    expect(await prisma.clinicProspect.count({ where: { clinicName: "Apollo North 7781" } })).toBe(0);
  });
});
