import { CheckCircle2 } from "lucide-react";
import { prisma } from "@cm/db";
import { refreshProviderStripe } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody } from "@/components/ui/card";
import { Alert, PageHeader } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";
import { stripeAction } from "../actions";

export const metadata = { title: "Payout setup" };

export default async function Payouts({ searchParams }: { searchParams: Promise<{ stripe?: string }> }) {
  const { actor } = await requireActor("provider");
  if ((await searchParams).stripe) await refreshProviderStripe(actor.providerId!).catch(() => null);
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: actor.providerId! } });
  return (
    <>
      <PageHeader title="Payout setup" description="We pay you through Stripe Connect. Stripe securely collects your bank details and tax information (W-9) and issues your 1099 — we never see your account numbers." />
      <Card className="max-w-xl">
        <CardBody className="space-y-4">
          {p.stripePayoutsEnabled ? (
            <Alert tone="success" title="Payouts are on">Payments for completed shifts go straight to your bank.</Alert>
          ) : p.stripeAccountId ? (
            <Alert tone="warning" title="Almost there">Finish the Stripe steps to turn on payouts.</Alert>
          ) : null}
          <ul className="space-y-2 text-sm text-slate-600">
            {["Takes about 5 minutes", "Paid about 48 hours after each completed shift", "Mileage and lodging reimbursements included"].map((t) => (
              <li key={t} className="flex gap-2"><CheckCircle2 className="size-4 text-brand-600" />{t}</li>
            ))}
          </ul>
          <ActionForm action={stripeAction} successMessage={false}>
            <SubmitButton size="lg">{p.stripePayoutsEnabled ? "Open Stripe dashboard" : p.stripeAccountId ? "Continue Stripe setup" : "Set up payouts with Stripe"}</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
