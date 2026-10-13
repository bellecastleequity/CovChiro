import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { brand } from "@cm/config";
import { prisma } from "@cm/db";
import { absoluteUrl, refreshProviderStripe } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, PageHeader } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";
import { stripeAction, taxEntityAction } from "../actions";

export const metadata = { title: "Payout setup" };

const TAX: Record<string, { tone: "green" | "amber" | "red" | "gray"; label: string }> = {
  COMPLETE: { tone: "green", label: "Complete" },
  LAST4: { tone: "amber", label: "One step left" },
  MISSING: { tone: "amber", label: "One step left" },
  UNKNOWN: { tone: "gray", label: "Being checked" },
};

export default async function Payouts({ searchParams }: { searchParams: Promise<{ stripe?: string }> }) {
  const { actor } = await requireActor("provider");
  if ((await searchParams).stripe) await refreshProviderStripe(actor.providerId!).catch(() => null);
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: actor.providerId! } });
  const site = absoluteUrl("/").replace(/^https?:\/\//, "").replace(/\/$/, "");
  return (
    <>
      <PageHeader title="Payout setup" description="We pay you through Stripe, a secure payments company. Your bank details go to Stripe, not to us, and Stripe sends your year-end tax form." />
      <Card className="mb-6 max-w-xl">
        <CardHeader title="Who gets paid" description="Choose before you start the Stripe steps." />
        <CardBody>
          {p.stripePayoutsEnabled ? (
            <div className="space-y-2 text-sm">
              <div>Paid as: <b>{p.taxEntity === "COMPANY" ? "my company" : "myself"}</b></div>
              <div className="flex items-center gap-2">Year-end tax form: <Badge tone={TAX[p.taxInfoStatus]?.tone ?? "gray"}>{TAX[p.taxInfoStatus]?.label ?? p.taxInfoStatus}</Badge></div>
              {p.taxInfoStatus === "LAST4" || p.taxInfoStatus === "MISSING" ? <p className="text-amber-800">Stripe needs one more detail to send your 1099. Open the Stripe dashboard below and finish the last step.</p> : null}
              <p className="text-xs text-slate-500">Need to switch between yourself and your company? Contact support: the 1099 follows the Stripe account.</p>
            </div>
          ) : (
            <ActionForm action={taxEntityAction} className="space-y-2 text-sm">
              <label className="flex items-start gap-2"><input type="radio" name="taxEntity" value="INDIVIDUAL" defaultChecked={p.taxEntity !== "COMPANY"} className="mt-1" /><span><b>Myself</b>, as an individual or sole proprietor. Most providers.</span></label>
              <label className="flex items-start gap-2"><input type="radio" name="taxEntity" value="COMPANY" defaultChecked={p.taxEntity === "COMPANY"} className="mt-1" /><span><b>My company</b>, such as an LLC, PA or PC. Stripe asks for the company&apos;s details.</span></label>
              <SubmitButton size="sm" variant="outline">Save</SubmitButton>
            </ActionForm>
          )}
        </CardBody>
      </Card>
      <Card className="max-w-xl">
        <CardBody className="space-y-4">
          {p.stripePayoutsEnabled ? (
            <Alert tone="success" title="Payouts are on">Payments for completed shifts go straight to your bank.</Alert>
          ) : p.stripeAccountId ? (
            <Alert tone="warning" title="Almost there">Finish the Stripe steps to turn on payouts.</Alert>
          ) : null}
          <ul className="space-y-2 text-sm text-slate-600">
            {["Takes about 5 minutes", "Paid about 48 hours after each completed shift", "Mileage and lodging allowances included", "Your 1099 comes from Stripe in January"].map((t) => (
              <li key={t} className="flex gap-2"><CheckCircle2 className="size-4 text-accent-600" />{t}</li>
            ))}
          </ul>
          <ActionForm action={stripeAction} successMessage={false}>
            <SubmitButton size="lg">{p.stripePayoutsEnabled ? "Open Stripe dashboard" : p.stripeAccountId ? "Continue Stripe setup" : "Set up payouts with Stripe"}</SubmitButton>
          </ActionForm>
          {!p.stripePayoutsEnabled ? (
            <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
              <div className="font-medium text-slate-800">Before you start</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                <li>Have your {p.taxEntity === "COMPANY" ? "company's legal name, address and bank details" : "bank details"} ready. Stripe asks the standard questions for a 1099, the same as any contract work.</li>
                <li>Business type: <b>{p.taxEntity === "COMPANY" ? "Company" : "Individual / sole proprietorship"}</b> (change it above if that&apos;s wrong).</li>
                <li>If asked for a website or description: <b>{site}</b> or &ldquo;Independent contractor providing clinic coverage shifts through {brand().name}.&rdquo;</li>
              </ul>
              <Link href="/provider/help/payouts-setup" className="mt-2 inline-block font-medium text-brand-700 hover:underline">Step-by-step guide →</Link>
            </div>
          ) : (
            <Link href="/provider/help/payouts-setup" className="inline-block text-sm text-brand-700 hover:underline">Payout setup guide</Link>
          )}
        </CardBody>
      </Card>
    </>
  );
}
