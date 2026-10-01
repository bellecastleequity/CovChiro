import { readFileSync } from "node:fs";
import path from "node:path";

/** The installed release (deploy/cpanel/build.sh writes app/RELEASE.json). */
export function installedRelease(): { version: string; builtAt: string | null; latestMigration: string | null } {
  for (const p of [path.join(process.cwd(), "RELEASE.json"), path.join(process.cwd(), "..", "..", "RELEASE.json")]) {
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch {
      /* try next */
    }
  }
  return { version: "development", builtAt: null, latestMigration: null };
}
