import "server-only";
import type { VerificationInput } from "@cm/core";
import { bool, optStr, str } from "@/lib/action";
import { saveUpload } from "@/lib/upload";

/** Reads the clinic verification form (components/clinic/verification-form.tsx), storing new uploads in the clinic's folder. */
export async function verificationInputFrom(fd: FormData, clinicOrgId: string): Promise<VerificationInput> {
  const uploads: string[] = [];
  for (const f of fd.getAll("documents").slice(0, 6)) {
    const key = await saveUpload(f, `clinics/${clinicOrgId}/verification`);
    if (key) uploads.push(key);
  }
  return {
    entityName: str(fd, "entityName"),
    entityState: str(fd, "entityState"),
    entityNumber: str(fd, "entityNumber"),
    orgNpi: optStr(fd, "orgNpi"),
    owners: [0, 1, 2, 3, 4, 5].map((i) => ({
      name: str(fd, `owner${i}_name`),
      percent: Number(str(fd, `owner${i}_percent`).replace("%", "") || 0),
      licensed: str(fd, `owner${i}_licensed`) === "yes",
      professionCode: optStr(fd, `owner${i}_profession`),
      licenseState: optStr(fd, `owner${i}_state`),
      licenseNumber: optStr(fd, `owner${i}_license`),
      npi: optStr(fd, `owner${i}_npi`),
    })),
    facilityLicenseNumber: optStr(fd, "facilityLicenseNumber"),
    facilityExemptionNumber: optStr(fd, "facilityExemptionNumber"),
    documentKeys: [...fd.getAll("keepDocument").map(String).filter((k) => k.startsWith(`clinics/${clinicOrgId}/`)), ...uploads],
    documentsLater: bool(fd, "documentsLater"),
    attestName: str(fd, "attestName"),
  };
}
