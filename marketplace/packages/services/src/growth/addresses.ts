import { type AddressHistory } from "@cm/core";
import { prisma } from "@cm/db";
import { normEmail } from "./engine";

/**
 * One inbox, one sequence (owner, Oct 2026: a group's records@ address sat on three locations and got the
 * same email three times). For each address: the sequence steps it already received from ANY prospect
 * (sequence dedupe keys <prefix><prospectId>:<step>), whether an email to it is waiting, and whether any
 * prospect with it has replied, signed up or opted out. core addressDecision turns that into send / catch
 * up / skip. Read by the outreach sweeps, "Send the first email now" and Ready to go out.
 */
export async function addressHistories(kind: "PROSPECT" | "PROVIDER_PROSPECT", emails: (string | null | undefined)[]): Promise<Map<string, AddressHistory>> {
  const list = [...new Set(emails.map(normEmail).filter(Boolean))];
  const out = new Map<string, AddressHistory>(list.map((e) => [e, { sent: 0, lastSentAt: null, pending: false, stopped: false }]));
  if (!list.length) return out;
  const prefix = kind === "PROSPECT" ? "outreach:" : "ppoutreach:";
  const comms = await prisma.communication.findMany({
    where: { entityType: kind, channel: "EMAIL", direction: "OUT", toAddress: { in: list }, dedupeKey: { startsWith: prefix }, status: { in: ["SENT", "PENDING_APPROVAL", "QUEUED"] } },
    select: { toAddress: true, status: true, createdAt: true, dedupeKey: true },
  });
  for (const c of comms) {
    const h = out.get(normEmail(c.toAddress));
    if (!h) continue;
    if (c.status !== "SENT") { h.pending = true; continue; }
    const step = Number(c.dedupeKey!.split(":").pop());
    if (Number.isFinite(step)) h.sent = Math.max(h.sent, step + 1);
    const at = c.createdAt;
    if (!h.lastSentAt || +at > +h.lastSentAt) h.lastSentAt = at;
  }
  const stoppedEmails =
    kind === "PROSPECT"
      ? await prisma.clinicProspect.findMany({
          where: { email: { in: list }, OR: [{ doNotContact: true }, { clinicOrgId: { not: null } }, { emailStatus: { in: ["BOUNCED", "COMPLAINED", "UNSUBSCRIBED"] } }, { stage: { notIn: ["PROSPECT", "CONTACTABLE", "OUTREACH_STARTED", "DORMANT"] } }] },
          select: { email: true },
        })
      : await prisma.providerProspect.findMany({
          where: { email: { in: list }, OR: [{ doNotContact: true }, { providerId: { not: null } }, { emailStatus: { in: ["BOUNCED", "COMPLAINED", "UNSUBSCRIBED", "INVALID"] } }, { stage: { in: ["ENGAGED", "REGISTERED", "NOT_INTERESTED", "DO_NOT_CONTACT"] } }] },
          select: { email: true },
        });
  for (const p of stoppedEmails) {
    const h = out.get(normEmail(p.email));
    if (h) h.stopped = true;
  }
  return out;
}

/** Catch a prospect up to what its shared address already received (no email sent). */
export async function syncToAddress(kind: "PROSPECT" | "PROVIDER_PROSPECT", id: string, step: number, lastContactedAt: Date | null) {
  if (kind === "PROSPECT") {
    await prisma.clinicProspect.updateMany({ where: { id, outreachStep: { lt: step } }, data: { outreachStep: step, lastContactedAt } });
    await prisma.clinicProspect.updateMany({ where: { id, stage: { in: ["PROSPECT", "CONTACTABLE"] } }, data: { stage: "OUTREACH_STARTED" } });
  } else {
    await prisma.providerProspect.updateMany({ where: { id, outreachStep: { lt: step } }, data: { outreachStep: step, lastContactedAt } });
    await prisma.providerProspect.updateMany({ where: { id, stage: { in: ["DISCOVERED", "CONTACT_FOUND", "CONTACT_VERIFIED"] } }, data: { stage: "CONTACTED" } });
  }
}
