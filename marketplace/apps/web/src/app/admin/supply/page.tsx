import Link from "next/link";
import { DomainError } from "@cm/core";
import { prelicensure } from "@cm/services";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { Alert, PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Provider supply" };

const GROUPS = { byState: "State", byCounty: "County", byCity: "City", byZip: "ZIP code" } as const;

export default async function Supply({ searchParams }: { searchParams: Promise<{ near?: string; by?: string }> }) {
  const { actor } = await requireActor("admin");
  const { near, by } = await searchParams;
  const group = (by && by in GROUPS ? by : "byCounty") as keyof typeof GROUPS;
  let data: Awaited<ReturnType<typeof prelicensure.providerSupply>> | null = null;
  let error: string | null = null;
  try {
    data = await prelicensure.providerSupply(actor, { near });
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    error = e.message;
    data = await prelicensure.providerSupply(actor, {});
  }
  const rows = data[group];
  return (
    <>
      <PageHeader title="Provider supply" description="Where coverage-ready providers are — check a market before marketing to its clinics." />
      <Card className="mb-6">
        <CardHeader title="Supply around a clinic" description="Coverage-ready providers within 25 / 50 / 75 / 100 miles (straight line), and how many of them say they'll drive that far." />
        <CardBody>
          <form className="flex flex-wrap gap-2">
            <Input name="near" defaultValue={near ?? ""} placeholder="Clinic address or ZIP, e.g. 32801" className="max-w-sm" />
            <input type="hidden" name="by" value={group} />
            <button className={buttonClass("primary", "md")}>Check supply</button>
          </form>
          {error ? <Alert tone="error" className="mt-3">{error}</Alert> : null}
          {data.radius ? (
            <div className="mt-4">
              <div className="mb-2 text-sm text-slate-600">Around {data.radius.label}</div>
              <Table>
                <thead>
                  <tr>
                    <Th>Within</Th>
                    <Th className="text-right">Coverage-ready</Th>
                    <Th className="text-right">…who'll drive that far</Th>
                    <Th className="text-right">In the pipeline</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.radius.rings.map((r) => (
                    <tr key={r.miles}>
                      <Td>{r.miles} miles</Td>
                      <Td className="text-right font-semibold">{r.ready}</Td>
                      <Td className="text-right">{r.readyWillDrive}</Td>
                      <Td className="text-right">{r.pipeline}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <p className="mt-2 text-xs text-slate-500">"Will drive" uses each provider's max one-way drive time at ~45 mph. Distances use home base; {data.noLocation} provider{data.noLocation === 1 ? "" : "s"} without a home address (mostly students) aren't placed on the map yet.</p>
            </div>
          ) : null}
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title={`Density by ${GROUPS[group].toLowerCase()}`}
          action={
            <div className="flex gap-1 text-xs">
              {Object.entries(GROUPS).map(([k, l]) => (
                <Link key={k} href={`/admin/supply?by=${k}${near ? `&near=${encodeURIComponent(near)}` : ""}`} className={`rounded-full px-3 py-1 ring-1 ${k === group ? "bg-brand-600 text-white ring-brand-600" : "text-slate-600 ring-slate-200"}`}>
                  {l}
                </Link>
              ))}
            </div>
          }
        />
        {rows.length ? (
          <Table>
            <thead>
              <tr>
                <Th>{GROUPS[group]}</Th>
                <Th className="text-right">Coverage-ready</Th>
                <Th className="text-right">Pipeline</Th>
                <Th className="text-right">Registered</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <Td>{r.key}</Td>
                  <Td className="text-right font-semibold">{r.ready}</Td>
                  <Td className="text-right">{r.pipeline}</Td>
                  <Td className="text-right">{r.registered}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <CardBody className="text-sm text-slate-500">No providers yet.</CardBody>
        )}
      </Card>
    </>
  );
}
