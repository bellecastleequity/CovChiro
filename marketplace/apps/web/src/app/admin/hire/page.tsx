import Link from "next/link";
import { hiring } from "@cm/services";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Empty, PageHeader } from "@/components/ui/misc";
import { money, relative } from "@/lib/format";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Hire requests" };
export const dynamic = "force-dynamic";

const HIRE_TONE: Record<string, "amber" | "blue" | "brand" | "green" | "gray"> = { NEW: "amber", IN_TALKS: "blue", QUOTED: "brand", PAID: "green", RELEASED: "green", DECLINED: "gray", CANCELLED: "gray" };

export default async function HireRequests() {
  const { actor } = await requireActor("admin");
  const rows = await hiring.hireRequests(actor);
  return (
    <>
      <PageHeader title="Hire requests" description="Clinics asking to hire a provider directly. Call both sides, then set the placement fee and send the payment link. Once paid, the provider is released to the clinic and blocked from its future shifts." />
      {rows.length ? (
        <Card className="divide-y divide-slate-100">
          {rows.map((r) => (
            <Link key={r.id} href={`/admin/hire/${r.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-slate-50">
              <div>
                <div className="font-medium">{r.clinic.displayName} → {r.provider.displayName}</div>
                <div className="text-xs text-slate-500">{hiring.POSITION_TYPES[r.positionType as keyof typeof hiring.POSITION_TYPES]} · {relative(r.createdAt)}{r.feeCents ? ` · ${money(r.feeCents)}` : ""}</div>
              </div>
              <Badge tone={HIRE_TONE[r.status] ?? "gray"}>{r.status.replace("_", " ").toLowerCase()}</Badge>
            </Link>
          ))}
        </Card>
      ) : <Empty title="No hire requests yet" />}
    </>
  );
}
