import { growth } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";
import { saveMarketAction } from "../actions";
import { GrowthTabs } from "../ui";

export const metadata = { title: "Markets & liquidity" };
export const dynamic = "force-dynamic";

export default async function Markets() {
  const { actor } = await requireActor("admin");
  const rows = await growth.markets(actor);
  return (
    <>
      <PageHeader title="Markets & provider liquidity" description="Coverage-ready providers by distance from each market's center. A market is 'demand acquisition ready' once the count inside its radius reaches the target. That informs where to market to clinics; it doesn't start any campaign by itself." />
      <GrowthTabs current="/admin/growth/markets" />
      <Card>
        <Table>
          <thead><tr><Th>Market</Th><Th className="text-right">≤25 mi</Th><Th className="text-right">≤50 mi</Th><Th className="text-right">≤75 mi</Th><Th className="text-right">≤100 mi</Th><Th className="text-right">In radius / target</Th><Th>Status</Th><Th className="text-right">Clinics</Th></tr></thead>
          <tbody>
            {rows.map(({ market: m, within, inMarket, ready, prospects, accounts, booked }) => (
              <tr key={m.id}>
                <Td><div className="font-medium">{m.name}</div><div className="text-xs text-slate-400">{m.key} · {m.radiusMiles} mi · priority {m.priority}{m.active ? "" : " · inactive"}</div></Td>
                {([25, 50, 75, 100] as const).map((r) => <Td key={r} className="text-right tabular-nums">{within[r]}</Td>)}
                <Td className="text-right tabular-nums">{inMarket} / {m.targetProviders}</Td>
                <Td>{ready ? <Badge tone="green">Demand acquisition ready</Badge> : <Badge tone="amber">Building supply</Badge>}</Td>
                <Td className="text-right text-xs tabular-nums">{prospects} prospects<div className="text-slate-400">{accounts} accounts · {booked} booked</div></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Add or edit a market" description="Same key updates an existing market." />
        <CardBody>
          <ActionForm action={saveMarketAction} className="grid gap-3 sm:grid-cols-4">
            <Field label="Key"><Input name="key" required placeholder="tampa" /></Field>
            <Field label="Name" className="sm:col-span-2"><Input name="name" required placeholder="Tampa Bay" /></Field>
            <Field label="State"><Input name="state" defaultValue="FL" maxLength={2} /></Field>
            <Field label="Center latitude"><Input name="centerLat" required inputMode="decimal" /></Field>
            <Field label="Center longitude"><Input name="centerLng" required inputMode="decimal" /></Field>
            <Field label="Radius (miles)"><Input name="radiusMiles" type="number" defaultValue={60} /></Field>
            <Field label="Target coverage-ready providers"><Input name="targetProviders" type="number" defaultValue={5} /></Field>
            <Field label="Priority (lower first)"><Input name="priority" type="number" defaultValue={100} /></Field>
            <div className="flex items-end"><Checkbox name="active" label="Active" defaultChecked /></div>
            <div className="flex items-end"><SubmitButton size="sm">Save market</SubmitButton></div>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
