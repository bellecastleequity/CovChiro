import Link from "next/link";
import { Phone } from "lucide-react";
import { emergency } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, PageHeader, Stat, Table, Td, Th } from "@/components/ui/misc";
import { dateLabel, dateTimeLabel, money, timeRange } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { AutoRefresh } from "./auto-refresh";
import { adminAssignAction, adminInviteAction } from "../../actions";

export const metadata = { title: "Emergency" };
export const dynamic = "force-dynamic";

/** Live emergency screen: status, who's been texted, and everyone eligible nearby to call or assign. */
export default async function EmergencyScreen({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor("admin");
  const { id } = await params;
  const v = await emergency.emergencyView(actor, id);
  const sh = v.shift;
  const tz = sh.location.timeZone;
  const filled = sh.assignments.find((a) => ["CONFIRMED", "IN_PROGRESS", "COMPLETED"].includes(a.status));
  const nextStep = v.steps.find((p) => p > sh.emergencyBonusPercent);
  return (
    <>
      {v.open ? <AutoRefresh seconds={20} /> : null}
      <PageHeader back={{ href: "/admin/emergencies", label: "Emergencies" }}
        eyebrow={`Emergency · ${sh.location.clinicOrg.displayName}`}
        title={`${dateLabel(sh.startsAt, tz, { weekday: "long", month: "short", day: "numeric" })}, ${timeRange(sh.startsAt, sh.endsAt, tz)}`}
        description={`${sh.location.addressLine1}, ${sh.location.city} · ${sh.professionCode} · ${sh.emergencyReason ?? ""}`}
        actions={v.open ? <Badge tone="red">Looking now</Badge> : <StatusBadge status={sh.status} />}
      />
      {filled ? (
        <Alert tone="success" title={`Filled: ${filled.provider.displayName}`} className="mb-6">
          Confirmed {dateTimeLabel(filled.confirmedAt)}. The clinic has been emailed who to expect. <a className="font-medium underline" href={`tel:${filled.provider.user.phone ?? ""}`}>{filled.provider.user.phone}</a>
        </Alert>
      ) : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Rescue bonus" value={`+${sh.emergencyBonusPercent}%`} hint={nextStep && v.open ? `Next: +${nextStep}% if nobody accepts within ${v.stepMinutes} min` : "Top step"} tone="red" />
        <Stat label="Provider pay" value={money(sh.providerPayCents)} hint="Bonus comes out of your margin" />
        <Stat label="Texted" value={v.status?.offersSent ?? 0} />
        <Stat label="Accepted / declined" value={`${v.status?.accepted ?? 0} / ${v.status?.declined ?? 0}`} tone="green" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title={v.open ? `Eligible nearby (${v.candidates.length})` : "Eligible providers"} description="Sorted by drive time. Call, send them the offer, or assign someone who said yes on the phone (licensing checks still apply)." />
          {v.open ? (
            <Table>
              <thead><tr><Th>Provider</Th><Th>Drive</Th><Th>Offer</Th><Th /></tr></thead>
              <tbody>
                {v.candidates.map((c) => (
                  <tr key={c.providerId}>
                    <Td><Link href={`/admin/providers/${c.providerId}`} className="font-medium hover:text-brand-700">{c.name}</Link></Td>
                    <Td>{c.driveMinutes !== null ? `${c.driveMinutes} min` : "—"}</Td>
                    <Td>{c.lastOffer ? <StatusBadge status={c.lastOffer} /> : <span className="text-xs text-slate-400">not yet</span>}</Td>
                    <Td>
                      <div className="flex flex-wrap justify-end gap-2">
                        {c.phone ? <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-medium text-brand-700"><Phone className="size-3.5" />Call</a> : null}
                        <ActionForm action={adminInviteAction} successMessage={false}><input type="hidden" name="shiftId" value={id} /><input type="hidden" name="providerId" value={c.providerId} /><SubmitButton size="sm" variant="outline">Send offer</SubmitButton></ActionForm>
                        <ActionForm action={adminAssignAction} confirm={`Assign ${c.name} now?`}><input type="hidden" name="shiftId" value={id} /><input type="hidden" name="providerId" value={c.providerId} /><SubmitButton size="sm">Assign now</SubmitButton></ActionForm>
                      </div>
                    </Td>
                  </tr>
                ))}
                {!v.candidates.length ? <tr><Td colSpan={4} className="text-sm text-slate-500">Nobody eligible is free and in range right now.</Td></tr> : null}
              </tbody>
            </Table>
          ) : (
            <CardBody className="text-sm text-slate-500">This emergency is closed.</CardBody>
          )}
        </Card>
        <Card>
          <CardHeader title="Offer activity" />
          <CardBody className="space-y-2 text-sm">
            {v.offers.slice(0, 40).map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{o.provider.displayName}</span>
                <span className="flex items-center gap-2 text-xs text-slate-500">{dateTimeLabel(o.createdAt)} <StatusBadge status={o.status} /></span>
              </div>
            ))}
            {!v.offers.length ? <p className="text-slate-500">No offers sent yet.</p> : null}
            <Link href={`/admin/shifts/${id}`} className="block pt-2 font-medium text-brand-700">Full shift details →</Link>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
