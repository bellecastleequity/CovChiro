import { notFound } from "next/navigation";
import { Ban, Heart } from "lucide-react";
import { DomainError } from "@cm/core";
import Link from "next/link";
import { prisma } from "@cm/db";
import { clinicRelationshipWith, hiring, providerPublicProfile } from "@cm/services";
import { ProviderProfileView } from "@/components/provider-profile";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { requireActor } from "@/lib/session";
import { blockAction, favoriteAction, requestHireAction, unblockAction } from "../../actions";

export default async function ClinicProviderProfile({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor("clinic");
  const id = (await params).id;
  const p = await providerPublicProfile(actor, id).catch((e) => {
    if (e instanceof DomainError) notFound();
    throw e;
  });
  const rel = await clinicRelationshipWith(actor, id);
  const hire = await prisma.hireRequest.findFirst({ where: { clinicOrgId: actor.clinicOrgId!, providerId: id }, orderBy: { createdAt: "desc" } });
  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-end gap-2">
        {rel.workedTogether && !rel.blocked ? (
          <ActionForm action={favoriteAction}>
            <input type="hidden" name="providerId" value={id} />
            <input type="hidden" name="on" value={rel.favorite ? "0" : "1"} />
            <SubmitButton size="sm" variant="outline"><Heart className={`size-4 ${rel.favorite ? "fill-red-500 text-red-500" : ""}`} />{rel.favorite ? "Favorited" : "Add to favorites"}</SubmitButton>
          </ActionForm>
        ) : null}
        {rel.blocked ? (
          <ActionForm action={unblockAction} confirm="Unblock this provider? They can be offered your shifts again.">
            <input type="hidden" name="providerId" value={id} />
            <SubmitButton size="sm" variant="outline"><Ban className="size-4" />Blocked — unblock</SubmitButton>
          </ActionForm>
        ) : (
          <ActionForm action={blockAction} confirm="Block this provider from your future bookings? Only you will know." className="flex flex-wrap justify-end gap-2">
            <input type="hidden" name="providerId" value={id} />
            <Input name="reason" placeholder="Private note (optional)" className="h-9 w-full sm:w-52" />
            <SubmitButton size="sm" variant="outline"><Ban className="size-4" />Block from future bookings</SubmitButton>
          </ActionForm>
        )}
      </div>
      <ProviderProfileView p={p} />
      {hire && hire.status !== "DECLINED" && hire.status !== "CANCELLED" ? (
        <Card className="mt-6">
          <CardBody className="text-sm">
            {hire.status === "RELEASED" ? "You hired this provider directly through a placement." : hire.status === "QUOTED" ? <>Your placement terms are ready. <Link href={`/clinic/hire/${hire.id}`} className="font-medium text-brand-700 underline">Review &amp; pay →</Link></> : "We've received your request to hire this provider and will call you shortly."}
          </CardBody>
        </Card>
      ) : !rel.blocked ? (
        <Card className="mt-6" id="hire">
          <CardHeader title="Want to hire them directly?" description="Request to hire and our team will call you to arrange it with the provider. A one-time placement fee applies; after that you work together directly. This is the only way to hire a provider you met here — arranging it any other way breaches your Clinic Platform Agreement." />
          <CardBody>
            <ActionForm action={requestHireAction} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="providerId" value={id} />
              <Field label="Position" htmlFor="positionType">
                <Select id="positionType" name="positionType" defaultValue="FULL_TIME">
                  {Object.entries(hiring.POSITION_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="Best number to call you" htmlFor="callbackPhone"><Input id="callbackPhone" name="callbackPhone" type="tel" placeholder="Your clinic phone" /></Field>
              <Field label="Best times to call (optional)" htmlFor="callbackTimes" className="sm:col-span-2"><Input id="callbackTimes" name="callbackTimes" placeholder="Weekdays after 2pm" /></Field>
              <Field label="Anything we should know (optional)" htmlFor="message" className="sm:col-span-2"><Textarea id="message" name="message" maxLength={2000} placeholder="Schedule, start date, what you're offering…" /></Field>
              <div className="sm:col-span-2"><SubmitButton variant="secondary">Request to hire</SubmitButton></div>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
