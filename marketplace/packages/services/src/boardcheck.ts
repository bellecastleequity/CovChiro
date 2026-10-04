import { inflateRawSync } from "node:zlib";
import { classifyBoardStatus, DomainError, parseBoardFile, US_STATES } from "@cm/core";
import { prisma } from "@cm/db";
import { audit, clock, requireAdmin, type Actor } from "./context";
import { notify, notifyAdmins } from "./notify";
import { recomputeProviderStatus } from "./onboarding";

/**
 * State license check (Admin → Verification → State license check). The admin downloads the
 * state's license file (Florida: Health Care Practitioner Data Portal → Licensure Data Download
 * → Chiropractic Physician, All Statuses) and uploads it here. Every license we hold for that
 * profession × state is looked up in it (core parseBoardFile / classifyBoardStatus):
 *  - active → License.boardCheckedAt/boardStatus updated (clinics see "checked with the state on …").
 *  - inactive (delinquent, null and void, suspended, revoked, retired …) → the license stops
 *    counting at once (SUSPENDED, or REVOKED), the provider and admins are told, and their
 *    booked shifts are re-checked so the usual lapse handling (refund + emergency cover) runs.
 *  - probation / obligations / anything unrecognised, a discipline flag, or not in the file →
 *    an admin task to look at; nothing changes automatically.
 */

/** The first text file inside a .zip (stored or deflated), or the bytes themselves when not a zip. */
export function fileText(buf: Buffer): string {
  if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50) {
    let off = 0;
    while (off + 30 <= buf.length && buf.readUInt32LE(off) === 0x04034b50) {
      const method = buf.readUInt16LE(off + 8);
      let size = buf.readUInt32LE(off + 18);
      const nameLen = buf.readUInt16LE(off + 26);
      const extraLen = buf.readUInt16LE(off + 28);
      const name = buf.subarray(off + 30, off + 30 + nameLen).toString("utf8");
      const start = off + 30 + nameLen + extraLen;
      const flags = buf.readUInt16LE(off + 6);
      if (flags & 0x08 && size === 0) {
        // Size is in the central directory; find it there.
        const cd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
        for (let p = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); p >= 0 && p <= cd; p = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), p + 4)) {
          const n = buf.subarray(p + 46, p + 46 + buf.readUInt16LE(p + 28)).toString("utf8");
          if (n === name) { size = buf.readUInt32LE(p + 20); break; }
        }
      }
      const data = buf.subarray(start, start + size);
      if (!name.endsWith("/") && /\.(txt|csv|dat)$/i.test(name)) {
        return (method === 8 ? inflateRawSync(data) : data).toString("latin1");
      }
      off = start + size + (flags & 0x08 ? 16 : 0);
    }
    throw new DomainError("VALIDATION", "That zip file has no text file inside. Upload the license data file from the state.");
  }
  return buf.toString("latin1");
}

async function task(title: string, entityId: string) {
  const open = await prisma.adminTask.findFirst({ where: { kind: "BOARD_CHECK", entityId, resolvedAt: null, title } });
  if (!open) await prisma.adminTask.create({ data: { kind: "BOARD_CHECK", title, entityType: "License", entityId } });
}

export async function runBoardCheck(actor: Actor, input: { state: string; professionCode: string; file: Buffer; fileName: string }) {
  requireAdmin(actor);
  const state = input.state.toUpperCase();
  const text = fileText(input.file);
  const licenses = await prisma.license.findMany({
    where: { state, professionCode: input.professionCode, status: { in: ["VERIFIED", "PENDING_VERIFICATION", "SUSPENDED"] } },
    include: { provider: { select: { id: true, userId: true, displayName: true, legalName: true } } },
  });
  if (!licenses.length) throw new DomainError("VALIDATION", `No ${input.professionCode} licenses in ${state} to check yet.`);
  const found = parseBoardFile(text, licenses.map((l) => l.licenseNumber));
  if (!found.size) throw new DomainError("VALIDATION", "None of our license numbers are in that file. Check it's the right state and profession (All Statuses).");
  const now = clock.now();
  const stateName = US_STATES[state as keyof typeof US_STATES] ?? state;
  const results: { provider: string; providerId: string; licenseNumber: string; status: string | null; outcome: "ok" | "stopped" | "review" | "not_found" | "reinstated" }[] = [];
  const { recheckProviderAssignments } = await import("./lifecycle");
  for (const l of licenses) {
    const row = found.get(l.licenseNumber);
    const who = l.provider.legalName || l.provider.displayName;
    if (!row) {
      await task(`${who}: ${stateName} license ${l.licenseNumber} isn't in the state's file`, l.id);
      results.push({ provider: who, providerId: l.providerId, licenseNumber: l.licenseNumber, status: null, outcome: "not_found" });
      continue;
    }
    const verdict = classifyBoardStatus(row.status);
    await prisma.license.update({ where: { id: l.id }, data: { boardCheckedAt: now, boardStatus: row.status.slice(0, 80) } });
    if (verdict === "INACTIVE") {
      if (l.status === "VERIFIED" || l.status === "PENDING_VERIFICATION") {
        await prisma.license.update({ where: { id: l.id }, data: { status: /REVOK/i.test(row.status) ? "REVOKED" : "SUSPENDED", rejectionReason: `State shows "${row.status}" (checked ${now.toISOString().slice(0, 10)})` } });
        await audit(prisma, actor, "license.board_inactive", "License", l.id, { status: l.status }, { boardStatus: row.status });
        await recomputeProviderStatus(l.providerId);
        await notify(prisma, l.provider.userId, {
          template: "license_board_inactive",
          title: `Your ${stateName} license shows as "${row.status}"`,
          body: `The state's license records show your license as "${row.status}", so we've paused new shifts there. If this is wrong or you've renewed, upload the current license on your Credentials page and we'll re-check it.`,
          link: "/provider/credentials",
          ctaLabel: "Update credentials",
          sms: true,
        }).catch(() => undefined);
        await notifyAdmins(prisma, { template: "license_board_inactive", title: `${who}'s ${stateName} license shows "${row.status}"`, body: "Their license was set to not count and their booked shifts are being re-checked.", link: `/admin/providers/${l.providerId}` }).catch(() => undefined);
        await recheckProviderAssignments(l.providerId, `State license check: ${row.status}`).catch(() => undefined);
      }
      results.push({ provider: who, providerId: l.providerId, licenseNumber: l.licenseNumber, status: row.status, outcome: "stopped" });
      continue;
    }
    if (verdict === "REVIEW" || row.discipline) {
      await task(`${who}: ${stateName} license ${l.licenseNumber} shows "${row.status}"${row.discipline ? " with a discipline record" : ""}. Review it`, l.id);
      results.push({ provider: who, providerId: l.providerId, licenseNumber: l.licenseNumber, status: row.status, outcome: "review" });
      continue;
    }
    // Active. A license we stopped after an earlier check isn't switched back on automatically.
    results.push({ provider: who, providerId: l.providerId, licenseNumber: l.licenseNumber, status: row.status, outcome: l.status === "SUSPENDED" ? "reinstated" : "ok" });
    if (l.status === "SUSPENDED") await task(`${who}: ${stateName} license ${l.licenseNumber} shows active again. Re-verify to reinstate it`, l.id);
  }
  const summary = {
    at: now.toISOString(),
    fileName: input.fileName.slice(0, 120),
    state,
    professionCode: input.professionCode,
    checked: licenses.length,
    ok: results.filter((r) => r.outcome === "ok").length,
    stopped: results.filter((r) => r.outcome === "stopped").length,
    review: results.filter((r) => r.outcome === "review" || r.outcome === "reinstated").length,
    notFound: results.filter((r) => r.outcome === "not_found").length,
    problems: results.filter((r) => r.outcome !== "ok"),
  };
  const key = `boardcheck.last.${input.professionCode}.${state}`;
  await prisma.setting.upsert({ where: { key }, create: { key, value: summary }, update: { value: summary } });
  await audit(prisma, actor, "license.board_check", "License", `${input.professionCode}:${state}`, null, { state, professionCode: input.professionCode, checked: summary.checked, stopped: summary.stopped, review: summary.review, notFound: summary.notFound });
  return summary;
}

export async function lastBoardCheck(actor: Actor, professionCode: string, state: string) {
  requireAdmin(actor);
  return (await prisma.setting.findUnique({ where: { key: `boardcheck.last.${professionCode}.${state.toUpperCase()}` } }))?.value as Awaited<ReturnType<typeof runBoardCheck>> | undefined;
}
