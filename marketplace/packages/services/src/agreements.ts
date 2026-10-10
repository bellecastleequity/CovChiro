import { createHash } from "node:crypto";
import { brand } from "@cm/config";
import { prisma } from "@cm/db";
import { agreementText, renderAgreement, type AgreementDoc, type AgreementKind } from "./agreement-text";
import { getSettings } from "./context";

export { agreementText, renderAgreement, type AgreementDoc, type AgreementKind } from "./agreement-text";

/** Bump when the agreement wording changes (agreement-text.ts). v1 was the placeholder used in the build & test phase. */
export const AGREEMENT_VERSION = { CLINIC: 6, PROVIDER: 3 } as const;

/**
 * Has this clinic/provider signed the CURRENT agreement? Required — no
 * exceptions, admin approval included — before a clinic posts shifts and
 * before a provider is matched, offered, invited or can apply. Bumping
 * AGREEMENT_VERSION immediately requires everyone to sign the new version.
 */
export function agreementCurrent(kind: AgreementKind, signedAt: Date | null, version: number | null) {
  return !!signedAt && !!version && version >= AGREEMENT_VERSION[kind];
}

export async function agreementAccepted(kind: AgreementKind, signedAt: Date | null, version: number | null) {
  return agreementCurrent(kind, signedAt, version);
}

export const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export const longDate = (d: Date, timeZone = "America/New_York") => d.toLocaleDateString("en-US", { timeZone, year: "numeric", month: "long", day: "numeric" });

/** The agreement as it reads for this signer today, prefilled with their details and current Settings. */
export async function buildAgreementFor(kind: AgreementKind, partyId: string, signer: { name: string; email: string; title?: string | null }, on: Date): Promise<{ doc: AgreementDoc; text: string; hash: string }> {
  const s = await getSettings();
  let legalName = signer.name;
  let address: string | null = null;
  if (kind === "CLINIC") {
    const org = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: partyId }, include: { locations: { where: { active: true }, orderBy: { createdAt: "asc" }, take: 1 } } });
    legalName = org.legalName;
    const l = org.locations[0];
    address = l ? `${l.addressLine1}${l.addressLine2 ? `, ${l.addressLine2}` : ""}, ${l.city}, ${l.state} ${l.zip}` : null;
  } else {
    const p = await prisma.provider.findUniqueOrThrow({ where: { id: partyId } });
    legalName = p.legalName || signer.name;
    address = p.homeCity && p.homeState ? `${p.homeCity}, ${p.homeState}` : null;
  }
  const doc = renderAgreement(kind, AGREEMENT_VERSION[kind], brand().name, { legalName, address, signerName: signer.name, signerEmail: signer.email, signerTitle: signer.title ?? null }, s, longDate(on));
  const text = agreementText(doc);
  return { doc, text, hash: sha256(text) };
}
