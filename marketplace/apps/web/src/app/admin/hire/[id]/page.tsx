import { notFound } from "next/navigation";
import { getSettings, hiring } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Alert, PageHeader } from "@/components/ui/misc";
import { relative } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { hireQuoteAction, hireStatusAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function AdminHire({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor("admin");
  const { id } = await params;
  const r = await hiring.hireRequest(actor, id).catch(() => null);
  if (!r) notFound();
  const draft = r.terms ?? (await hiring.draftPlacementTerms(actor, id));
  const fee = r.feeCents ?? (await getSettings())["placement.defaultFeeCents"];
  const done = r.status === "PAID" || r.status === "RELEASED";
  return (
    <>
      <PageHeader eyebrow="Hire request" title={`${r.clinic.displayName} → ${r.provider.displayName}`} description={`${hiring.POSITION_TYPES[r.positionType as keyof typeof hiring.POSITION_TYPES]} · received ${relative(r.createdAt)}`} actions={<Badge>{r.status.replace("_", " ").toLowerCase()}</Badge>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Clinic" />
            <CardBody className="space-y-1 text-sm">
              <div className="font-medium">{r.clinic.legalName}</div>
              <div>Call back: {r.callbackPhone ?? "—"}{r.callbackTimes ? ` (${r.callbackTimes})` : ""}</div>
              <div>Requested by {r.requester?.name} · {r.requester?.email}</div>
              {r.message ? <p className="mt-2 whitespace-pre-line rounded-xl bg-slate-50 p-3">{r.message}</p> : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Provider" />
            <CardBody className="space-y-1 text-sm">
              <div className="font-medium">{r.provider.legalName}</div>
              <div>{[r.provider.homeCity, r.provider.homeState].filter(Boolean).join(", ")}</div>
              <div>{r.provider.user.phone ?? "—"} · {r.provider.user.email}</div>
            </CardBody>
          </Card>
          {!done ? (
            <Card>
              <CardHeader title="Status & notes" />
              <CardBody>
                <ActionForm action={hireStatusAction} className="space-y-3">
                  <input type="hidden" name="hireId" value={r.id} />
                  <Textarea name="adminNotes" defaultValue={r.adminNotes ?? ""} placeholder="Call notes (admins only)" />
                  <Select name="status" defaultValue="">
                    <option value="">Keep status ({r.status.replace("_", " ").toLowerCase()})</option>
                    <option value="IN_TALKS">In talks</option>
                    <option value="DECLINED">Close request (tell the clinic)</option>
                  </Select>
                  <SubmitButton size="sm" variant="outline">Save</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
        </div>
        <Card className="lg:col-span-2">
          <CardHeader title={done ? "Accepted placement" : "Placement terms & payment link"} description={done ? undefined : "Edit the fee and terms, then send. The clinic gets an email and in-app link to accept and pay with its card on file."} />
          <CardBody>
            {done ? (
              <div className="space-y-3 text-sm">
                <Alert tone="success" title={r.status === "RELEASED" ? "Paid and released" : "Paid"}>Accepted by {r.acceptedName}, {r.acceptedTitle} · {r.acceptedAt?.toLocaleString("en-US")} · IP {r.acceptedIp ?? "—"} · terms SHA-256 {r.termsHash?.slice(0, 16)}…</Alert>
                <pre className="whitespace-pre-wrap font-sans text-slate-700">{r.terms}</pre>
              </div>
            ) : (
              <ActionForm action={hireQuoteAction} className="space-y-4">
                <input type="hidden" name="hireId" value={r.id} />
                <Field label="Placement fee ($)" htmlFor="fee"><Input id="fee" name="fee" inputMode="decimal" defaultValue={(fee / 100).toFixed(2)} className="max-w-40" required /></Field>
                <Field label="Terms" htmlFor="terms" hint="Prefilled from Settings. Edit as needed before sending."><Textarea id="terms" name="terms" defaultValue={draft} className="min-h-96 text-sm" required /></Field>
                <SubmitButton>{r.status === "QUOTED" ? "Update & resend link" : "Send payment link"}</SubmitButton>
              </ActionForm>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
