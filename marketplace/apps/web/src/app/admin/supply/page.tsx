import Link from "next/link";
import { DomainError } from "@cm/core";
import { concentration, enrollment, prelicensure } from "@cm/services";
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
  const waiting = await enrollment.waitingByState(actor);
  const conc = await concentration.shiftConcentration(actor);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const day = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" });
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
      <Card className="mt-6" id="concentration">
        <CardHeader
          title="Shift concentration"
          description={`Is the work piling onto a few providers? Booked and worked shifts from the last ${conc.days} days. A few busy providers is normal early on; recruit more where one person carries a market.`}
        />
        <CardBody className="space-y-6">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-800">By market</h3>
            {conc.markets.length ? (
              <Table>
                <thead>
                  <tr><Th>Market</Th><Th className="text-right">Shifts</Th><Th className="text-right">Providers</Th><Th>Top providers</Th><Th className="text-right">Top 1</Th><Th className="text-right">Top 3</Th></tr>
                </thead>
                <tbody>
                  {conc.markets.map((m) => (
                    <tr key={`${m.professionCode}${m.market}`}>
                      <Td>{m.market} <span className="text-xs text-slate-500">{m.professionCode}</span></Td>
                      <Td className="text-right tabular-nums">{m.total}</Td>
                      <Td className="text-right tabular-nums">{m.providers}</Td>
                      <Td className="text-xs">{m.top.map((p, i) => <span key={p.providerId}>{i ? ", " : ""}<Link href={`/admin/providers/${p.providerId}`} className="text-brand-700 hover:underline">{p.name}</Link> ({p.count})</span>)}</Td>
                      <Td className={`text-right tabular-nums ${m.top1Share >= 0.5 && m.total >= 5 ? "font-semibold text-amber-700" : ""}`}>{pct(m.top1Share)}</Td>
                      <Td className="text-right tabular-nums">{pct(m.top3Share)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-sm text-slate-500">No booked shifts in the last {conc.days} days yet.</p>
            )}
            <p className="mt-2 text-xs text-slate-500">Amber = one provider has half or more of a market&apos;s shifts (5+ shifts).</p>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Ready but no shifts in 30 days ({conc.idle.length})</h3>
            {conc.idle.length ? (
              <ul className="divide-y divide-slate-100 text-sm">
                {conc.idle.map((p) => (
                  <li key={p.providerId} className="flex flex-wrap justify-between gap-2 py-2">
                    <Link href={`/admin/providers/${p.providerId}`} className="font-medium text-brand-700 hover:underline">{p.name}</Link>
                    <span className="text-slate-500">{p.states.join(", ")} · ready since {day(p.readySince)} · {p.lastShift ? `last shift ${day(p.lastShift)}` : "no shifts yet"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Everyone who&apos;s ready has had a shift in the last 30 days.</p>
            )}
            <p className="mt-2 text-xs text-slate-500">Worth a personal call: check their hours, drive distance and minimum pay aren&apos;t keeping them out.</p>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Working {conc.heavyDays}+ days a week ({conc.heavy.length})</h3>
            {conc.heavy.length ? (
              <ul className="divide-y divide-slate-100 text-sm">
                {conc.heavy.map((p) => (
                  <li key={p.providerId} className="flex justify-between gap-2 py-2">
                    <Link href={`/admin/providers/${p.providerId}`} className="font-medium text-brand-700 hover:underline">{p.name}</Link>
                    <span className="tabular-nums text-slate-600">{p.daysPerWeek} days a week (last 4 weeks)</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Nobody is working {conc.heavyDays}+ days a week.</p>
            )}
            <p className="mt-2 text-xs text-slate-500">Near full-time work through the platform can look like employment for an independent contractor. Check with your attorney, and watch for fatigue.</p>
          </div>
          <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            Spread the work is <b>{conc.spreadWork.percent > 0 ? `on: −${conc.spreadWork.percent}% per shift over ${conc.spreadWork.freeShifts} in ${conc.spreadWork.days} days, up to −${conc.spreadWork.maxPercent}%` : "off"}</b>. It only changes who Smart Dispatch asks first, never who wins a shift or a clinic&apos;s own pick.{" "}
            <Link href="/admin/settings#s-dispatch.spreadWorkPercent" className="font-medium text-brand-700">Change in Settings</Link>
          </p>
        </CardBody>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Waiting for their state to open" description="Providers who enrolled in states that aren't open yet (a license submitted there, not rejected). Use it to pick the next state to open." />
        {waiting.length ? (
          <Table>
            <thead>
              <tr><Th>State</Th><Th>Profession</Th><Th className="text-right">Enrolled</Th><Th className="text-right">License verified</Th><Th className="text-right">Trailblazer badges taken</Th></tr>
            </thead>
            <tbody>
              {waiting.map((w) => (
                <tr key={`${w.professionCode}${w.state}`}>
                  <Td>{w.stateName}</Td>
                  <Td>{w.professionCode}</Td>
                  <Td className="text-right tabular-nums">{w.enrolled}</Td>
                  <Td className="text-right tabular-nums">{w.verified}</Td>
                  <Td className="text-right tabular-nums">{w.trailblazers} of {w.spots}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <CardBody className="text-sm text-slate-500">Nobody has enrolled outside the open states yet.</CardBody>
        )}
      </Card>
    </>
  );
}
