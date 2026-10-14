import Link from "next/link";
import { idcheck, type Actor } from "@cm/services";
import { Alert } from "@/components/ui/misc";

/** Photo ID check (idcheck.ts): urgent when a booking has a deadline, a gentle nudge otherwise; nothing once verified or when off. */
export async function IdCheckBanner({ actor, className = "mb-6" }: { actor: Actor; className?: string }) {
  const st = await idcheck.idCheckState(actor);
  if (!st.enabled || st.status === "VERIFIED" || st.status === "NEEDS_REVIEW" || st.status === "PROCESSING") return null;
  const first = st.due[0];
  if (first) {
    const by = first.idDueAt!.toLocaleString("en-US", { timeZone: first.shift.location.timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    return (
      <Alert tone="warning" className={className} title={`Verify your ID by ${by} to keep your booking`}>
        It takes about 2 minutes on your phone. Otherwise the shift goes to another provider. <Link href="/provider/verify-id" className="font-medium underline">Verify my ID →</Link>
      </Alert>
    );
  }
  return (
    <Alert tone="info" className={className} title="Verify your ID once, take shifts at short notice">
      A 2-minute check with Stripe (your ID goes to them, not us). Needed before same-day and next-day shifts. <Link href="/provider/verify-id" className="font-medium underline">Verify my ID →</Link>
    </Alert>
  );
}
