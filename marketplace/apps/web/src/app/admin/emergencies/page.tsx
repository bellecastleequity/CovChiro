import Link from "next/link";
import { emergency } from "@cm/services";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Empty, PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { timeRange, dateLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Emergencies" };
export const dynamic = "force-dynamic";

export default async function Emergencies() {
  const { actor } = await requireActor("admin");
  const rows = await emergency.emergencies(actor);
  return (
    <>
      <PageHeader title="Emergencies" description="No-shows and late cancellations getting emergency cover: open ones first, plus anything filled in the last 24 hours." />
      {rows.length ? (
        <Card>
          <Table>
            <thead><tr><Th>Clinic</Th><Th>When</Th><Th>Why</Th><Th>Bonus</Th><Th>Status</Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td><Link href={`/admin/emergencies/${r.id}`} className="font-medium text-brand-700">{r.location.clinicOrg.displayName}</Link><div className="text-xs text-slate-500">{r.location.city}, {r.state} · {r.professionCode}</div></Td>
                  <Td>{dateLabel(r.startsAt, r.location.timeZone)}<div className="text-xs text-slate-500">{timeRange(r.startsAt, r.endsAt, r.location.timeZone)}</div></Td>
                  <Td className="max-w-xs text-sm">{r.emergencyReason}</Td>
                  <Td>+{r.emergencyBonusPercent}%</Td>
                  <Td>{r.open ? <Badge tone="red">Looking now</Badge> : r.assignments[0] ? <span className="text-sm">Filled: {r.assignments[0].provider.displayName}</span> : <StatusBadge status={r.status} />}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : (
        <Empty title="No emergencies">When a provider cancels late or doesn't show, the replacement search shows up here.</Empty>
      )}
    </>
  );
}
