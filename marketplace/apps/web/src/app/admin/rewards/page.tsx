import Link from "next/link";
import { badges, rewards } from "@cm/services";
import { BADGE_TONES } from "@cm/core";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { LevelBadge } from "@/components/rewards/rewards-view";
import { cn } from "@/lib/cn";
import { requireActor } from "@/lib/session";
import { archiveCustomBadgeAction, awardBadgeAction, awardRewardPointsAction, revokeBadgeAction, saveCustomBadgeAction } from "../actions";
import { BadgeList } from "@/components/provider-profile";
import { dateLabel } from "@/lib/format";

export const metadata = { title: "Rewards & Badges" };

export default async function AdminRewards({ searchParams }: { searchParams: Promise<{ who?: string; days?: string; state?: string }> }) {
  const { actor } = await requireActor("admin");
  const f = await searchParams;
  const audience = f.who === "clinics" ? "CLINIC" : "PROVIDER";
  const days = f.days === "30" ? 30 : f.days === "90" ? 90 : null;
  const state = f.state?.trim().toUpperCase().slice(0, 2) || null;
  const [rows, assignable, custom, recent] = await Promise.all([rewards.leaderboard(actor, { audience, days, state, take: 100 }), badges.assignableBadges(), badges.customBadgeList(actor), badges.recentAwards(actor)]);
  const q = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(Object.entries({ who: f.who ?? "providers", days: f.days ?? "", state: f.state ?? "", ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/admin/rewards?${p}`;
  };
  const tab = (active: boolean) => cn("rounded-full px-3 py-1 text-sm font-medium", active ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200");
  return (
    <>
      <PageHeader title="Rewards & Badges" description="Points and levels for providers and clinics, and badges for providers. Use the leaderboards for giveaways, bonus promos and thank-yous. Point values and level thresholds are in Settings → Rewards." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Leaderboard" />
          <CardBody className="flex flex-wrap items-center gap-2">
            <Link href={q({ who: "providers" })} className={tab(audience === "PROVIDER")}>Providers</Link>
            <Link href={q({ who: "clinics" })} className={tab(audience === "CLINIC")}>Clinics</Link>
            <span className="mx-2 text-slate-300">|</span>
            <Link href={q({ days: null })} className={tab(!days)}>All time</Link>
            <Link href={q({ days: "90" })} className={tab(days === 90)}>90 days</Link>
            <Link href={q({ days: "30" })} className={tab(days === 30)}>30 days</Link>
            <form className="ml-auto flex gap-2">
              <input type="hidden" name="who" value={f.who ?? "providers"} />
              {f.days ? <input type="hidden" name="days" value={f.days} /> : null}
              <Input name="state" defaultValue={f.state ?? ""} placeholder="State, e.g. FL" className="w-32" />
            </form>
          </CardBody>
          {rows.length ? (
            <Table>
              <thead><tr><Th>#</Th><Th>{audience === "PROVIDER" ? "Provider" : "Clinic"}</Th><Th>State</Th><Th>Level</Th><Th className="text-right">{days ? `Points (${days} days)` : "Points"}</Th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.accountId}>
                    <Td className="tabular-nums text-slate-500">{i + 1}</Td>
                    <Td>{r.href ? <Link href={r.href} className="font-medium text-brand-700">{r.name}</Link> : r.name}</Td>
                    <Td>{r.state ?? "—"}</Td>
                    <Td><LevelBadge level={r.level} /></Td>
                    <Td className="text-right font-semibold tabular-nums">{r.points.toLocaleString("en-US")}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <CardBody className="text-sm text-slate-500">No points yet.</CardBody>
          )}
        </Card>
        <Card className="h-fit">
          <CardHeader title="Give or take points" description="A bonus, a contest prize, or a correction. They see your reason in their points history." />
          <CardBody>
            <ActionForm action={awardRewardPointsAction} className="space-y-3">
              <Field label="Who">
                <Select name="audience" defaultValue={audience}>
                  <option value="PROVIDER">Provider</option>
                  <option value="CLINIC">Clinic</option>
                </Select>
              </Field>
              <Field label="Their login email"><Input name="email" type="email" required /></Field>
              <Field label="Points" hint="Negative to take points away."><Input name="points" type="number" step={1} required /></Field>
              <Field label="Reason"><Input name="note" maxLength={200} required placeholder="e.g. October giveaway winner" /></Field>
              <SubmitButton>Save</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
      <div id="badges" className="mt-8 grid gap-6 lg:grid-cols-3">
        <Card className="h-fit">
          <CardHeader title="Give a badge" description="Shown on the provider's profile and candidate cards, like an earned badge. License, insurance and NPI badges only come from verified credentials, so they can't be given here." />
          <CardBody>
            <ActionForm action={awardBadgeAction} className="space-y-3" resetOnSuccess>
              <Field label="Provider's login email"><Input name="email" type="email" required /></Field>
              <Field label="Badge">
                <Select name="badgeKey" required defaultValue="">
                  <option value="" disabled>Pick a badge…</option>
                  <optgroup label="Built-in">{assignable.filter((b) => !b.custom).map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}</optgroup>
                  {assignable.some((b) => b.custom) ? <optgroup label="Your badges">{assignable.filter((b) => b.custom).map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}</optgroup> : null}
                </Select>
              </Field>
              <Field label="Private note (optional)" hint="Only admins see this."><Input name="note" maxLength={200} placeholder="e.g. Covered 3 emergencies in October" /></Field>
              <Checkbox name="tell" defaultChecked label="Tell them (in-app notice)" />
              <SubmitButton>Give badge</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Badges given by hand" description="Most recent first. Removing one takes it off their profile; badges they earn from activity stay." />
          {recent.length ? (
            <Table>
              <thead><tr><Th>Provider</Th><Th>Badge</Th><Th>Note</Th><Th>Given</Th><Th /></tr></thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id}>
                    <Td><Link href={`/admin/providers/${r.providerId}`} className="font-medium text-brand-700">{r.provider}</Link></Td>
                    <Td>{r.label}</Td>
                    <Td className="text-slate-500">{r.note ?? "—"}</Td>
                    <Td className="whitespace-nowrap text-slate-500">{dateLabel(r.at)}</Td>
                    <Td className="text-right">
                      <ActionForm action={revokeBadgeAction} successMessage={false}>
                        <input type="hidden" name="id" value={r.id} />
                        <SubmitButton variant="outline" size="sm">Remove</SubmitButton>
                      </ActionForm>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <CardBody className="text-sm text-slate-500">None yet.</CardBody>}
        </Card>
        <Card className="h-fit">
          <CardHeader title="Create a badge" description="Clinics see the name and description. Keep it to what the provider did; no licenses, certifications or contact details." />
          <CardBody>
            <ActionForm action={saveCustomBadgeAction} className="space-y-3" resetOnSuccess>
              <Field label="Name"><Input name="label" required minLength={2} maxLength={30} placeholder="e.g. Above & Beyond" /></Field>
              <Field label="What it means"><Textarea name="description" required minLength={5} maxLength={140} rows={2} placeholder="e.g. Went above and beyond for a clinic in need." /></Field>
              <Field label="Color"><Select name="tone" defaultValue="amber">{BADGE_TONES.map((t) => <option key={t} value={t}>{TONE_NAME[t]}</option>)}</Select></Field>
              <SubmitButton>Create badge</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Your badges" description="Edit the name, description or color any time; it changes everywhere it's shown. Archive to stop offering and showing it." />
          {custom.length ? (
            <CardBody className="divide-y divide-slate-100 p-0">
              {custom.map((b) => (
                <div key={b.key} className="space-y-3 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <BadgeList badges={[{ key: b.key, label: b.label, description: b.description, kind: "earned", tone: b.tone }]} />
                    <span className="text-xs text-slate-500">{b.holders} {b.holders === 1 ? "provider" : "providers"}{b.archived ? " · archived" : ""}</span>
                    <ActionForm action={archiveCustomBadgeAction} successMessage={false} className="ml-auto">
                      <input type="hidden" name="key" value={b.key} />
                      <input type="hidden" name="archived" value={b.archived ? "0" : "1"} />
                      <SubmitButton variant="outline" size="sm">{b.archived ? "Restore" : "Archive"}</SubmitButton>
                    </ActionForm>
                  </div>
                  {!b.archived ? (
                    <details>
                      <summary className="cursor-pointer text-sm font-medium text-brand-700">Edit</summary>
                      <ActionForm action={saveCustomBadgeAction} className="mt-3 grid gap-3 sm:grid-cols-[1fr_2fr_auto_auto] sm:items-end">
                        <input type="hidden" name="key" value={b.key} />
                        <Field label="Name"><Input name="label" defaultValue={b.label} required minLength={2} maxLength={30} /></Field>
                        <Field label="What it means"><Input name="description" defaultValue={b.description} required minLength={5} maxLength={140} /></Field>
                        <Field label="Color"><Select name="tone" defaultValue={b.tone}>{BADGE_TONES.map((t) => <option key={t} value={t}>{TONE_NAME[t]}</option>)}</Select></Field>
                        <SubmitButton variant="outline">Save</SubmitButton>
                      </ActionForm>
                    </details>
                  ) : null}
                </div>
              ))}
            </CardBody>
          ) : <CardBody className="text-sm text-slate-500">No custom badges yet. Create one on the left.</CardBody>}
        </Card>
      </div>
    </>
  );
}

const TONE_NAME: Record<string, string> = { amber: "Gold", brand: "Navy", green: "Green", blue: "Blue", gray: "Gray" };
