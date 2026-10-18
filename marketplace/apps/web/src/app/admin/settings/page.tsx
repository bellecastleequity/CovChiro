import { admin, growth } from "@cm/services";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/misc";
import { SettingsFilter } from "@/components/admin/settings-filter";
import { requireActor } from "@/lib/session";
import { settingAction } from "../actions";
import { agentAction } from "../growth/actions";

export const metadata = { title: "Settings" };

type Row = Awaited<ReturnType<typeof admin.settingsView>>[number];

/** Growth has ~70 settings: shown as sub-groups by what they're about (no change to the settings themselves). */
const GROWTH_LAUNCH = new Set(["pausedOutbound", "agents", "providerMarketing", "clinicMarketing", "acquisitionPriorities", "primarySideShare", "followRecommendations", "escalationEmail", "postalAddress"]);
const GROWTH_PROVIDER = new Set(["providerOutreachMode", "contactResearchPerRun"]);
const GROWTH_CLINIC = new Set(["outreachMode", "discoveryAreasPerRun", "dailyOutreachCap", "rediscoverDays", "highValueDays"]);
function displayGroup(r: Row): string {
  if (r.group !== "Growth") return r.group;
  const k = r.key.slice("growth.".length);
  if (k.startsWith("apollo.")) return "Growth · Apollo.io";
  if (k.startsWith("instagram.")) return "Growth · Instagram";
  if (/canada|casl/i.test(k)) return "Growth · Canada";
  if (GROWTH_LAUNCH.has(k)) return "Growth · Launch switches & priorities";
  if (GROWTH_PROVIDER.has(k)) return "Growth · Provider acquisition";
  if (GROWTH_CLINIC.has(k)) return "Growth · Clinic acquisition";
  if (/^(ai|research)/.test(k)) return "Growth · AI, research & budgets";
  return "Growth · Email timing & limits";
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The on/off switches people look for most, in one place. "Agent" rows are Growth → AI agents switches. */
const SWITCHES: { title: string; items: ({ setting: string; label?: string; onMeans?: string } | { agent: growth.AgentKey })[] }[] = [
  {
    title: "Growth & prospecting",
    items: [
      { setting: "growth.pausedOutbound", label: "Pause all automated growth email & texts", onMeans: "Paused" },
      { setting: "growth.providerMarketing", label: "Provider marketing" },
      { setting: "growth.clinicMarketing", label: "Clinic marketing" },
      { agent: "providerDiscovery" },
      { agent: "contactDiscovery" },
      { agent: "providerOutreach" },
      { agent: "clinicProspecting" },
      { agent: "clinicOutreach" },
      { setting: "growth.apollo.enabled", label: "Apollo.io as a prospecting source" },
      { setting: "growth.apollo.autoDiscovery", label: "Apollo.io automatic discovery" },
      { setting: "growth.canadaOutreach", label: "Canada outreach (CASL)" },
    ],
  },
  {
    title: "Marketplace",
    items: [
      { setting: "market.openAllStates", label: "Open every state automatically" },
      { setting: "market.requireAvailableProvider", label: "Only post when a provider can take it" },
      { setting: "clinicVerify.enabled", label: "Clinic ownership verification" },
      { setting: "idcheck.enabled", label: "Photo ID check" },
      { setting: "exclusions.enabled", label: "Federal exclusion list check" },
      { setting: "flyIn.enabled", label: "Fly-in coverage" },
      { setting: "clinicRate.enabled", label: "Clinic-set rate (beta)" },
      { setting: "features.partnerProgram", label: "Partner clinic program" },
      { setting: "welcome.enabled", label: "Welcome Discount for new clinics" },
      { setting: "features.onCallEnabled", label: "On Call auto-accept" },
      { setting: "payments.payInFullEnabled", label: "Charge in full when a clinic is overdue" },
    ],
  },
  {
    title: "Programs & site",
    items: [
      { setting: "features.preLicensureEnabled", label: "Student signup path" },
      { setting: "rewards.enabled", label: "Rewards" },
      { setting: "referrals.enabled", label: "Referrals" },
      { setting: "chat.enabled", label: "Chat bubble" },
      { setting: "features.comparisonClaim", label: "\"Charge clinics less, pay doctors more\" line" },
      { setting: "reconfirm.enabled", label: "Shift reconfirmation" },
      { setting: "timeclock.enabled", label: "Time clock" },
      { setting: "activity.enabled", label: "Pause inactive providers" },
      { setting: "backups.enabled", label: "Nightly backups" },
      { setting: "health.enabled", label: "System health emails" },
    ],
  },
];

function Switches({ rows }: { rows: Row[] }) {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const agentsRow = byKey.get("growth.agents");
  const agents = { ...((agentsRow?.default ?? {}) as Record<string, boolean>), ...((agentsRow?.value ?? {}) as Record<string, boolean>) };
  return (
    <Card id="switches" className="scroll-mt-20">
      <CardHeader title="On / off switches" description="The main features in one place. Turning one here is the same as changing it below (or on Growth → AI agents for the agents). Every change is audit-logged." />
      <div className="grid gap-x-8 gap-y-6 px-5 pb-5 md:grid-cols-2 xl:grid-cols-3">
        {SWITCHES.map((sec) => (
          <div key={sec.title}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{sec.title}</h3>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {sec.items.map((it) => {
                if ("agent" in it) {
                  const on = !!agents[it.agent];
                  return (
                    <li key={it.agent} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1">
                        {growth.AGENTS[it.agent][0]} <Link href="/admin/growth/agents" className="whitespace-nowrap text-xs text-brand-700 hover:underline">AI agent →</Link>
                      </span>
                      <ActionForm action={agentAction} successMessage={false}>
                        <input type="hidden" name="key" value={it.agent} />
                        <input type="hidden" name="on" value={on ? "false" : "true"} />
                        <SwitchButton on={on} />
                      </ActionForm>
                    </li>
                  );
                }
                const r = byKey.get(it.setting);
                if (!r || typeof r.value !== "boolean") return null;
                const on = r.value;
                return (
                  <li key={it.setting} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <a href={`#s-${r.key}`} className="min-w-0 flex-1 hover:text-brand-700">{it.label ?? r.label}</a>
                    <ActionForm action={settingAction} successMessage={false}>
                      <input type="hidden" name="key" value={r.key} />
                      <input type="hidden" name="value" value={on ? "false" : "true"} />
                      <SwitchButton on={on} onLabel={it.onMeans} />
                    </ActionForm>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** A pill that shows the state and flips it when tapped. */
function SwitchButton({ on, onLabel }: { on: boolean; onLabel?: string }) {
  return (
    <SubmitButton
      size="sm"
      variant="ghost"
      pendingText="…"
      className={on ? "min-w-16 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100" : "min-w-16 bg-slate-100 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-200"}
      aria-label={on ? "On: tap to turn off" : "Off: tap to turn on"}
    >
      {on ? onLabel ?? "On" : "Off"}
    </SubmitButton>
  );
}

export default async function Settings() {
  const { actor } = await requireActor("admin");
  const all = await admin.settingsView(actor);
  const rows = all.map((r) => ({ ...r, group: displayGroup(r) }));
  const groups = [...new Set(rows.map((r) => r.group))].sort((a, b) => a.localeCompare(b));
  const open = rows.filter((r) => r.flag).length;
  const changedCount = rows.filter((r) => !same(r.value, r.default)).length;
  return (
    <>
      <PageHeader
        title="Settings"
        description={`Every owner decision and threshold lives here: ${rows.length} settings, ${changedCount} changed from the default, ${open} flagged OWNER DECISION or ATTORNEY REVIEW. Changes are audit-logged.`}
        actions={<Link href="/admin/settings/checks" className="text-sm font-medium text-brand-700">Checks &amp; connections (email, texts, Google) →</Link>}
      />
      <div className="space-y-6">
        <Switches rows={all} />
        <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
          <nav aria-label="Setting groups" className="hidden lg:block">
            <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-1">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Groups</div>
              <ul className="space-y-0.5 text-sm">
                {groups.map((g) => (
                  <li key={g} data-index-group={`g-${slug(g)}`}>
                    <a href={`#g-${slug(g)}`} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-slate-700 hover:bg-white hover:text-brand-700">
                      <span className="truncate">{g}</span>
                      <span className="ml-2 text-xs text-slate-400">{rows.filter((r) => r.group === g).length}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
          <div className="min-w-0 space-y-3">
            <SettingsFilter total={rows.length} />
            <details className="rounded-xl border border-slate-200 bg-white lg:hidden">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-700">Jump to a group</summary>
              <ul className="grid grid-cols-1 gap-0.5 px-2 pb-2 text-sm sm:grid-cols-2">
                {groups.map((g) => (
                  <li key={g} data-index-group={`g-${slug(g)}`}><a href={`#g-${slug(g)}`} className="block rounded-lg px-2 py-1.5 text-slate-700 hover:bg-slate-50">{g}</a></li>
                ))}
              </ul>
            </details>
            {groups.map((g) => {
              const inGroup = rows.filter((r) => r.group === g);
              return (
                <details key={g} id={`g-${slug(g)}`} data-group className="group scroll-mt-36 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                    <span className="flex-1 font-semibold text-slate-900">{g}</span>
                    <span data-count data-total={inGroup.length} className="text-xs text-slate-500">{inGroup.length}</span>
                    <ChevronDown className="size-4 text-slate-400 transition group-open:rotate-180" />
                  </summary>
                  <div className="divide-y divide-slate-100 border-t border-slate-100">
              {inGroup.map((r) => {
                const complex = typeof r.value === "object";
                const unit = unitFor(r.key);
                const changed = !same(r.value, r.default);
                return (
                  <div key={r.key} id={`s-${r.key}`} data-setting data-changed={changed ? "1" : "0"} data-flag={r.flag ? "1" : "0"} data-text={`${r.label} ${r.key} ${r.help ?? ""} ${g}`.toLowerCase()} className="scroll-mt-36 target:bg-accent-50"><ActionForm action={settingAction} className="grid gap-2 px-5 py-3 sm:grid-cols-[1fr_320px_auto] sm:items-center">
                    <input type="hidden" name="key" value={r.key} />
                    <div>
                      <div className="text-sm font-medium">{r.label} {r.flag ? <Badge tone={r.flag === "ATTORNEY_REVIEW" ? "red" : "amber"}>{r.flag === "ATTORNEY_REVIEW" ? "Attorney review" : "Owner decision"}</Badge> : null} {changed ? <Badge tone="blue">Changed</Badge> : null}</div>
                      <div className="font-mono text-xs text-slate-400">{r.key}</div>
                      {r.help ? <div className="text-xs text-slate-500">{r.help}</div> : null}
                    </div>
                    {complex ? (
                      <Textarea name="value" defaultValue={JSON.stringify(r.value, null, 1)} className="min-h-20 font-mono text-xs" />
                    ) : typeof r.value === "boolean" ? (
                      <Select name="value" defaultValue={String(r.value)}>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </Select>
                    ) : unit.money ? (
                      <div className="flex items-center gap-2">
                        <input type="hidden" name="unit" value="cents" />
                        <span className="text-sm text-slate-500">$</span>
                        <Input name="value" type="number" step="0.01" min={0} defaultValue={(Number(r.value) / 100).toFixed(2)} className="text-right" />
                        {unit.suffix ? <span className="shrink-0 text-sm text-slate-500">{unit.suffix}</span> : null}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Input name="value" defaultValue={String(r.value)} className={unit.suffix ? "text-right" : "font-mono"} />
                        {unit.suffix ? <span className="shrink-0 text-sm text-slate-500">{unit.suffix}</span> : null}
                      </div>
                    )}
                    <SubmitButton size="sm" variant="outline">Save</SubmitButton>
                  </ActionForm>
                  {changed ? (
                    <ActionForm action={settingAction} className="-mt-2 px-5 pb-3">
                      <input type="hidden" name="key" value={r.key} />
                      <input type="hidden" name="value" value={JSON.stringify(r.default)} />
                      <SubmitButton size="sm" variant="ghost" className="h-7 px-2 text-xs text-slate-500">Reset to default ({defaultText(r.default, unit.money)})</SubmitButton>
                    </ActionForm>
                  ) : null}</div>
                );
              })}
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

/** The default, short enough for a button: money in dollars, lists and objects summarised. */
function defaultText(v: unknown, money: boolean): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return money ? `$${(v / 100).toFixed(2)}` : String(v);
  if (typeof v === "string") return v.length > 30 ? `${v.slice(0, 28)}…` : v || "blank";
  const t = JSON.stringify(v);
  return t.length > 30 ? `${t.slice(0, 28)}…` : t;
}

/** How a setting's number is shown: money in dollars (stored as cents), with a unit after it. */
function unitFor(key: string): { money: boolean; suffix: string | null } {
  if (/Cents/.test(key)) return { money: true, suffix: /PerMile/.test(key) ? "per mile" : /PerHour/.test(key) ? "per hour" : null };
  if (/Percent$/.test(key)) return { money: false, suffix: "%" };
  if (/Hours$/.test(key)) return { money: false, suffix: "hours" };
  if (/(Minutes|Min)$/.test(key)) return { money: false, suffix: "min" };
  if (/Days$/.test(key)) return { money: false, suffix: "days" };
  if (/Months$/.test(key)) return { money: false, suffix: "months" };
  return { money: false, suffix: null };
}
