import Link from "next/link";
import { clinicVerify } from "@cm/services";
import { Alert } from "@/components/ui/misc";
import { dateLabel } from "@/lib/format";

/** Clinic ownership verification status, on the dashboard and shift pages (nothing when verified and not due). */
export async function VerificationBanner({ clinicOrgId, className = "mb-6" }: { clinicOrgId: string; className?: string }) {
  const b = await clinicVerify.verificationBanner(clinicOrgId);
  if (!b) return null;
  const by = b.deadline ? dateLabel(b.deadline, "America/New_York", { month: "long", day: "numeric" }) : null;
  const link = <Link href="/clinic/settings/verification" className="font-medium underline">{b.status === "VERIFIED" ? "Renew now →" : b.status === "PENDING" ? "View →" : "Verify your clinic →"}</Link>;
  if (b.status === "REJECTED") return <Alert tone="error" className={className} title="Your clinic couldn't be verified">{b.note ?? "Your shifts aren't being shown to providers."} Please contact us. {link}</Alert>;
  if (b.status === "PENDING" && !b.cleared) return <Alert tone="info" className={className} title="Verification under review">Your shifts go out to providers as soon as we've confirmed your clinic, usually within one business day. {link}</Alert>;
  if (!b.cleared) return <Alert tone="warning" className={className} title="Verify your clinic so providers can see your shifts">{b.status === "NEEDS_INFO" && b.note ? `${b.note} ` : "You can post shifts now; they go out to providers once your clinic is verified. It takes a few minutes. "}{link}</Alert>;
  if (b.status === "VERIFIED") return <Alert tone="info" className={className} title={`Renew your clinic verification by ${by}`}>A quick yearly check keeps your shifts going out. {link}</Alert>;
  return <Alert tone="warning" className={className} title={`Please verify your clinic by ${by}`}>We now confirm who owns every clinic on the platform. Your shifts keep going out until then. {link}</Alert>;
}
