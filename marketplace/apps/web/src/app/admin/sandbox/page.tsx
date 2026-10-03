import { notFound } from "next/navigation";
import { env, isSandbox } from "@cm/config";
import { sandbox } from "@cm/services";
import { AutoRefresh } from "@/components/countdown";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { Alert, PageHeader, Stat, Table, Td, Th } from "@/components/ui/misc";
import { dateLabel, dateTimeLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { actAsAction, addTesterAction, buildDemoAction, clearOutboxAction, removeTesterAction, stopBuildAction, topUpAction } from "./actions";

export const metadata = { title: "Test site" };
export const dynamic = "force-dynamic";

function ActAs({ userId, label = "Act as", variant = "outline" }: { userId: string; label?: string; variant?: "primary" | "outline" }) {
  return (
    <ActionForm action={actAsAction} successMessage={false}>
      <input type="hidden" name="userId" value={userId} />
      <SubmitButton size="sm" variant={variant} pendingText="Opening…">{label}</SubmitButton>
    </ActionForm>
  );
}

export default async function SandboxPage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  if (!isSandbox()) notFound();
  const { actor } = await requireActor("admin");
  const { to } = await searchParams;
  const o = await sandbox.overview(actor);
  const mail = await sandbox.outbox(actor, { to: to ?? null, take: 60 });
  const yours = o.logins.filter((l) => l.yours && l.group !== "staff");
  const others = o.logins.filter((l) => !l.yours || l.group === "staff");
  const running = !!o.queue;
  return (
    <>
      {running ? <AutoRefresh seconds={20} /> : null}
      <PageHeader
        title="Test site"
        description="A full copy of the marketplace with demo clinics, providers and shifts. Nothing here is real: no money moves, and emails and texts land in the Test outbox below. Your two test accounts are yours to drive; every other demo account is a bot that answers like a person would, a few minutes later."
      />

      {running ? (
        <Alert tone="info" className="mb-6" title={`${o.queue!.label}: step ${Math.min(o.queue!.done + 1, o.queue!.total)} of ${o.queue!.total}`}>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white">
            <div className="h-full bg-brand-600 transition-all" style={{ width: `${Math.round((o.queue!.done / Math.max(1, o.queue!.total)) * 100)}%` }} />
          </div>
          <p className="mt-2 text-sm">Now: {o.queue!.current ?? "finishing"}. The site&apos;s other background jobs wait until this is done. You can leave this page; it keeps going.</p>
          {o.queue!.errorCount ? <p className="mt-1 text-sm">{o.queue!.errorCount} step(s) skipped so far (see below when finished).</p> : null}
        </Alert>
      ) : !o.builtAt ? (
        <Alert tone="warning" className="mb-6" title="No demo data yet">Click <b>Build demo data</b> below. It takes 15 to 30 minutes; you can leave the page while it runs.</Alert>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Demo built" value={o.builtAt ? dateLabel(new Date(o.builtAt)) : "Not yet"} />
        <Stat label="Open shifts ahead" value={o.counts.open} />
        <Stat label="Booked shifts ahead" value={o.counts.booked} />
        <Stat label="Furthest shift" value={o.furthestShift ? dateLabel(o.furthestShift) : "—"} hint={`Goal: through ${dateLabel(o.horizon)}`} />
        <Stat label="Test outbox" value={o.counts.outbox} hint="emails + texts" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Your test accounts" description={`Use "Act as" to open one in this browser (the amber bar at the top has "Back to admin"). Or sign in from another browser or a private window with the email and the password ${o.password}, to be the clinic and the provider at the same time.`} />
          <CardBody className="space-y-3">
            {yours.length ? yours.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                <div>
                  <p className="font-medium">{l.name} <Badge tone="brand">{l.group === "provider" ? "Your provider" : "Your clinic"}</Badge></p>
                  <p className="text-xs text-slate-500">{l.email} · {l.note}</p>
                </div>
                <ActAs userId={l.id} label={l.group === "provider" ? "Be the provider" : "Be the clinic"} variant="primary" />
              </div>
            )) : <p className="text-sm text-slate-500">They&apos;re created with the demo data.</p>}
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
              <li>Your provider has bookings this week (one at your own clinic, so you can clock in as the provider and sign the timesheet as the clinic), invitations waiting, and a clinic&apos;s change request to answer.</li>
              <li>Your clinic has open shifts with applicants to pick from, a booked shift, yesterday&apos;s timesheet to sign, a draft, a multi-day booking and a clinic-set-rate shift.</li>
              <li>Post a shift as your clinic and bot providers apply within minutes. Apply as your provider and the bot clinic picks you in about 10 minutes.</li>
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Demo data" description="Every Sunday evening the site adds shifts so there are always 37 days ahead. You can also do it now, or start over." />
          <CardBody className="space-y-4">
            <ActionForm action={topUpAction}>
              <SubmitButton variant="outline" disabled={running || !o.builtAt}>Top up shifts now</SubmitButton>
            </ActionForm>
            {o.owner ? (
            <ActionForm action={buildDemoAction} className="space-y-2" confirm="Replace everything on the test site with fresh demo data? Admin logins and settings stay.">
              <p className="text-sm text-slate-600">{o.builtAt ? "Start over: clears every clinic, provider, shift, payment and message on the test site, then builds three weeks of history and the next 37 days again." : "Builds 12 clinics, 34 providers, three weeks of worked and paid shifts, and the next 37 days."} Admin logins and Settings stay.</p>
              <div className="flex flex-wrap items-center gap-2">
                <Input name="confirm" placeholder="Type RESET" className="w-36" autoComplete="off" />
                <SubmitButton variant={o.builtAt ? "danger" : "primary"} disabled={running} pendingText="Starting…">{o.builtAt ? "Rebuild demo data" : "Build demo data"}</SubmitButton>
              </div>
            </ActionForm>
            ) : (
              <p className="text-sm text-slate-600">Only the test site&apos;s owner can rebuild or reset the demo data.</p>
            )}
            {running && o.owner ? (
              <ActionForm action={stopBuildAction} confirm="Stop the build? What's already made stays.">
                <SubmitButton variant="ghost" size="sm">Stop</SubmitButton>
              </ActionForm>
            ) : null}
            {o.last ? (
              <div className="rounded-lg bg-slate-50 p-3 text-sm">
                <p>Last run: <b>{o.last.label}</b>{o.last.finishedAt ? `, finished ${dateTimeLabel(new Date(o.last.finishedAt))}` : ""} ({o.last.total} steps, {o.last.errorCount} skipped).</p>
                {o.last.errors.length ? (
                  <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">
                    {o.last.errors.map((e, i) => <li key={i}>{e.kind}: {e.message}</li>)}
                  </ul>
                ) : null}
              </div>
            ) : null}
            <p className="text-xs text-slate-500">
              Payments: {o.stripe === "test" ? "Stripe TEST mode for accounts you sign up yourself (card 4242 4242 4242 4242); demo accounts use a built-in stand-in." : "built-in stand-in (no Stripe key). Add Stripe TEST keys to try the real checkout pages."}{" "}
              Real email only to: {o.emailAllow || "nobody (set SANDBOX_EMAIL_ALLOW)"}. Real texts only to: {o.smsAllow || "nobody (set SANDBOX_SMS_ALLOW)"}.
            </p>
          </CardBody>
        </Card>
      </div>

      {o.owner ? (
        <Card className="mt-6">
          <CardHeader title="Testers" description="People helping you evaluate the site. Each gets an admin login on the test site only (never the live site), with full admin access and Act as, but they can't rebuild or reset the demo data, manage testers, or change your login. They get a 6-digit sign-in code by email each time they sign in (no app needed)." />
          <CardBody className="space-y-4">
            <ActionForm action={addTesterAction} resetOnSuccess className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <Input name="name" placeholder="Name" autoComplete="off" />
              <Input name="email" type="email" placeholder="Email" autoComplete="off" />
              <Input name="password" placeholder="Temporary password (12+)" autoComplete="new-password" />
              <SubmitButton pendingText="Adding…">Add tester</SubmitButton>
            </ActionForm>
            {o.testers.length ? (
              <ul className="divide-y divide-slate-100">
                {o.testers.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                    <span>
                      <span className="font-medium">{t.name}</span> <span className="text-xs text-slate-500">{t.email}</span>{" "}
                      {t.disabledAt ? <Badge tone="gray">Removed</Badge> : t.lastLoginAt ? <Badge tone="green">Last in {dateLabel(t.lastLoginAt)}</Badge> : <Badge tone="amber">Hasn&apos;t signed in yet</Badge>}
                    </span>
                    {t.disabledAt ? null : (
                      <ActionForm action={removeTesterAction} confirm={`Remove ${t.name}? They're signed out and can't sign in.`}>
                        <input type="hidden" name="userId" value={t.id} />
                        <SubmitButton size="sm" variant="ghost">Remove</SubmitButton>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No testers yet. Send them {env().APP_BASE_URL.replace(/\/$/, "")}/login, their email and the temporary password.</p>
            )}
          </CardBody>
        </Card>
      ) : null}

      <Card className="mt-6">
        <CardHeader title="All demo logins" description={`Password for every one: ${o.password}`} />
        <Table>
          <thead>
            <tr><Th>Account</Th><Th>Login</Th><Th>Situation</Th><Th /></tr>
          </thead>
          <tbody>
            {others.map((l) => (
              <tr key={l.id}>
                <Td>
                  <span className="font-medium">{l.name}</span>
                  {l.person !== l.name ? <span className="block text-xs text-slate-500">{l.person}</span> : null}
                </Td>
                <Td className="text-xs">{l.email}</Td>
                <Td className="text-xs text-slate-600">{l.group === "provider" ? "Provider" : l.group === "staff" ? "Clinic staff" : "Clinic owner"} · {l.note}{l.disabled ? " · login suspended" : ""}</Td>
                <Td className="text-right">{l.disabled ? null : <ActAs userId={l.id} />}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card className="mt-6">
        <div id="outbox" className="scroll-mt-24" />
        <CardHeader
          title="Test outbox"
          description="Every email and text the test site would have sent, newest first. Sign-in codes and links are in here too."
          action={
            <ActionForm action={clearOutboxAction} confirm="Delete every message in the Test outbox?">
              <SubmitButton size="sm" variant="ghost">Clear</SubmitButton>
            </ActionForm>
          }
        />
        <CardBody>
          <form className="mb-4 flex flex-wrap gap-2" action="/admin/sandbox#outbox">
            <Input name="to" defaultValue={to ?? ""} placeholder="Filter by address or number, e.g. provider.you" className="w-80" />
            <button className="rounded-lg border border-slate-300 px-3 text-sm">Filter</button>
            {to ? <a href="/admin/sandbox#outbox" className="self-center text-sm underline">Show all</a> : null}
          </form>
          {mail.length ? (
            <ul className="divide-y divide-slate-100">
              {mail.map((m) => (
                <li key={m.id} className="py-2">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                      <Badge tone={m.channel === "sms" ? "amber" : "gray"}>{m.channel === "sms" ? "Text" : "Email"}</Badge>
                      <span className="font-medium">{m.subject ?? m.body.slice(0, 80)}</span>
                      <span className="text-xs text-slate-500">to {m.to} · {dateTimeLabel(m.createdAt)}</span>
                      {m.delivered ? <Badge tone="green">Also delivered</Badge> : null}
                    </summary>
                    <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm text-slate-800">{m.body}</pre>
                  </details>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">Nothing yet{to ? " for that address" : ""}.</p>
          )}
        </CardBody>
      </Card>
    </>
  );
}
