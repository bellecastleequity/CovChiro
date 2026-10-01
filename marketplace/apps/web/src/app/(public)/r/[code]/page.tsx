import Link from "next/link";
import { notFound } from "next/navigation";
import { brand } from "@cm/config";
import { dollars } from "@cm/core";
import { getSettings, referrals } from "@cm/services";
import { buttonClass } from "@/components/ui/button";
import { RememberRef } from "@/components/referrals/remember-ref";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const inv = await referrals.invitation((await params).code);
  const b = brand();
  return { title: inv ? `${inv.from} invited you to ${b.name}` : b.name, robots: { index: false } };
}

export default async function Invite({ params }: { params: Promise<{ code: string }> }) {
  const inv = await referrals.invitation((await params).code);
  if (!inv) notFound();
  const b = brand();
  const studentsOn = (await getSettings())["features.preLicensureEnabled"];
  const bonus = dollars(inv.friendRewardCents);
  const q = `ref=${encodeURIComponent(inv.code)}`;
  return (
    <section className="mx-auto max-w-2xl px-4 py-14 sm:py-20">
      <RememberRef code={inv.code} />
      <p className="text-sm font-semibold uppercase tracking-wide text-accent-700">You&apos;re invited</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">{inv.from} invited you to {b.name}</h1>
      <p className="mt-4 text-lg text-slate-600">
        {b.name} connects licensed providers with clinics that need coverage. Create your free profile now so you&apos;re ready when the need arises, and get in on the ground floor while we&apos;re growing.
      </p>
      <div className="mt-6 rounded-2xl border border-accent-200 bg-accent-50 p-5 text-slate-800">
        <p className="font-semibold">Your {bonus} welcome bonus</p>
        <p className="mt-1 text-sm">
          After your first completed shift you get {bonus} (providers: with your pay; clinics: off your next shift), and {inv.from} gets a thank-you too. Then share your own link: you earn {dollars(inv.referrerRewardCents)} for every colleague you bring.
        </p>
      </div>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <Link href={`/signup?role=provider&${q}`} className={buttonClass("primary", "lg")}>I&apos;m a licensed provider</Link>
        <Link href={`/signup?role=clinic&${q}`} className={buttonClass("outline", "lg")}>I run a clinic</Link>
        {studentsOn ? <Link href={`/signup?role=provider&student=1&${q}`} className={buttonClass("outline", "lg", "sm:col-span-2")}>I&apos;m a student or new grad</Link> : null}
      </div>
      <p className="mt-6 text-xs text-slate-500">Free to join. <Link href="/how-it-works" className="underline">How it works</Link> · <Link href="/referral-terms" className="underline">Referral terms</Link></p>
    </section>
  );
}
