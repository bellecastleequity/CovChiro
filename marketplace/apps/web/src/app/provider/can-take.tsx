import { prisma } from "@cm/db";

/** "You can take: Chiropractic shifts in FL, GA · Massage shifts in FL" (Addendum 01 §4). */
export async function CanTake({ canTake }: { canTake: Record<string, string[]> }) {
  const profs = await prisma.profession.findMany();
  const parts = Object.entries(canTake).map(([code, states]) => `${profs.find((p) => p.code === code)?.displayName ?? code} shifts in ${states.join(", ")}`);
  return <>{parts.length ? parts.join(" · ") : "No verified licenses yet"}</>;
}
