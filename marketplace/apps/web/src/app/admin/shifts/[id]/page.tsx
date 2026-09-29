import { notFound } from "next/navigation";
import { prisma } from "@cm/db";
import { getEligibleProviders, loadShift, rankEvaluated } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateLabel, dateTimeLabel, money, timeRange } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { adminAssignAction, adminCancelShiftAction, adminDispatchAction, adminStopDispatchAction, adminInviteAction, removeProviderAction, repriceAction } from "../../actions";

export default async function AdminShift({ params }: { params: Promise<{ id: string }> }) {
  await requireActor("admin");
  const { id } = await params;
  const shift = await prisma.shift.findUnique({
    where: { id },
    include: {
      location: { include: { clinicOrg: true } },
      assignments: { include: { provider: true, payments: true, payouts: true }, orderBy: { confirmedAt: "desc" } },
      applications: { include: { provider: true } },
      offers: { include: { provider: true }, orderBy: { createdAt: "desc" } },
      matchRuns: { orderBy: { createdAt: "desc" }, take: 3 },
      promoCode: true,
      dispatches: {
        orderBy: { startedAt: "desc" },
        take: 5,
        include: { waves: { orderBy: { number: "asc" }, include: { offers: { include: { provider: { select: { displayName: true } } }, orderBy: { dispatchScore: "desc" } } } } },
      },
    },
  });
  if (!shift) notFound();
  const tz = shift.location.timeZone;
  const selectable = ["OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING"].includes(shift.status);
  const loaded = await loadShift(prisma, id);
  const set = selectable ? await getEligibleProviders(prisma, loaded) : null;
  const ranked = set ? await rankEvaluated(prisma, loaded, set.eligible) : [];
  const activeDispatch = shift.dispatches.find((d) => d.status === "ACTIVE");
  const live = shift.assignments.find((a) => ["CONFIRMED", "IN_PROGRESS"].includes(a.status));
  const names = new Map((await prisma.provider.findMany({ where: { id: { in: [...(set?.excluded.map((e) => e.providerId) ?? []), ...ranked.map((r) => r.providerId)] } }, select: { id: true, displayName: true } })).map((p) => [p.id, p.displayName]));
  return (
    <>
      <PageHeader eyebrow={`${shift.location.clinicOrg.displayName} · ${shift.professionCode} · ${shift.state}`} title={dateLabel(shift.startsAt, tz, { weekday: "long", month: "long", day: "numeric" })} description={timeRange(shift.startsAt, shift.endsAt, tz)} actions={<StatusBadge status={shift.status} />} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {set ? (
            <Card>
              <CardHeader title={`Eligible providers (${ranked.length})`} description={`Scored now. ${set.excluded.length} filtered after the SQL prefilter, ${set.prefilteredOut} excluded by licensure/malpractice.`} />
              <Table>
                <thead><tr><Th>Provider</Th><Th>Score</Th><Th>Breakdown</Th><Th>Drive</Th><Th /></tr></thead>
                <tbody>
                  {ranked.slice(0, 25).map((r) => (
                    <tr key={r.providerId}>
                      <Td className="font-medium">{names.get(r.providerId)}</Td>
                      <Td className="tabular-nums">{r.score.toFixed(3)}</Td>
                      <Td className="text-xs text-slate-500">{Object.entries(r.components).map(([k, v]) => `${k} ${(v as number).toFixed(2)}`).join(" · ")}</Td>
                      <Td>{r.input.driveMinutes ?? "—"} min</Td>
                      <Td>
                        <div className="flex gap-1">
                          <ActionForm action={adminAssignAction} confirm="Assign this provider now? (eligibility is re-checked)"><input type="hidden" name="shiftId" value={id} /><input type="hidden" name="providerId" value={r.providerId} /><SubmitButton size="sm">Assign</SubmitButton></ActionForm>
                          <ActionForm action={adminInviteAction}><input type="hidden" name="shiftId" value={id} /><input type="hidden" name="providerId" value={r.providerId} /><SubmitButton size="sm" variant="outline">Offer</SubmitButton></ActionForm>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {set.excluded.length ? (
                <CardBody className="border-t border-slate-100">
                  <div className="mb-2 text-sm font-semibold">Filtered (why)</div>
                  <ul className="space-y-1 text-xs text-slate-600">
                    {set.excluded.map((e) => <li key={e.providerId}><span className="font-medium">{names.get(e.providerId)}</span>: {e.result.failures.map((f) => `${f.filter} ${f.message}`).join("; ")}</li>)}
                  </ul>
                </CardBody>
              ) : null}
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Assignments" />
            <CardBody className="space-y-3 text-sm">
              {shift.assignments.length ? shift.assignments.map((a) => (
                <div key={a.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex justify-between"><span className="font-medium">{a.provider.displayName}</span><StatusBadge status={a.status} /></div>
                  <div className="mt-1 text-xs text-slate-500">
                    {a.selectionMethod} · clinic {money(a.clinicTotalCents)} · provider {money(a.providerTotalCents)} · margin {money(a.clinicPriceCents - a.promoDiscountCents - a.providerPayCents)} · {a.driveMiles} mi
                  </div>
                  <div className="mt-1 text-xs text-slate-500">Payments: {a.payments.map((p) => `${p.type} ${money(p.amountCents)} ${p.status}`).join(", ") || "—"}</div>
                  <div className="text-xs text-slate-500">Payouts: {a.payouts.map((p) => `${p.kind} ${money(p.amountCents)} ${p.status}`).join(", ") || "—"}</div>
                  {a.cancelReason ? <div className="text-xs text-red-600">{a.cancelledBy}: {a.cancelReason}</div> : null}
                </div>
              )) : <p className="text-slate-500">None.</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Applications & offers" />
            <CardBody className="space-y-1 text-sm">
              {shift.applications.map((a) => <div key={a.id} className="flex justify-between"><span>{a.provider.displayName} applied · score {a.scoreAtApply.toFixed(3)}</span><StatusBadge status={a.status === "ACTIVE" ? "PENDING" : a.status} label={a.status.toLowerCase()} /></div>)}
              {shift.offers.map((o) => <div key={o.id} className="flex justify-between"><span>Offer → {o.provider.displayName} ({o.source.toLowerCase()}) · expires {dateTimeLabel(o.expiresAt, tz)}</span><Badge>{o.status.toLowerCase()}</Badge></div>)}
              {!shift.applications.length && !shift.offers.length ? <p className="text-slate-500">None.</p> : null}
            </CardBody>
          </Card>
          {shift.dispatches.length ? (
            <Card>
              <CardHeader title="Dispatch log" description="Waves in send order. Match score decides who wins; dispatch score decides who is asked first." />
              <CardBody className="space-y-4 text-sm">
                {shift.dispatches.map((d) => (
                  <div key={d.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{d.trigger.replaceAll("_", " ").toLowerCase()} · tier {d.tierAtStart.replaceAll("_", " ").toLowerCase()}</span>
                      <StatusBadge status={d.status === "ACTIVE" ? "PENDING" : d.status} label={`${d.status.toLowerCase()} · ${d.stage.replaceAll("_", " ").toLowerCase()}`} />
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Started {dateTimeLabel(d.startedAt, tz)}{d.endedAt ? ` · ended ${dateTimeLabel(d.endedAt, tz)}` : ""} · best match at start {d.bestMatchAtStart?.toFixed(3) ?? "—"}{d.filledVia ? ` · filled via ${d.filledVia.toLowerCase()}` : ""}
                    </div>
                    {d.waves.map((w) => (
                      <details key={w.id} className="mt-2 text-xs">
                        <summary className="cursor-pointer">
                          Wave {w.number}{w.isBroadcast ? " (broadcast)" : ""}{w.isStandby ? " (standby)" : ""} · {w.offers.length} offers · sent {dateTimeLabel(w.sentAt, tz)} · window to {dateTimeLabel(w.windowEndsAt, tz)}{w.closedAt ? " · closed" : ""}
                        </summary>
                        <ul className="mt-1 space-y-0.5 pl-4">
                          {w.offers.map((o) => (
                            <li key={o.id} className="flex justify-between gap-2">
                              <span>{o.provider.displayName} · match {o.matchScore.toFixed(3)} · dispatch {o.dispatchScore.toFixed(3)}{o.replyCode ? ` · code ${o.replyCode}` : ""}</span>
                              <span>{o.status.replaceAll("_", " ").toLowerCase()}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ))}
                  </div>
                ))}
              </CardBody>
            </Card>
          ) : null}
          {shift.matchRuns.length ? (
            <Card>
              <CardHeader title="Match-run log" />
              <CardBody className="space-y-3">
                {shift.matchRuns.map((m) => <details key={m.id} className="text-xs"><summary className="cursor-pointer">{dateTimeLabel(m.createdAt)} · {m.reason}</summary><pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-slate-50 p-2">{JSON.stringify(m.results, null, 1)}</pre></details>)}
              </CardBody>
            </Card>
          ) : null}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Pricing" />
            <CardBody className="space-y-1 text-sm">
              <div className="flex justify-between"><span>Clinic price</span><span>{money(shift.clinicPriceCents)}</span></div>
              <div className="flex justify-between"><span>Promo {shift.promoCode?.code ?? ""}</span><span>−{money(shift.promoDiscountCents)}</span></div>
              <div className="flex justify-between"><span>Provider pay</span><span>{money(shift.providerPayCents)}</span></div>
              <div className="flex justify-between font-semibold"><span>Margin</span><span>{money(shift.clinicPriceCents - shift.promoDiscountCents - shift.providerPayCents)}</span></div>
              <div className="text-xs text-slate-500">{(shift.premiumsApplied as { kind: string; percent: number }[]).map((p) => `${p.kind} +${p.percent}%`).join(", ") || "No premiums"}</div>
            </CardBody>
          </Card>
          {selectable ? (
            <Card>
              <CardHeader title="Smart Dispatch" description={activeDispatch ? "A dispatch is running." : "Send ranked waves now, regardless of urgency tier."} />
              <CardBody>
                {activeDispatch ? (
                  <ActionForm action={adminStopDispatchAction} confirm="Stop the running dispatch? Pending offers are withdrawn.">
                    <input type="hidden" name="shiftId" value={id} />
                    <SubmitButton size="sm" variant="outline">Stop dispatch</SubmitButton>
                  </ActionForm>
                ) : (
                  <ActionForm action={adminDispatchAction}>
                    <input type="hidden" name="shiftId" value={id} />
                    <SubmitButton size="sm">Dispatch now</SubmitButton>
                  </ActionForm>
                )}
              </CardBody>
            </Card>
          ) : null}
          {selectable || shift.status === "DRAFT" ? (
            <Card>
              <CardHeader title="Reprice (override)" description="Logged in the audit trail." />
              <CardBody>
                <ActionForm action={repriceAction} className="space-y-2">
                  <input type="hidden" name="shiftId" value={id} />
                  <Field label="Clinic price ($)"><Input name="clinicPrice" defaultValue={(shift.clinicPriceCents / 100).toFixed(2)} /></Field>
                  <Field label="Provider pay ($)"><Input name="providerPay" defaultValue={(shift.providerPayCents / 100).toFixed(2)} /></Field>
                  <Input name="reason" placeholder="Reason" required />
                  <SubmitButton size="sm" variant="outline">Reprice</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
          {live ? (
            <Card>
              <CardHeader title="Remove provider" description="Platform removal: clinic refunded in full; backfill starts." />
              <CardBody>
                <ActionForm action={removeProviderAction} confirm="Remove this provider from the shift?" className="space-y-2">
                  <input type="hidden" name="assignmentId" value={live.id} />
                  <Textarea name="reason" placeholder="Reason" required />
                  <Checkbox name="noShow" label="Record as a no-show" />
                  <SubmitButton size="sm" variant="danger">Remove</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
          {["DRAFT", "OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING", "CONFIRMED"].includes(shift.status) ? (
            <Card>
              <CardHeader title="Cancel shift (platform)" />
              <CardBody>
                <ActionForm action={adminCancelShiftAction} confirm="Cancel this shift? Clinic gets a full refund.">
                  <input type="hidden" name="shiftId" value={id} />
                  <Textarea name="reason" placeholder="Reason" required />
                  <SubmitButton size="sm" variant="danger" className="mt-2">Cancel shift</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
