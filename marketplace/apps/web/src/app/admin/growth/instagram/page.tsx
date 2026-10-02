import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { growth } from "@cm/services";
import { BulkSelect } from "@/components/admin/bulk-select";
import { RefreshAt } from "@/components/admin/refresh-at";
import { IgFollowPrompt, IgOpenButton } from "@/components/admin/instagram-assist";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, Empty, PageHeader, Stat } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";
import { instagramAction } from "../actions";
import { GrowthTabs } from "../ui";

export const metadata = { title: "Instagram" };
export const dynamic = "force-dynamic";

const ig = (h: string) => `https://www.instagram.com/${h}/`;

export default async function Instagram() {
  const { actor } = await requireActor("admin");
  const b = await growth.instagramBoard(actor);
  const { pace, rules } = b;
  const time = (d: Date) => d.toLocaleString("en-US", { timeZone: rules.timeZone, weekday: "short", hour: "numeric", minute: "2-digit" });
  const ready = b.queue.slice(0, pace.readyNow);
  const later = b.queue.slice(pace.readyNow);
  const waitText = {
    ok: null,
    window: `Pacing: ${rules.perWindow} every ${rules.windowMinutes} minutes.`,
    daily_cap: `Today's ${rules.perDay} are done.`,
    outside_hours: `Follow hours are ${rules.start}–${rules.end}.`,
  }[pace.reason];

  return (
    <>
      <PageHeader
        title="Instagram follow list"
        description="Florida clinics' Instagram accounts, taken only from links on the clinic's own website. You approve who goes in the queue, then follow them yourself in Instagram. This page paces you so the account stays safe; it never logs in to Instagram or follows for you."
      />
      <GrowthTabs current="/admin/growth/instagram" />
      <IgFollowPrompt action={instagramAction} />

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <Stat label="Followed today" value={`${pace.today} / ${rules.perDay}`} tone={pace.today >= rules.perDay ? "green" : "brand"} />
        <Stat label="Ready to follow now" value={pace.readyNow} hint={pace.nextAt ? <>Next {time(pace.nextAt)} <RefreshAt at={pace.nextAt.toISOString()} /></> : null} />
        <Stat label="In the queue" value={b.counts.APPROVED ?? 0} />
        <Stat label="Waiting for review" value={b.counts.FOUND ?? 0} hint={`${b.counts.FOLLOWED ?? 0} followed · ${b.counts.SKIPPED ?? 0} skipped`} />
      </div>

      <Card className="mb-6">
        <CardHeader
          title="Follow now"
          description={`Tap Open: on a computer the clinic opens in an Instagram window beside this page, on a phone in the Instagram app. Follow them, come back, and answer "Did you follow?". Limits: ${rules.perDay} a day, ${rules.perWindow} every ${rules.windowMinutes} minutes, ${rules.start}–${rules.end}. Auto-approve: ${rules.autoPerDay ? `${rules.autoPerDay} a day` : "off"}.`}
          action={<Link href="/admin/settings#s-growth.instagram.followsPerDay" className="text-xs font-medium text-brand-700 hover:underline">Change limits</Link>}
        />
        <CardBody>
          {!b.queue.length ? (
            <Empty title="The follow queue is empty.">Approve clinics below to add them.</Empty>
          ) : (
            <>
              {waitText && !ready.length ? <Alert tone="info" className="mb-3">{waitText} {pace.nextAt ? <>Next follow {time(pace.nextAt)} (<RefreshAt at={pace.nextAt.toISOString()} />).</> : null}</Alert> : null}
              <BulkSelect
                formId="ig-queue"
                action={instagramAction}
                noun="clinic"
                groups={[{ key: "ready", label: "ready" }]}
                actions={[
                  { value: "followed", label: "Mark followed", verb: "Mark as followed" },
                  { value: "review", label: "Back to review", verb: "Move back to review", variant: "outline" },
                  { value: "skip", label: "Skip", verb: "Skip", variant: "outline" },
                ]}
              />
              <ul className="divide-y divide-slate-100">
                {b.queue.map((p, i) => {
                  const isReady = i < ready.length;
                  return (
                    <li key={p.id} className={`flex flex-wrap items-center gap-3 py-3 ${isReady ? "" : "opacity-70"}`}>
                      <input type="checkbox" name="ids" value={p.id} form="ig-queue" data-group={isReady ? "ready" : "later"} className="size-4 accent-brand-600" aria-label={`Select ${p.clinicName}`} />
                      <div className="min-w-0 flex-1">
                        <Link href={`/admin/growth/prospects/${p.id}`} className="font-medium text-slate-900 hover:underline">{p.clinicName}</Link>
                        <div className="text-xs text-slate-500">@{p.instagramHandle} · {[p.city, p.state].filter(Boolean).join(", ")}{p.igAutoApproved ? " · auto-approved" : ""}</div>
                      </div>
                      {isReady ? (
                        <>
                          <IgOpenButton id={p.id} handle={p.instagramHandle!} name={p.clinicName} />
                          <ActionForm action={instagramAction} successMessage={false}>
                            <input type="hidden" name="ids" value={p.id} />
                            <input type="hidden" name="decision" value="followed" />
                            <SubmitButton size="sm" variant="outline">Followed</SubmitButton>
                          </ActionForm>
                        </>
                      ) : (
                        <Badge>{i === ready.length && pace.nextAt ? `Next · ${time(pace.nextAt)}` : "Up next"}</Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Review" description="Handles found on each clinic's website. Open one to check it's the right practice, then approve it into the follow queue or skip it." />
        <CardBody>
          {!b.review.length ? (
            <Empty title="Nothing to review.">Handles appear here as clinic research finds them (Prospecting).</Empty>
          ) : (
            <>
              <BulkSelect
                formId="ig-review"
                action={instagramAction}
                noun="clinic"
                groups={[{ key: "found", label: "on this page" }]}
                actions={[
                  { value: "approve", label: "Approve all", verb: "Add to the follow queue", allOf: "found" },
                  { value: "approve", label: "Approve selected", verb: "Add to the follow queue" },
                  { value: "skip", label: "Skip selected", verb: "Skip", variant: "outline" },
                ]}
              />
              <ul className="divide-y divide-slate-100">
                {b.review.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
                    <input type="checkbox" name="ids" value={p.id} form="ig-review" data-group="found" className="size-4 accent-brand-600" aria-label={`Select ${p.clinicName}`} />
                    <div className="min-w-0 flex-1">
                      <Link href={`/admin/growth/prospects/${p.id}`} className="font-medium text-slate-900 hover:underline">{p.clinicName}</Link>
                      <div className="text-xs text-slate-500">
                        {[p.city, p.state].filter(Boolean).join(", ")}
                        {p.website ? <> · <a href={p.website} target="_blank" rel="noopener noreferrer" className="hover:underline">{p.website.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}</a></> : null}
                      </div>
                    </div>
                    <a href={ig(p.instagramHandle!)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
                      @{p.instagramHandle} <ExternalLink className="size-3.5" />
                    </a>
                  </li>
                ))}
              </ul>
              {(b.counts.FOUND ?? 0) > b.review.length ? <p className="mt-3 text-xs text-slate-500">Showing the top {b.review.length} of {b.counts.FOUND}. Approve or skip these to see more.</p> : null}
            </>
          )}
        </CardBody>
      </Card>
    </>
  );
}
