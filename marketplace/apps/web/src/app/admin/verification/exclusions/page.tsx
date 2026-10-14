import Link from "next/link";
import { exclusions } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { Alert, Empty, PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateTimeLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { exclusionImportAction, exclusionRefreshAction } from "../../actions";

export const metadata = { title: "Exclusion check" };

export default async function ExclusionCheck() {
  const { actor } = await requireActor("admin");
  const o = await exclusions.exclusionOverview(actor);
  const list = (k: "LEIE" | "SAM") => o.lists[k];
  return (
    <>
      <PageHeader
        back={{ href: "/admin/verification", label: "Verification queue" }}
        title="Exclusion check"
        description="Every provider is checked against the federal healthcare exclusion lists. A clinic that bills Medicare or Medicaid can be fined for using someone on them. An NPI on a list stops shifts at once; a same-name listing comes here for you to compare."
      />
      {o.lastError ? <Alert tone="warning" className="mb-6" title="The automatic OIG download failed">{o.lastError.message} ({dateTimeLabel(new Date(o.lastError.at))}). Upload the file by hand below, or try again.</Alert> : null}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <Card>
            <CardHeader title="OIG exclusion list (LEIE)" description={list("LEIE") ? `${list("LEIE")!.rows.toLocaleString()} listings · loaded ${dateTimeLabel(new Date(list("LEIE")!.loadedAt))}` : "Not loaded yet."} />
            <CardBody className="space-y-3 text-sm">
              <p className="text-slate-600">Downloaded automatically every month from oig.hhs.gov. Free.</p>
              <ActionForm action={exclusionRefreshAction} successMessage>
                <SubmitButton size="sm" variant="outline" pendingText="Downloading…">Download now and re-check everyone</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="SAM.gov exclusions" description={list("SAM") ? `${list("SAM")!.rows.toLocaleString()} listings · loaded ${dateTimeLabel(new Date(list("SAM")!.loadedAt))}` : "Not loaded yet."} />
            <CardBody className="space-y-3 text-sm">
              <ol className="list-decimal space-y-1 pl-5 text-slate-600">
                <li>On <a className="font-medium text-brand-700" href="https://sam.gov/data-services/Exclusions/Public%20V2?privacy=Public" target="_blank" rel="noreferrer">SAM.gov Data Services → Exclusions → Public V2</a>, download the latest extract (free, monthly is plenty).</li>
                <li>Upload it here as it is (.zip or .csv). An OIG UPDATED.csv works here too.</li>
              </ol>
              <ActionForm action={exclusionImportAction} className="space-y-3" successMessage>
                <Field label="Exclusion list file"><Input type="file" name="file" accept=".zip,.csv,.txt" required /></Field>
                <SubmitButton size="sm" pendingText="Loading…">Load and check</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
        <Card className="lg:col-span-2">
          <CardHeader title="Providers to look at" description={`${o.counts.CLEAR ?? 0} not listed · ${o.counts.POSSIBLE_MATCH ?? 0} possible · ${o.counts.EXCLUDED ?? 0} excluded · ${o.counts.UNCHECKED ?? 0} not checked yet`} />
          {o.flagged.length ? (
            <Table>
              <thead><tr><Th>Provider</Th><Th>Status</Th><Th>Listing</Th></tr></thead>
              <tbody>
                {o.flagged.map((p) => (
                  <tr key={p.id}>
                    <Td><Link className="font-medium text-brand-700" href={`/admin/providers/${p.id}#exclusion`}>{p.displayName}</Link></Td>
                    <Td>{p.exclusionStatus === "EXCLUDED" ? <Badge tone="red">Excluded</Badge> : <Badge tone="amber">Possible match</Badge>}</Td>
                    <Td className="text-slate-600">{p.exclusionNote}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <CardBody><Empty title="Nothing to look at">No provider matches a listing.</Empty></CardBody>
          )}
        </Card>
      </div>
    </>
  );
}
