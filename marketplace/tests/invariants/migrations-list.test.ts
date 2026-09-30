import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXPECTED_MIGRATIONS, missingMigrations, prisma } from "@cm/db";

describe("migration list", () => {
  it("matches prisma/migrations and the test database has them all", async () => {
    const dir = path.resolve(__dirname, "../../packages/db/prisma/migrations");
    const onDisk = readdirSync(dir).filter((d) => /^\d{4}_/.test(d)).sort();
    expect([...EXPECTED_MIGRATIONS]).toEqual(onDisk);
    expect(await missingMigrations(prisma)).toEqual([]);
  });
});
