import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@cm/db";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/misc";
import { dateLabel, money } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { clinicStatusAction } from "../../actions";

export default async function AdminClinic({ params }: { params: Promise<{ id: string }> }) {
  await requireActor("admin");
  const { id } = await params;
  const c = await prisma.clinicOrg.findUnique({ where: { id }, include: { locations: true, members: { include: { user: true } }, payments: { orderBy: { createdAt: "desc" }, take: 20 } } });
  if (!c) notFound();
  const shifts = await prisma.shift.findMany({ where: { location: { clinicOrgId: id } }, orderBy: { startsAt: "desc" }, take: 20 });
  return (
    <>
      <PageHeader title={c.displayName} description={`${c.legalName} · ${c.billingEmail ?? ""}`} actions={<StatusBadge status={c.status} />} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card><CardHeader title="Locations" /><CardBody className="space-y-1 text-sm">{c.locations.map((l) => <div key={l.id}>{l.name} — {l.addressLine1}, {l.city}, {l.state} {l.zip} · {l.professionCodes.join(", ")}{l.active ? "" : " (archived)"}</div>)}</CardBody></Card>
          <Card><CardHeader title="Shifts" /><CardBody className="space-y-1 text-sm">{shifts.map((s) => <div key={s.id} className="flex justify-between"><Link href={`/admin/shifts/${s.id}`} className="hover:text-brand-700">{dateLabel(s.startsAt)} · {s.professionCode}</Link><StatusBadge status={s.status} /></div>)}</CardBody></Card>
          <Card><CardHeader title="Payments" /><CardBody className="space-y-1 text-sm">{c.payments.map((p) => <div key={p.id} className="flex justify-between"><span>{dateLabel(p.createdAt)} · {p.type}</span><span>{money(p.amountCents)} · {p.status.toLowerCase()}</span></div>)}</CardBody></Card>
        </div>
        <div className="space-y-6">
          <Card><CardHeader title="Team" /><CardBody className="space-y-1 text-sm">{c.members.map((m) => <div key={m.id}>{m.user.name} · {m.user.email} · {m.role === "CLINIC_OWNER" ? "owner" : "staff"}</div>)}</CardBody></Card>
          <Card>
            <CardHeader title="Status" />
            <CardBody>
              <ActionForm action={clinicStatusAction} className="space-y-2">
                <input type="hidden" name="clinicOrgId" value={c.id} />
                <Select name="status" defaultValue={c.status}>{["ACTIVE", "SUSPENDED", "DEACTIVATED"].map((s) => <option key={s}>{s}</option>)}</Select>
                <Input name="note" placeholder="Note" />
                <SubmitButton size="sm">Update</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
