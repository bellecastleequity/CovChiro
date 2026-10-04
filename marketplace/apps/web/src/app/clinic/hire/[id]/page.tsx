import { notFound } from "next/navigation";
import { hiring } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { Alert, PageHeader } from "@/components/ui/misc";
import { money } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { acceptHireAction } from "../../actions";

export const metadata = { title: "Placement" };
export const dynamic = "force-dynamic";

export default async function ClinicHire({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor("clinic");
  const { id } = await params;
  const r = await hiring.hireRequest(actor, id).catch(() => null);
  if (!r) notFound();
  const paid = r.status === "PAID" || r.status === "RELEASED";
  return (
    <>
      <PageHeader back={{ href: "/clinic/providers", label: "My providers" }} eyebrow="Direct hire" title={`Placement: ${r.provider.displayName}`} description={hiring.POSITION_TYPES[r.positionType as keyof typeof hiring.POSITION_TYPES]} />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Placement terms" />
          <CardBody>
            {r.terms ? <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-700">{r.terms}</pre> : <p className="text-sm text-slate-500">Our team is preparing your terms. We&apos;ll email you when they&apos;re ready.</p>}
          </CardBody>
        </Card>
        <div className="lg:col-span-2">
          <Card>
            <CardBody className="space-y-4">
              {r.feeCents ? <div className="flex items-baseline justify-between"><span className="text-sm text-slate-600">Placement fee</span><span className="text-2xl font-semibold tabular-nums">{money(r.feeCents, { exact: true })}</span></div> : null}
              {paid ? (
                <Alert tone="success" title="Paid — you're all set">Accepted by {r.acceptedName}{r.acceptedTitle ? `, ${r.acceptedTitle}` : ""} on {r.acceptedAt?.toLocaleDateString("en-US", { dateStyle: "long" })}. You and {r.provider.displayName} can now work together directly.</Alert>
              ) : r.status === "QUOTED" ? (
                <ActionForm action={acceptHireAction} className="space-y-4">
                  <input type="hidden" name="hireId" value={r.id} />
                  <Field label="Your full name" htmlFor="name"><Input id="name" name="name" required minLength={3} autoComplete="name" /></Field>
                  <Field label="Your title" htmlFor="title"><Input id="title" name="title" required placeholder="Owner, Practice Manager…" /></Field>
                  <Checkbox name="agree" required label="I accept these placement terms on behalf of the Clinic and authorize the placement fee to be charged to our payment method on file. Typing my name is my electronic signature." />
                  <SubmitButton className="w-full" size="lg">Accept &amp; pay {r.feeCents ? money(r.feeCents, { exact: true }) : ""}</SubmitButton>
                </ActionForm>
              ) : (
                <p className="text-sm text-slate-600">{r.status === "DECLINED" || r.status === "CANCELLED" ? "This request was closed." : "We've received your request and will call you to set it up."}</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
