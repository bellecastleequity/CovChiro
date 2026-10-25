import Link from "next/link";
import { CLINIC_GROUPS } from "@cm/core";
import { adminlists } from "@cm/services";
import { CountChips, FilterForm, ListSummary, stateLabel, type ListParams } from "@/components/admin/list-filters";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";

const groupLabel = Object.fromEntries(CLINIC_GROUPS.map((g) => [g.key, g.label.replace(/ \(.*\)$/, "")]));
const groupTone = { active: "green", quiet: "amber", onboarding: "blue", suspended: "red", deactivated: "gray" } as const;
const VERIFICATION = [
  { value: "VERIFIED", label: "Verified" },
  { value: "PENDING", label: "Waiting for review" },
  { value: "NEEDS_INFO", label: "Asked for more" },
  { value: "NOT_STARTED", label: "Not started" },
  { value: "REJECTED", label: "Declined" },
];

export default async function Clinics({ searchParams }: { searchParams: Promise<ListParams> }) {
  const { actor } = await requireActor("admin");
  const sp = await searchParams;
  const params: ListParams = { q: sp.q, group: sp.group, state: sp.state, payment: sp.payment, verification: sp.verification, all: sp.all };
  const list = await adminlists.clinicList(actor, { ...params, all: !!sp.all });
  const path = "/admin/clinics";
  return (
    <>
      <PageHeader title="Clinics" description={`${list.total.toLocaleString()} clinics · ${list.groups.find((g) => g.key === "active")!.count.toLocaleString()} posted a shift in the last 90 days · ${list.withPayment.toLocaleString()} with a card on file`} />
      <div className="mb-4 space-y-3">
        <CountChips path={path} params={params} name="group" total={list.groupTotal} options={list.groups.map((g) => ({ value: g.key, label: g.label, count: g.count }))} />
        <FilterForm path={path} params={params} placeholder="Clinic, email, phone or city" keep={["group"]}
          selects={[
            { name: "state", label: "State (locations)", options: [...list.states.map((s) => ({ value: s.key, label: `${stateLabel(s.key)} · ${s.count}` })), ...(list.noLocation ? [{ value: "none", label: `No location yet · ${list.noLocation}` }] : [])] },
            { name: "payment", label: "Card on file", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
            { name: "verification", label: "Verification", options: VERIFICATION },
          ]} />
        <ListSummary path={path} params={params} shown={list.rows.length} matched={list.matched} total={list.total} noun="clinics" />
      </div>
      <Card>
        <Table>
          <thead><tr><Th>Clinic</Th><Th>Locations</Th><Th>Last posted</Th><Th>Payment method</Th><Th>Agreement</Th><Th>Status</Th></tr></thead>
          <tbody>
            {list.rows.length ? null : <tr><Td colSpan={6} className="py-8 text-center text-slate-500">No clinics match these filters.</Td></tr>}
            {list.rows.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <Td><Link href={`/admin/clinics/${c.id}`} className="font-medium text-slate-900 hover:text-brand-700">{c.displayName}</Link><div className="text-xs text-slate-500">{c.billingEmail}</div></Td>
                <Td>{c.locations.map((l) => `${l.city}, ${l.state}`).join(" · ") || "—"}</Td>
                <Td>{c.lastPostedAt ? dateLabel(c.lastPostedAt, undefined, { month: "short", day: "numeric", year: "numeric" }) : "Never"}</Td>
                <Td>{c.hasPaymentMethod ? "Yes" : "No"}</Td>
                <Td>{c.agreementSignedAt ? `v${c.agreementVersion}` : "—"}</Td>
                <Td><Badge tone={groupTone[c.group]}>{groupLabel[c.group]}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
