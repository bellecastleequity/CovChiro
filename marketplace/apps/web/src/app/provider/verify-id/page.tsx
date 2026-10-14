import Link from "next/link";
import { CheckCircle2, Clock, ShieldCheck } from "lucide-react";
import { idcheck } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, PageHeader } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";
import { idCheckAction } from "../actions";

export const metadata = { title: "Verify your ID" };

const fmt = (d: Date, tz: string) => d.toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function VerifyId({ searchParams }: { searchParams: Promise<{ done?: string; session?: string }> }) {
  const { actor } = await requireActor("provider");
  const q = await searchParams;
  // Back from Stripe: read the result now rather than waiting for the webhook.
  if (q.done) await idcheck.refreshIdCheck(actor.providerId!, q.session).catch(() => null);
  const st = await idcheck.idCheckState(actor);

  return (
    <>
      <PageHeader title="Verify your ID" description="A one-time check that you are who your license says you are. It keeps clinics, patients and your license safe." back={{ href: "/provider", label: "Home" }} />
      <div className="max-w-xl space-y-6">
        {!st.enabled && st.status !== "VERIFIED" ? (
          <Alert tone="info" title="Nothing to do yet">ID checks aren&apos;t switched on. We&apos;ll let you know if that changes.</Alert>
        ) : null}

        {st.status === "VERIFIED" ? (
          <Alert tone="success" title="Your ID is verified">
            <span className="flex items-center gap-2"><CheckCircle2 className="size-4" />Done{st.verifiedAt ? ` on ${st.verifiedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}. You won&apos;t need to do this again.</span>
          </Alert>
        ) : st.status === "PROCESSING" ? (
          <Alert tone="info" title="Checking your ID">Stripe is checking your photos. This usually takes a few minutes; we&apos;ll let you know. <Link href="/provider/verify-id" className="font-medium underline">Refresh</Link></Alert>
        ) : st.status === "NEEDS_REVIEW" ? (
          <Alert tone="info" title="We're reviewing your ID check">Our team is taking a look and will be in touch shortly. Nothing else to do for now.</Alert>
        ) : st.status === "FAILED" ? (
          <Alert tone="warning" title="That try didn't go through">{st.note} {st.attemptsLeft > 0 ? `You have ${st.attemptsLeft} ${st.attemptsLeft === 1 ? "try" : "tries"} left.` : ""}</Alert>
        ) : null}

        {st.due.length && st.status !== "VERIFIED" ? (
          <Alert tone="warning" title="Needed to keep your bookings">
            <ul className="mt-1 list-disc pl-5">
              {st.due.map((a) => (
                <li key={a.id}>{a.shift.location.city}, {a.shift.location.state}: verify by <b>{fmt(a.idDueAt!, a.shift.location.timeZone)}</b> or the shift goes to another provider.</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {st.enabled && st.status !== "VERIFIED" && st.status !== "PROCESSING" && st.status !== "NEEDS_REVIEW" ? (
          <Card>
            <CardHeader title="About 2 minutes, on your phone" />
            <CardBody>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
                <li>Take a photo of the front and back of your driver&apos;s license (or a state ID or passport).</li>
                <li>Take a quick selfie so it can be matched to the photo on your ID.</li>
                <li>That&apos;s it. Most checks finish in under a minute.</li>
              </ol>
              <div className="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600 ring-1 ring-slate-200">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent-600" />
                <span>Your ID goes to <b>Stripe</b>, the payments company we already use, not to us. We only keep the result: verified, and that the name matches your license.</span>
              </div>
              <p className="mt-3 flex items-center gap-2 text-xs text-slate-500"><Clock className="size-3.5" />Needed before shifts starting within {st.acceptWithinHours} hours, and by {st.deadlineHours} hours before any shift you book.</p>
              {st.canStart ? (
                <ActionForm action={idCheckAction} className="mt-4">
                  <SubmitButton>{st.status === "PENDING" ? "Continue my ID check" : st.status === "FAILED" ? "Try again" : "Verify my ID"}</SubmitButton>
                </ActionForm>
              ) : (
                <p className="mt-4 text-sm text-slate-600">You&apos;ve used every try. Our team will be in touch, or <Link href="/provider/help" className="font-medium underline">contact support</Link>.</p>
              )}
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
