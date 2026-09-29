/**
 * INV-8 supervision attestation (Addendum 01 §5.3). The clinic names the
 * on-site supervising provider and confirms they'll be present for the whole
 * shift. The platform records the attestation; it does not supervise.
 */

export interface SupervisionAttestation {
  supervisorName: string;
  supervisorProfessionCode: string;
  supervisorLicenseNumber: string;
  onSiteEntireShift: boolean;
}

export function parseAttestation(raw: unknown): SupervisionAttestation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    supervisorName: String(r.supervisorName ?? "").trim(),
    supervisorProfessionCode: String(r.supervisorProfessionCode ?? "").trim().toUpperCase(),
    supervisorLicenseNumber: String(r.supervisorLicenseNumber ?? "").trim(),
    onSiteEntireShift: r.onSiteEntireShift === true,
  };
}

/** null when the attestation satisfies the profession-state's rules, else the reason. */
export function supervisionProblem(a: SupervisionAttestation | null, supervisingProfessionCodes: string[]): string | null {
  if (!a) return "Supervision attestation is required for this profession in this state";
  if (a.supervisorName.length < 2) return "Enter the supervising provider's name";
  if (a.supervisorLicenseNumber.length < 3) return "Enter the supervising provider's license number";
  if (!a.onSiteEntireShift) return "Confirm the supervising provider will be on site for the entire shift";
  if (!supervisingProfessionCodes.includes(a.supervisorProfessionCode)) {
    return `The supervising provider must be one of: ${supervisingProfessionCodes.join(", ") || "(none configured)"}`;
  }
  return null;
}
