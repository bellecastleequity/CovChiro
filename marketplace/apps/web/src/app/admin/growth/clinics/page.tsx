import Link from "next/link";
import { prisma } from "@cm/db";
import { growth } from "@cm/services";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader, Stat, Table, Td, Th } from "@/components/ui/misc";
import { dateLabel, humanize } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { FunnelBars, GrowthTabs, pctLabel, usd } from "../ui";

export const metadata = { title: "Clinic growth" };
export const dynamic = "force-dynamic";

const FUNNEL = ["PROSPECT", "CONTACTABLE", "OUTREACH_STARTED", "ENGAGED", "ACCOUNT_STARTED", "ACCOUNT_CREATED", "COVERAGE_REQUESTED", "FIRST_SHIFT_BOOKED", "FIRST_SHIFT_COMPLETED", "REPEAT_CLINIC"];
const LABEL: Record<string, string> = { OUTREACH_STARTED: "Contacted", FIRST_SHIFT_BOOKED: "First shift", FIRST_SHIFT_COMPLETED: "First shift completed", REPEAT_CLINIC: "Repeat clinic" };

export default async function Clinics() {
  const { actor } = await requireActor("admin");
  const [byStage, kpis, recent] = await Promise.all([
    prisma.clinicProspect.groupBy({ by: ["stage"], _count: { _all: true } }),
    growth.overview(actor).then((o) => o.kpis),
    prisma.clinicProspect.findMany({ where: { stage: { in: ["ACCOUNT_CREATED", "COVERAGE_REQUESTED", "FIRST_SHIFT_BOOKED", "FIRST_SHIFT_COMPLETED", "REPEAT_CLINIC", "ENGAGED", "INTERESTED"] } }, orderBy: { updatedAt: "desc" }, take: 25 }),
  ]);
  const n = new Map(byStage.map((b) => [b.stage as string, b._count._all]));
  const atOrAfter = (i: number) => FUNNEL.slice(i).reduce((a, s) => a + (n.get(s) ?? 0), 0) + (i <= 3 ? (n.get("INTERESTED") ?? 0) : 0);
  const steps = FUNNEL.map((s, i) => ({ label: LABEL[s] ?? humanize(s), count: atOrAfter(i) }));
  return (
    <>
      <PageHeader title="Clinics" description="Clinic acquisition from prospect to repeat clinic. Prospect research and outreach live under Prospecting; high-intent leads under Leads / Conversations." />
      <GrowthTabs current="/admin/growth/clinics" />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card><CardHeader title="Clinic acquisition funnel" description="Each step includes everyone who got further." /><CardBody><FunnelBars steps={steps} /></CardBody></Card>
        <Card>
          <CardHeader title="Demand" />
          <CardBody className="grid grid-cols-2 gap-3">
            <Stat label="Registered clinics" value={kpis.demand.registeredClinics} />
            <Stat label="Requesting" value={kpis.demand.requestingClinics} />
            <Stat label="First-time (30d)" value={kpis.demand.firstTimeClinics30d} />
            <Stat label="Repeat clinics" value={kpis.demand.repeatClinics} />
            <Stat label="Fill rate" value={pctLabel(kpis.marketplace.fillRatePct)} />
            <Stat label="Clinic CAC" value={usd(kpis.marketing.clinicCacCents)} />
          </CardBody>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title="Recently moving clinics" action={<Link href="/admin/growth/sales" className="text-sm text-brand-700">Sales queue →</Link>} />
        <Table>
          <thead><tr><Th>Clinic</Th><Th>Stage</Th><Th>Intent</Th><Th>Updated</Th></tr></thead>
          <tbody>
            {recent.length ? recent.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <Td><Link href={`/admin/growth/prospects/${c.id}`} className="font-medium hover:text-brand-700">{c.clinicName}</Link><div className="text-xs text-slate-400">{[c.city, c.state].filter(Boolean).join(", ")}</div></Td>
                <Td><Badge>{humanize(c.stage)}</Badge></Td>
                <Td className="text-xs">{humanize(c.intentCategory)} · {c.intentScore}</Td>
                <Td className="text-xs">{dateLabel(c.updatedAt)}</Td>
              </tr>
            )) : <tr><Td colSpan={4} className="text-slate-500">No clinics past first contact yet.</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
