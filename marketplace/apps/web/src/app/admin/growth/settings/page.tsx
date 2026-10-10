import Link from "next/link";
import { growth } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";
import { outreachModeAction } from "../actions";
import { GrowthTabs } from "../ui";

export const metadata = { title: "Growth settings" };
export const dynamic = "force-dynamic";

const LINKS: [string, string, string][] = [
  ["/admin/growth/expansion", "Expansion", "Which profession × state markets the bots work: Off / Prelaunch / Live, cities, registry search per profession."],
  ["/admin/growth/prompts", "Prompts", "Every email the agents send, versioned, per profession. Approve and activate here."],
  ["/admin/growth/knowledge", "Knowledge base", "Approved answers the conversation agent and website chat may use."],
  ["/admin/growth/suppression", "Suppression", "Unsubscribes, bounces and do-not-contact: honored by every sender."],
  ["/admin/schools", "Schools", "The student sign-up dropdown, per profession."],
  ["/admin/settings#s-growth.acquisitionPriorities", "Acquisition priorities", "Which side each country, state or province recruits first (Florida: clinics; everywhere else: providers), the primary side's share, and whether agents follow imbalance recommendations. Per-market overrides: Supply & Demand."],
  ["/admin/growth/prospects/apollo", "Apollo.io", "Connection test, credit caps and usage, automatic discovery and email enrichment, search and import."],
  ["/admin/settings#s-growth.canadaOutreach", "Canada outreach (CASL)", "Off by default. Canadian prospects also need a consent basis recorded on their page before any commercial email."],
  ["/admin/settings", "All Growth settings", "Cadences, caps, budgets, AI providers and models, research budget, postal address."],
];

export default async function GrowthSettings() {
  await requireActor("admin");
  const s = await growth.overviewSettings();
  const modes: ["clinic" | "provider", string, string][] = [["provider", "Provider recruitment outreach", s.providerOutreachMode], ["clinic", "Clinic outreach", s.outreachMode]];
  return (
    <>
      <PageHeader title="Settings" description="Configuration for the growth agents. Changes apply on the agents' next run." />
      <GrowthTabs current="/admin/growth/settings" />
      <Card className="mb-6">
        <CardHeader title="Outreach mode" description="Review: each first-contact email is drafted and waits in Approvals. Auto: it sends once compliance passes (suppression, caps, postal address, quiet hours)." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          {modes.map(([which, label, mode]) => (
            <ActionForm key={which} action={outreachModeAction} successMessage={false} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3" confirm={mode === "review" ? `Switch ${label.toLowerCase()} to AUTO? Emails will send without a person approving each one.` : undefined}>
              <input type="hidden" name="which" value={which} />
              <input type="hidden" name="mode" value={mode === "auto" ? "review" : "auto"} />
              <div><div className="text-sm font-medium">{label}</div><div className="text-xs text-slate-500">Now: <b>{mode}</b></div></div>
              <SubmitButton size="sm" variant="outline">{mode === "auto" ? "Switch to review" : "Switch to auto"}</SubmitButton>
            </ActionForm>
          ))}
        </CardBody>
      </Card>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {LINKS.map(([href, title, help]) => (
          <Link key={href} href={href} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card hover:border-brand-300">
            <div className="font-semibold text-slate-900">{title}</div>
            <div className="mt-1 text-sm text-slate-500">{help}</div>
          </Link>
        ))}
      </div>
    </>
  );
}
