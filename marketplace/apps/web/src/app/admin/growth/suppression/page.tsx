import { growth } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateTimeLabel, humanize } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { addSuppressionAction, removeSuppressionAction } from "../actions";
import { GrowthTabs } from "../ui";

export const metadata = { title: "Suppression list" };
export const dynamic = "force-dynamic";

export default async function Suppression() {
  const { actor } = await requireActor("admin");
  const rows = await growth.suppressions(actor);
  return (
    <>
      <PageHeader title="Suppression list" description="Checked in code before every growth email and text, including ones a person writes. Unsubscribe links, STOP replies, opt-out wording in replies and do-not-contact all land here automatically. No agent can override it." />
      <GrowthTabs current="/admin/growth/suppression" />
      <Card className="mb-6">
        <CardHeader title="Add" />
        <CardBody>
          <ActionForm action={addSuppressionAction} className="flex flex-wrap items-end gap-2" resetOnSuccess>
            <Field label="Channel"><Select name="channel"><option value="EMAIL">Email</option><option value="SMS">SMS</option><option value="ALL">All channels</option></Select></Field>
            <Field label="Email or phone"><Input name="address" required className="w-72" /></Field>
            <Field label="Reason"><Select name="reason">{["MANUAL", "UNSUBSCRIBE", "BOUNCE", "COMPLAINT", "DO_NOT_CONTACT"].map((r) => <option key={r} value={r}>{humanize(r)}</option>)}</Select></Field>
            <SubmitButton size="sm">Suppress</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>
      <Card>
        <Table>
          <thead><tr><Th>Address</Th><Th>Channel</Th><Th>Reason</Th><Th>Source</Th><Th>Added</Th><Th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="font-mono text-xs">{r.address}</Td><Td>{r.channel}</Td><Td><Badge tone="red">{humanize(r.reason)}</Badge></Td><Td className="text-xs">{r.source}</Td><Td className="text-xs">{dateTimeLabel(r.createdAt)}</Td>
                <Td><ActionForm action={removeSuppressionAction} confirm="Remove from the suppression list? Only do this if the person asked to receive messages again."><input type="hidden" name="id" value={r.id} /><SubmitButton size="sm" variant="ghost">Remove</SubmitButton></ActionForm></Td>
              </tr>
            ))}
            {!rows.length ? <tr><Td colSpan={6} className="text-slate-500">Nobody is suppressed.</Td></tr> : null}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
