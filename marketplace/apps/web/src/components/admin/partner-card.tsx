import Link from "next/link";
import { prisma } from "@cm/db";
import { partnerTermAt } from "@cm/core";
import { getSettings, partners } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { dateLabel, money } from "@/lib/format";
import { endPartnershipAction, offerPartnershipAction, withdrawPartnerOfferAction } from "@/app/admin/actions";

const YMD: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };

/** Admin → clinic: the partner clinic program for this clinic (offer, withdraw, end, discounts given). */
export async function AdminPartnerCard({ clinicOrgId }: { clinicOrgId: string }) {
  const s = await getSettings();
  const rows = await prisma.clinicPartnership.findMany({ where: { clinicOrgId }, orderBy: { offeredAt: "desc" }, take: 5 });
  const now = new Date();
  const current = rows.find((p) => partnerTermAt(p, now)) ?? null;
  const offer = rows.find((p) => p.status === "OFFERED") ?? null;
  const term = current ? partnerTermAt(current, now)! : null;
  const [termSaved, allSaved] = current ? await Promise.all([partners.discountsGiven(current.id, term!.termStart), partners.discountsGiven(current.id)]) : [null, null];
  const hidden = <input type="hidden" name="clinicOrgId" value={clinicOrgId} />;
  return (
    <Card>
      <CardHeader
        title="Partner clinic"
        description={
          !s["features.partnerProgram"]
            ? "The partner clinic program is off (Settings → Features)."
            : current
              ? `${current.discountPercent}% off · term ${term!.termNumber} started ${dateLabel(term!.termStart, undefined, YMD)} (rates locked to that day)${current.status === "ENDED" ? ` · ends ${dateLabel(current.endedAt!, undefined, YMD)}` : ` · renews ${dateLabel(term!.termEnd, undefined, YMD)}`}`
              : offer
                ? `Offered ${dateLabel(offer.offeredAt, undefined, YMD)}: ${offer.discountPercent}% off, ${offer.termMonths}-month terms. Waiting for the owner to sign.`
                : `Not a partner. An offer uses today's settings: ${s["partner.discountPercent"]}% off, ${s["partner.termMonths"]}-month terms.`
        }
      />
      <CardBody className="space-y-3 text-sm">
        {current ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">Discounts this term</div><div className="font-semibold">{money(termSaved!.cents)} · {termSaved!.bookings} booking{termSaved!.bookings === 1 ? "" : "s"}</div></div>
              <div className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-xs text-slate-500">All time</div><div className="font-semibold">{money(allSaved!.cents)} · {allSaved!.bookings} booking{allSaved!.bookings === 1 ? "" : "s"}</div></div>
            </div>
            <p className="text-xs text-slate-500">If the clinic breaches exclusivity, the addendum has them repay this term&apos;s discounts ({money(termSaved!.cents)}). <Link className="text-brand-700" href={`/agreements/partner/${current.id}`}>Signed addendum</Link></p>
            {current.status === "ACTIVE" ? (
              <ActionForm action={endPartnershipAction} className="flex flex-wrap items-center gap-2" confirm="End this partnership?">
                {hidden}
                <input type="hidden" name="id" value={current.id} />
                <Select name="when" defaultValue="term_end" className="h-9 w-auto"><option value="term_end">At term end ({dateLabel(term!.termEnd, undefined, YMD)})</option><option value="now">Now</option></Select>
                <Input name="reason" required minLength={3} placeholder="Reason" className="h-9 min-w-0 flex-1 sm:max-w-xs" />
                <SubmitButton size="sm" variant="outline">End partnership</SubmitButton>
              </ActionForm>
            ) : null}
          </>
        ) : offer ? (
          <ActionForm action={withdrawPartnerOfferAction}>{hidden}<input type="hidden" name="id" value={offer.id} /><SubmitButton size="sm" variant="outline">Withdraw offer</SubmitButton></ActionForm>
        ) : s["features.partnerProgram"] ? (
          <ActionForm action={offerPartnershipAction} confirm="Send this clinic a partner offer?">{hidden}<SubmitButton size="sm">Offer partnership</SubmitButton></ActionForm>
        ) : null}
        <p className="text-xs text-slate-500"><Link className="text-brand-700" href="/admin/partners">All partner clinics →</Link></p>
      </CardBody>
    </Card>
  );
}
