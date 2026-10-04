import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@cm/db";
import { growth } from "@cm/services";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader, Stat, Table, Td, Th } from "@/components/ui/misc";
import { humanize } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/form";
import { tagMarketAction } from "../../actions";
import { GrowthTabs, supplyTone } from "../../ui";

export const metadata = { title: "Market" };
export const dynamic = "force-dynamic";

export default async function Market({ params }: { params: Promise<{ key: string }> }) {
  await requireActor("admin");
  const key = (await params).key;
  const [r] = await growth.marketSupply({ key });
  if (!r) notFound();
  const [prospects, clinics] = await Promise.all([
    prisma.providerProspect.findMany({ where: { marketKey: key, providerId: null }, orderBy: [{ contactStatus: "desc" }, { createdAt: "desc" }], take: 60 }),
    prisma.clinicProspect.findMany({ where: { marketKey: key }, orderBy: [{ intentScore: "desc" }], take: 20 }),
  ]);
  const profession = await prisma.profession.findUnique({ where: { code: r.market.professionCode } });
  return (
    <>
      <PageHeader back={{ href: "/admin/growth/markets", label: "Supply & demand" }} title={r.market.name} description={`${profession?.displayName ?? r.market.professionCode} · ${r.market.state} · ${r.market.radiusMiles}-mile radius`} actions={<Link href="/admin/growth/markets" className="text-sm text-brand-700">← Supply & demand</Link>} />
      <GrowthTabs current="/admin/growth/markets" />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Coverage-ready" value={r.ready} hint={`target ${r.market.targetProviders}`} tone="green" />
        <Stat label="Supply" value={<Badge tone={supplyTone(r.supply)}>{r.supply}</Badge>} hint={`priority ${r.priority}`} />
        <Stat label="Readiness" value={<Badge tone={supplyTone(r.readiness)}>{humanize(r.readiness)}</Badge>} hint={`growth target ${r.targetStatus.toLowerCase()}`} />
        <Stat label="Upcoming requests" value={r.upcomingRequests} hint={`${r.upcomingOpen} still open`} />
        <Stat label="Filled (30 days)" value={`${r.filled30}/${r.filled30 + r.unfilled30}`} hint={`${r.completed30} completed`} />
        <Stat label="Demand" value={r.demand} hint={`${r.clinics} clinics booking`} />
      </div>
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Coverage-ready within" />
          <CardBody className="grid grid-cols-4 gap-3">{([25, 50, 75, 100] as const).map((d) => <Stat key={d} label={`${d} miles`} value={r.within[d]} />)}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Recruitment pipeline here" />
          <CardBody className="grid grid-cols-4 gap-3">
            <Stat label="Prospects" value={r.prospects.providers} />
            <Stat label="Contactable" value={r.prospects.contactable} />
            <Stat label="Contacted" value={r.prospects.contacted} />
            <Stat label="Registered" value={r.prospects.registered} tone="brand" />
          </CardBody>
        </Card>
      </div>
      <Card className="mb-6">
        <CardHeader title="Run a recruitment campaign here" description="Tags this market's not-yet-contacted provider prospects with a campaign code, so its messages, registrations and first shifts are attributed to it." />
        <CardBody>
          <ActionForm action={tagMarketAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="market" value={key} />
            <Field label="Campaign code"><Input name="campaign" required placeholder="naples-supply" /></Field>
            <SubmitButton size="sm" variant="secondary">Tag prospects</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>
      <Card className="mb-6">
        <CardHeader title="Provider prospects" description="Inspect before or during recruitment. Open one to correct, suppress or re-run research." action={<Link href={`/admin/growth/prospects/providers?market=${key}`} className="text-sm text-brand-700">All →</Link>} />
        <Table>
          <thead><tr><Th>Provider</Th><Th>City</Th><Th>Contact</Th><Th>Stage</Th></tr></thead>
          <tbody>
            {prospects.length ? prospects.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <Td><Link href={`/admin/growth/prospects/providers/${p.id}`} className="font-medium hover:text-brand-700">{p.displayName}</Link><div className="text-xs text-slate-400">NPI {p.npi}</div></Td>
                <Td className="text-xs">{p.city}</Td>
                <Td className="text-xs">{p.email ?? "—"} <Badge tone={p.contactStatus === "VERIFIED" ? "green" : p.contactStatus === "FOUND" ? "blue" : p.contactStatus === "INVALID" ? "red" : "gray"}>{humanize(p.contactStatus)}</Badge></Td>
                <Td><Badge>{humanize(p.stage)}</Badge></Td>
              </tr>
            )) : <tr><Td colSpan={4} className="text-slate-500">No provider prospects mapped to this market yet.</Td></tr>}
          </tbody>
        </Table>
      </Card>
      <Card>
        <CardHeader title="Clinic prospects" action={<Link href={`/admin/growth/prospects?market=${key}`} className="text-sm text-brand-700">All →</Link>} />
        <Table>
          <tbody>
            {clinics.map((c) => <tr key={c.id}><Td><Link href={`/admin/growth/prospects/${c.id}`} className="hover:text-brand-700">{c.clinicName}</Link></Td><Td className="text-xs">{c.city}</Td><Td><Badge>{humanize(c.stage)}</Badge></Td></tr>)}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
