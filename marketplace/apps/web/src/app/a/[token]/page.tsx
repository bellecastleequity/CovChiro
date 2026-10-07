import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, PauseCircle } from "lucide-react";
import { brand } from "@cm/config";
import { prisma } from "@cm/db";
import { activity } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Logo } from "@/components/site/header";
import { activeLinkAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stay active", robots: { index: false } };

/** One-tap page from the active-status reminder and pause emails/texts. The signed link covers this one provider. */
export default async function ActiveLink({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const id = activity.providerIdFromActiveToken(token);
  if (!id) notFound();
  const p = await prisma.provider.findUnique({ where: { id }, select: { displayName: true, breakReason: true, breakStartsAt: true } });
  if (!p) notFound();
  const paused = p.breakReason === "INACTIVE" && !!p.breakStartsAt;
  const chosenBreak = !paused && !!p.breakStartsAt;
  return (
    <div className="min-h-dvh bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-md">
        <Logo name={brand().name} />
        <div className="mt-5 rounded-3xl bg-white p-5 shadow-card">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-700">
            {paused ? <PauseCircle className="size-4" /> : <CheckCircle2 className="size-4" />}
            {paused ? "Profile paused" : "Active status"}
          </div>
          <h1 className="mt-1 text-2xl font-semibold">Hi {p.displayName.split(" ")[0]}</h1>
          {chosenBreak ? (
            <p className="mt-3 text-sm text-slate-700">You&apos;re on a break you set up yourself. To come back, sign in and choose <b>Resume coverage</b> on your dashboard.</p>
          ) : (
            <>
              <p className="mt-3 text-sm text-slate-700">
                {paused
                  ? "Your profile is paused because we hadn't seen a shift, application or check-in from you in a while. Tap below and you'll be matched to coverage shifts again right away."
                  : "Tap below to confirm you're still taking coverage shifts. We'll keep sending you offers that fit your hours."}
              </p>
              <ActionForm action={activeLinkAction} className="mt-5" successMessage>
                <input type="hidden" name="token" value={token} />
                <SubmitButton size="lg" className="w-full">{paused ? "I'm active again" : "I'm still available"}</SubmitButton>
              </ActionForm>
            </>
          )}
          <p className="mt-5 text-center text-xs text-slate-500">
            Not taking shifts for a while? <Link href="/provider/break" className="font-medium text-brand-700">Sign in to set up a break</Link> instead.
          </p>
        </div>
      </div>
    </div>
  );
}
