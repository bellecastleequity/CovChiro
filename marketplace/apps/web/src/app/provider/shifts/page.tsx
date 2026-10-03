import Link from "next/link";
import { Car, Clock, Search, Users, Zap } from "lucide-react";
import { prisma } from "@cm/db";
import { providerProfile, shiftBoard } from "@cm/services";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { Empty, PageHeader } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { dateLabel, money, timeRange } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { CanTake } from "../can-take";

export const metadata = { title: "Find shifts" };

export default async function Board({ searchParams }: { searchParams: Promise<{ profession?: string; state?: string }> }) {
  const { actor } = await requireActor("provider");
  const f = await searchParams;
  const [{ canTake, provider }, shifts, professions] = await Promise.all([providerProfile(actor), shiftBoard(actor, { professionCode: f.profession || undefined, state: f.state || undefined }), prisma.profession.findMany()]);
  const states = [...new Set(Object.values(canTake).flat())];
  return (
    <>
      <PageHeader title="Find shifts" description={<>Showing shifts you're licensed for — <CanTake canTake={canTake} /></>} />
      <form className="mb-5 flex flex-wrap gap-2">
        <Select name="profession" defaultValue={f.profession ?? ""} className="w-auto">
          <option value="">All my professions</option>
          {Object.keys(canTake).map((c) => (
            <option key={c} value={c}>{professions.find((p) => p.code === c)?.displayName ?? c}</option>
          ))}
        </Select>
        <Select name="state" defaultValue={f.state ?? ""} className="w-auto">
          <option value="">All my states</option>
          {states.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <button className={buttonClass("outline")}>Filter</button>
      </form>
      {provider.status !== "ACTIVE" ? (
        <Empty title="Finish setting up to see shifts" icon={<Search className="size-6" />}>
          Once your profile, license and malpractice are verified, matching shifts appear here.
        </Empty>
      ) : shifts.length === 0 ? (
        <Empty title="No matching shifts right now" icon={<Search className="size-6" />}>
          We'll notify you when a shift in your licensed states fits your availability and drive distance.
        </Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {shifts.map((s) => (
            <Link key={s.id} href={`/provider/shifts/${s.id}`}>
              <Card className="h-full p-4 transition hover:border-brand-300">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{dateLabel(s.startsAt, s.timeZone)}</div>
                    <div className="text-sm text-slate-500">{timeRange(s.startsAt, s.endsAt, s.timeZone)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold tabular-nums text-brand-700">{money(s.pay.totalCents)}</div>
                    <div className="text-xs text-slate-500">incl. {money(s.pay.mileageCents)} mileage{s.pay.lodgingCents ? ` + ${money(s.pay.lodgingCents)} lodging` : ""}</div>
                  </div>
                </div>
                <div className="mt-3 text-sm font-medium">{s.clinicName}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span>{s.city}, {s.state}</span>
                  {s.driveMinutes !== null ? <span className="flex items-center gap-1"><Car className="size-3.5" />{s.driveMinutes} min</span> : null}
                  {s.expectedPatients ? <span className="flex items-center gap-1"><Users className="size-3.5" />{s.declaredTier ? `${s.declaredTier === "LIGHT" ? "Light" : "Busy"} day · ` : ""}~{s.expectedPatients} patients</span> : s.declaredTier ? <span className="flex items-center gap-1"><Users className="size-3.5" />{s.declaredTier === "LIGHT" ? "Light" : "Busy"} day</span> : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge tone="brand">{s.professionCode}</Badge>
                  {s.urgent ? <Badge tone="amber"><Clock className="size-3" />Urgent</Badge> : null}
                  {s.instantBook ? <Badge tone="blue"><Zap className="size-3" />Instant book</Badge> : null}
                  {s.clinicSetRate ? <Badge tone="amber">Clinic-set rate</Badge> : null}
                  {s.applied ? <Badge tone="green">Applied</Badge> : null}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
