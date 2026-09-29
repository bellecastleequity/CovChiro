import { prisma } from "@cm/db";
import { admin } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateLabel, money } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { rateCardAction, regionAction } from "../actions";

export const metadata = { title: "Rates" };

export default async function Rates() {
  const { actor } = await requireActor("admin");
  const [regions, professions] = await Promise.all([admin.ratesOverview(actor), prisma.profession.findMany({ orderBy: { sortOrder: "asc" } })]);
  return (
    <>
      <PageHeader title="Rates" description="Clinic price and provider pay per profession × region × tier. New cards are effective-dated; posted shifts keep their original price (INV-7)." />
      <div className="space-y-6">
        {regions.map((r) => {
          const current = r.rateCards.filter((c) => !c.effectiveTo || c.effectiveTo > new Date());
          return (
            <Card key={r.id}>
              <CardHeader title={`${r.name} (tier ${r.tier})`} description={`ZIP3: ${r.zip3List.join(", ") || "none mapped"}`} />
              <Table>
                <thead><tr><Th>Profession</Th><Th>Tier</Th><Th className="text-right">Clinic price</Th><Th className="text-right">Provider pay</Th><Th className="text-right">Margin</Th><Th>Effective</Th></tr></thead>
                <tbody>
                  {current.map((c) => (
                    <tr key={c.id}><Td>{c.professionCode}</Td><Td>{c.durationTier}{c.minHours ? ` (min ${c.minHours}h)` : ""}</Td><Td className="text-right">{money(c.clinicPriceCents)}</Td><Td className="text-right">{money(c.providerPayCents)}</Td><Td className="text-right">{money(c.clinicPriceCents - c.providerPayCents)}</Td><Td className="text-xs">{dateLabel(c.effectiveFrom, "UTC", { month: "short", day: "numeric", year: "numeric" })}{c.effectiveTo ? ` → ${dateLabel(c.effectiveTo)}` : ""}</Td></tr>
                  ))}
                </tbody>
              </Table>
              <CardBody className="space-y-3 border-t border-slate-100">
                <ActionForm action={rateCardAction} className="flex flex-wrap items-end gap-2" resetOnSuccess>
                  <input type="hidden" name="rateRegionId" value={r.id} />
                  <Select name="professionCode" className="h-9 w-40">{professions.map((p) => <option key={p.code} value={p.code}>{p.code} ({p.pricingModel.toLowerCase()})</option>)}</Select>
                  <Select name="durationTier" className="h-9 w-32"><option value="HALF_DAY">Half day</option><option value="FULL_DAY">Full day</option><option value="HOURLY">Hourly</option></Select>
                  <Input name="clinicPrice" placeholder="Clinic $" className="h-9 w-24" required />
                  <Input name="providerPay" placeholder="Provider $" className="h-9 w-24" required />
                  <Input name="minHours" placeholder="Min h (hourly)" className="h-9 w-28" />
                  <Input name="effectiveFrom" type="date" className="h-9 w-40" />
                  <SubmitButton size="sm">Set rate</SubmitButton>
                </ActionForm>
                <ActionForm action={regionAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="state" value={r.state} />
                  <Input name="name" defaultValue={r.name} className="h-9 w-36" />
                  <Input name="tier" type="number" defaultValue={r.tier} className="h-9 w-20" />
                  <Input name="zip3List" defaultValue={r.zip3List.join(", ")} className="h-9 w-80" />
                  <SubmitButton size="sm" variant="outline">Save region</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          );
        })}
        <Card>
          <CardHeader title="New rate region" />
          <CardBody>
            <ActionForm action={regionAction} className="flex flex-wrap items-end gap-2" resetOnSuccess>
              <Input name="state" placeholder="ST" maxLength={2} className="h-9 w-16" required />
              <Input name="name" placeholder="GA-Metro" className="h-9 w-36" required />
              <Input name="tier" type="number" placeholder="Tier" className="h-9 w-20" />
              <Input name="zip3List" placeholder="ZIP3s: 300, 301, 303" className="h-9 w-80" />
              <SubmitButton size="sm">Create</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
