import { Inbox } from "lucide-react";
import { prisma } from "@cm/db";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card } from "@/components/ui/card";
import { Empty, PageHeader } from "@/components/ui/misc";
import { dateLabel, money, relative, timeRange } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { respondOfferAction } from "../actions";

export const metadata = { title: "Offers" };

export default async function Offers() {
  const { actor } = await requireActor("provider");
  const offers = await prisma.offer.findMany({
    where: { providerId: actor.providerId!, status: "PENDING", expiresAt: { gt: new Date() } },
    include: { shift: { include: { location: { include: { clinicOrg: true } } } } },
    orderBy: { expiresAt: "asc" },
  });
  return (
    <>
      <PageHeader title="Invitations" description="Clinics (or our team) invited you to these shifts. First to accept gets the shift." />
      {offers.length ? (
        <div className="space-y-3">
          {offers.map((o) => {
            const tz = o.shift.location.timeZone;
            return (
              <Card key={o.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="font-semibold">{o.shift.location.clinicOrg.displayName}</div>
                    <div className="text-sm text-slate-500">
                      {dateLabel(o.shift.startsAt, tz)} · {timeRange(o.shift.startsAt, o.shift.endsAt, tz)} · {o.shift.location.city}, {o.shift.state}
                    </div>
                    <div className="mt-1 text-sm font-medium text-amber-700">Expires {relative(o.expiresAt)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold text-brand-700">{money(o.shift.providerPayCents)}</div>
                    <div className="text-xs text-slate-500">+ mileage</div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <ActionForm action={respondOfferAction} successMessage={false}>
                    <input type="hidden" name="offerId" value={o.id} />
                    <input type="hidden" name="decision" value="accept" />
                    <SubmitButton>Accept shift</SubmitButton>
                  </ActionForm>
                  <ActionForm action={respondOfferAction} confirm="Decline this invitation?">
                    <input type="hidden" name="offerId" value={o.id} />
                    <input type="hidden" name="decision" value="decline" />
                    <SubmitButton variant="outline">Decline</SubmitButton>
                  </ActionForm>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Empty title="No invitations right now" icon={<Inbox className="size-6" />}>Invitations from clinics will appear here and by text message.</Empty>
      )}
    </>
  );
}
