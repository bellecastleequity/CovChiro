import Link from "next/link";
import { boardcheck } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateTimeLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { stateLicenseCheckAction } from "../../actions";

export const metadata = { title: "State license check" };

const OUTCOME: Record<string, string> = {
  stopped: "Stopped: license no longer counts",
  review: "Review (task created)",
  reinstated: "Active again: re-verify to reinstate",
  not_found: "Not in the state's file (task created)",
};

export default async function StateCheck() {
  const { actor } = await requireActor("admin");
  const last = await boardcheck.lastBoardCheck(actor, "DC", "FL");
  return (
    <>
      <PageHeader
        back={{ href: "/admin/verification", label: "Verification queue" }}
        title="State license check"
        description="Compare every provider's license with the state's own records. Inactive, delinquent, suspended or revoked licenses stop counting right away; probation, obligations, discipline records and anything unclear become tasks for you."
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1 h-fit">
          <CardHeader title="Run a check" description="Weekly is plenty." />
          <CardBody className="space-y-4 text-sm">
            <ol className="list-decimal space-y-1 pl-5 text-slate-600">
              <li>Open Florida&apos;s <a className="font-medium text-brand-700" href="https://mqa-internet.doh.state.fl.us/downloadnet/Licensure.aspx" target="_blank" rel="noreferrer">Health Care Practitioner Data Portal</a> → Licensure Data Download.</li>
              <li>Choose <b>Chiropractic Physician</b> and <b>All Statuses</b>, and download the file.</li>
              <li>Upload it here as it is (the .zip or the .txt).</li>
            </ol>
            <ActionForm action={stateLicenseCheckAction} className="space-y-3" successMessage>
              <input type="hidden" name="state" value="FL" />
              <input type="hidden" name="professionCode" value="DC" />
              <Field label="State license file"><Input type="file" name="file" accept=".zip,.txt,.csv,.dat" required /></Field>
              <SubmitButton pendingText="Checking…">Check licenses</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Last check" description={last ? `${dateTimeLabel(last.at)} · ${last.fileName}` : "Not run yet."} />
          {last ? (
            <>
              <CardBody className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><div className="text-2xl font-semibold tabular-nums text-emerald-700">{last.ok}</div>active</div>
                <div><div className="text-2xl font-semibold tabular-nums text-red-700">{last.stopped}</div>stopped</div>
                <div><div className="text-2xl font-semibold tabular-nums text-amber-700">{last.review}</div>to review</div>
                <div><div className="text-2xl font-semibold tabular-nums text-slate-700">{last.notFound}</div>not found</div>
              </CardBody>
              {last.problems.length ? (
                <Table>
                  <thead><tr><Th>Provider</Th><Th>License</Th><Th>State shows</Th><Th>What happened</Th></tr></thead>
                  <tbody>
                    {last.problems.map((p) => (
                      <tr key={`${p.providerId}${p.licenseNumber}`}>
                        <Td><Link href={`/admin/providers/${p.providerId}`} className="font-medium text-brand-700">{p.provider}</Link></Td>
                        <Td>{p.licenseNumber}</Td>
                        <Td>{p.status ?? "—"}</Td>
                        <Td>{OUTCOME[p.outcome] ?? p.outcome}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <CardBody className="text-sm text-slate-500">Every license matched and is active.</CardBody>
              )}
            </>
          ) : null}
        </Card>
      </div>
    </>
  );
}
