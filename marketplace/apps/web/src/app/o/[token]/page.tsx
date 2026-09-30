import { notFound } from "next/navigation";
import { Car, Clock, MapPin, Star } from "lucide-react";
import { brand } from "@cm/config";
import { prisma } from "@cm/db";
import { dispatch, getSettings } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Countdown } from "@/components/countdown";
import { Logo } from "@/components/site/header";
import { money } from "@/lib/format";
import { tokenRespondAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shift offer", robots: { index: false } };

/** Mobile offer page from the SMS/email link (Addendum 02 §8.2). No street address until confirmed. */
export default async function OfferLink({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const offer = await dispatch.offerByToken(token);
  if (!offer) notFound();
  const s = await getSettings();
  const zone = offer.provider.homeTimeZone;
  const sh = offer.shift;
  const a = offer.status === "ACCEPTED" ? await prisma.assignment.findFirst({ where: { shiftId: sh.id, providerId: offer.providerId } }) : null;
  const mileage = a?.mileageCents ?? null;
  const prof = await prisma.profession.findUnique({ where: { code: sh.professionCode } });
  const rating = await prisma.rating.aggregate({ where: { raterType: "PROVIDER", revealedAt: { not: null }, assignment: { shift: { location: { clinicOrgId: sh.location.clinicOrgId } } } }, _avg: { stars: true } });
  const t = (d: Date) => d.toLocaleTimeString("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" });
  const active = offer.dispatch?.status === "ACTIVE";
  const revivable = active && offer.status === "EXPIRED";
  const open = active && (offer.status === "PENDING" || revivable);
  return (
    <div className="min-h-dvh bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-md">
        <Logo name={brand().name} />
        <div className="mt-5 rounded-3xl bg-white p-5 shadow-card">
          <div className="text-xs font-semibold uppercase tracking-wider text-brand-700">{prof?.displayName} coverage</div>
          <h1 className="mt-1 text-2xl font-semibold">{sh.startsAt.toLocaleDateString("en-US", { timeZone: zone, weekday: "long", month: "short", day: "numeric" })}</h1>
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            <div className="flex items-center gap-2"><Clock className="size-4 text-slate-400" />{t(sh.startsAt)} – {t(sh.endsAt)}</div>
            <div className="flex items-center gap-2"><MapPin className="size-4 text-slate-400" />{sh.location.city}, {sh.state}</div>
            {rating._avg.stars ? <div className="flex items-center gap-2"><Star className="size-4 text-amber-500" />Clinic rated {rating._avg.stars.toFixed(1)}</div> : null}
            <div className="flex items-center gap-2"><Car className="size-4 text-slate-400" />Mileage paid at {money(s["pricing.mileageRateCentsPerMile"], { exact: true })}/mile</div>
          </div>
          <div className="mt-4 rounded-2xl bg-brand-50 p-4">
            <div className="text-sm text-brand-800">Your pay</div>
            <div className="text-3xl font-semibold text-brand-800">{money(sh.providerPayCents)}{mileage ? ` + ${money(mileage)}` : " + mileage"}</div>
          </div>
          {open ? (
            <>
              <div className="mt-4 text-center text-sm font-medium text-amber-700">
                {revivable ? "This offer's window passed, but the shift is still open — accept now to be considered." : <Countdown to={offer.expiresAt.toISOString()} />}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <ActionForm action={tokenRespondAction} successMessage>
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="decision" value="decline" />
                  <SubmitButton variant="outline" size="lg" className="w-full">Decline</SubmitButton>
                </ActionForm>
                <ActionForm action={tokenRespondAction} successMessage>
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="decision" value="accept" />
                  <SubmitButton size="lg" className="w-full">Accept</SubmitButton>
                </ActionForm>
              </div>
              <p className="mt-3 text-center text-xs text-slate-500">Can't make it? Tap Decline — it helps us find coverage faster and never hurts your standing. The best-matched provider who accepts gets the shift.</p>
            </>
          ) : (
            <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-center text-sm text-slate-700">
              {offer.status === "ACCEPTED" ? "You're confirmed. Sign in to see the address and arrival notes." : offer.status === "ACCEPTED_PENDING" ? <>You're next in line. <Countdown to={(offer.wave?.holdEndsAt ?? offer.wave?.windowEndsAt ?? offer.expiresAt).toISOString()} prefix="You'll know in" /></> : offer.status === "DECLINED" ? "You declined this shift." : "This shift has been filled. Thanks — you'll hear about the next one."}
            </div>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-slate-400">No patient information is ever shared through {brand().name}.</p>
      </div>
    </div>
  );
}
