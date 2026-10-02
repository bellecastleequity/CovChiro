import { prisma } from "@cm/db";

/**
 * What a clinic sees about its booked provider: the verified license for this shift's profession
 * and state, malpractice coverage, and their track record (completed shifts, rating, reliability,
 * on-time punch-ins). Facts only; never license numbers, home address or anything private.
 */
export async function providerTrust(providerId: string, professionCode: string, state: string) {
  const now = new Date();
  const [license, nationalCredential, malpractice, stats, sheets] = await Promise.all([
    prisma.license.findFirst({ where: { providerId, professionCode, state, status: "VERIFIED" }, orderBy: { expiresAt: "desc" } }),
    prisma.license.findFirst({ where: { providerId, professionCode, state: "US", status: "VERIFIED" }, orderBy: { expiresAt: "desc" } }),
    prisma.malpracticePolicy.findFirst({ where: { providerId, status: "VERIFIED", coveredProfessionCodes: { has: professionCode } }, orderBy: { expiresAt: "desc" } }),
    prisma.providerStats.findUnique({ where: { providerId } }),
    prisma.timesheet.findMany({ where: { assignment: { providerId }, status: { in: ["SUBMITTED", "APPROVED"] } }, select: { flags: true }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const lic = license ?? nationalCredential;
  const onTime = sheets.filter((t) => !t.flags.some((f) => /late|no punch-in|no punches/.test(f))).length;
  return {
    license: lic ? { state: lic.state, title: lic.credentialTitle, verifiedAt: lic.verifiedAt, expiresAt: lic.expiresAt, current: lic.expiresAt > now } : null,
    malpractice: malpractice ? { carrier: malpractice.carrier, verifiedAt: malpractice.verifiedAt, expiresAt: malpractice.expiresAt, current: malpractice.expiresAt > now } : null,
    completedShifts: stats?.completedShifts ?? 0,
    rating: stats && stats.ratingCount ? Math.round((stats.ratingSum / stats.ratingCount) * 10) / 10 : null,
    ratingCount: stats?.ratingCount ?? 0,
    lateCancels: stats?.lateCancels ?? 0,
    noShows: stats?.noShows ?? 0,
    timesheets: sheets.length,
    onTimePct: sheets.length ? Math.round((onTime / sheets.length) * 100) : null,
  };
}
