import Link from "next/link";
import { callline, getSettings } from "@cm/services";
import { formatUsPhone } from "@cm/core";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Empty, PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateTimeLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { markCallHandledAction } from "./actions";

export const metadata = { title: "Calls" };
export const dynamic = "force-dynamic";

const OUTCOME: Record<string, string> = {
  TEXT_SENT: "Texted", CALLBACK_REQUESTED: "Wants a callback", OPTED_OUT: "Opted out of texts", TOO_MANY: "Daily text limit", FAILED: "Text failed", INVALID: "Bad number",
};

/** Admin → Calls: what callers chose on the phone line's menu (continue by text, or a callback). */
export default async function AdminCalls() {
  const { actor } = await requireActor("admin");
  const [rows, s] = await Promise.all([callline.adminCalls(actor), getSettings()]);
  const waiting = rows.filter((r) => r.kind === "CALLBACK" && r.outcome === "CALLBACK_REQUESTED" && !r.handledAt);
  const line = s["site.phoneLabel"] || (s["site.phone"] ? formatUsPhone(s["site.phone"]) : "the phone line");
  return (
    <>
      <PageHeader title="Calls" description={`Callers to ${line} who pressed 1 to continue by text, or asked for a callback. Texts go out from the AWS texting number; their replies are in Texts.`} />
      <Card className="mb-6">
        <CardHeader title={`Waiting for a callback (${waiting.length})`} />
        <CardBody className="p-0">
          {waiting.length ? (
            <Table>
              <thead><tr><Th>Call back</Th><Th>Asked</Th><Th>Called from</Th><Th /></tr></thead>
              <tbody>
                {waiting.map((r) => (
                  <tr key={r.id}>
                    <Td><a className="font-medium text-brand-700" href={`tel:${r.phone}`}>{formatUsPhone(r.phone)}</a></Td>
                    <Td className="text-xs">{dateTimeLabel(r.createdAt)}</Td>
                    <Td className="text-xs">{r.callerPhone ? formatUsPhone(r.callerPhone) : "Blocked / unknown"}</Td>
                    <Td><ActionForm action={markCallHandledAction}><input type="hidden" name="id" value={r.id} /><SubmitButton size="sm" variant="outline">Called back</SubmitButton></ActionForm></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <Empty title="Nobody is waiting for a callback" />}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="All calls (latest 200)" />
        <CardBody className="p-0">
          {rows.length ? (
            <Table>
              <thead><tr><Th>Number</Th><Th>When</Th><Th>Chose</Th><Th>Result</Th><Th>Called from</Th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <Td>{r.phone ? (r.kind === "TEXT" ? <Link className="text-brand-700" href={`/admin/texts?p=${encodeURIComponent(r.phone)}`}>{formatUsPhone(r.phone)}</Link> : formatUsPhone(r.phone)) : "—"}</Td>
                    <Td className="text-xs">{dateTimeLabel(r.createdAt)}</Td>
                    <Td className="text-xs">{r.kind === "TEXT" ? "Continue by text" : "Callback"}{r.choice === "other" ? " · another number" : ""}</Td>
                    <Td className="text-xs">{OUTCOME[r.outcome] ?? r.outcome}{r.handledAt ? ` · called back ${dateTimeLabel(r.handledAt)}` : ""}{r.error ? <div className="text-red-700">{r.error}</div> : null}</Td>
                    <Td className="text-xs">{r.callerPhone ? formatUsPhone(r.callerPhone) : "Blocked / unknown"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <Empty title="No calls yet" />}
        </CardBody>
      </Card>
    </>
  );
}
