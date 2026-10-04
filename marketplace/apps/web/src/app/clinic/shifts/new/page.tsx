import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { prisma } from "@cm/db";
import { agreementCurrent, getSettings, postingOptions } from "@cm/services";
import { LinkButton } from "@/components/ui/button";
import { Empty, PageHeader } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";
import { PostShiftWizard, type DraftInit } from "./wizard";

export const metadata = { title: "Post a shift" };

async function loadDraft(clinicOrgId: string, id: string): Promise<DraftInit> {
  const sh = await prisma.shift.findFirst({ where: { id, status: "DRAFT", location: { clinicOrgId } }, include: { location: true } });
  if (!sh) notFound();
  const z = sh.location.timeZone;
  const s = DateTime.fromJSDate(sh.startsAt, { zone: z });
  const e = DateTime.fromJSDate(sh.endsAt, { zone: z });
  const att = sh.supervisionAttestation as DraftInit["sup"];
  return {
    id: sh.id,
    inGroup: !!sh.shiftGroupId,
    locationId: sh.locationId,
    professionCode: sh.professionCode,
    date: s.toISODate()!,
    start: s.toFormat("HH:mm"),
    end: e.toFormat("HH:mm"),
    lunch: String(sh.lunchMinutes),
    lunchStart: sh.lunchStartsAt ? DateTime.fromJSDate(sh.lunchStartsAt, { zone: z }).toFormat("HH:mm") : "12:00",
    requiredSkillIds: sh.requiredSkillIds,
    preferredSkillIds: sh.preferredSkillIds,
    expectedPatients: sh.expectedPatients == null ? "" : String(sh.expectedPatients),
    minYears: String(sh.minYearsExperience ?? 0),
    notes: sh.notes ?? "",
    instantBook: sh.instantBook,
    lodgingAllowed: sh.lodgingAllowed,
    lodgingCap: sh.lodgingCapCentsPerNight ? String(sh.lodgingCapCentsPerNight / 100) : "",
    maxTravelBudget: sh.maxTravelBudgetCents ? String(sh.maxTravelBudgetCents / 100) : "",
    sup: att && typeof att === "object" ? att : null,
  };
}

export default async function NewShift({ searchParams }: { searchParams: Promise<{ code?: string; draft?: string }> }) {
  const { actor } = await requireActor("clinic");
  const { code, draft: draftId } = await searchParams;
  const draft = draftId ? await loadDraft(actor.clinicOrgId!, draftId) : undefined;
  const org = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: actor.clinicOrgId! } });
  const locations = await prisma.clinicLocation.findMany({ where: { clinicOrgId: actor.clinicOrgId!, active: true }, orderBy: { createdAt: "asc" } });
  if (!locations.length) {
    return (
      <>
        <PageHeader title="Post a shift" />
        <Empty title="Add a location first" action={<LinkButton href="/clinic/locations">Add location</LinkButton>}>We need your clinic's address to find licensed providers in your state.</Empty>
      </>
    );
  }
  const settings = await getSettings();
  const volumeCodes = (await prisma.profession.findMany({ where: { volumePricingEnabled: true }, select: { code: true } })).map((p) => p.code);
  const options = await Promise.all(locations.map((l) => postingOptions(actor, l.id)));
  const redemptions = await prisma.promoRedemption.count({ where: { clinicOrgId: org.id, voidedAt: null } });
  const welcome = redemptions === 0 ? await prisma.promoCode.findFirst({ where: { assignedEmail: org.billingEmail ?? "", active: true, usedCount: 0, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, orderBy: { createdAt: "desc" } }) : null;
  return (
    <>
      <PageHeader title={draft ? "Edit draft shift" : "Post a shift"} description={draft ? "Change anything, then save the draft or post it. Prices are recalculated from our regional rate card." : "Prices come from our regional rate card and how busy the day is. You'll see the total, and what closing would cost instead, before posting."} />
      <PostShiftWizard
        canPost={org.status === "ACTIVE" && org.hasPaymentMethod && agreementCurrent("CLINIC", org.agreementSignedAt, org.agreementVersion)}
        defaultMinYears={org.minYearsExperience}
        mileage={{ rateLabel: `$${(settings["pricing.mileageRateCentsPerMile"] / 100).toFixed(2)}`, roundTrip: settings["pricing.mileageRoundTrip"] }}
        defaultCode={code ?? welcome?.code ?? ""}
        draft={draft}
        volumeCodes={volumeCodes}
        lodging={{ nightlyCents: settings["pricing.lodgingNightlyCents"], overMinutes: settings["pricing.lodgingTriggerMinutes"], maxMinutes: settings["pricing.lodgingMaxDriveMinutes"] }}
        maxDayMinutes={settings["pricing.maxDaySpanMinutes"]}
        locations={options.map((o) => ({
          id: o.location.id,
          name: o.location.name,
          city: o.location.city,
          state: o.location.state,
          timeZone: o.location.timeZone,
          professions: o.professions,
        }))}
      />
    </>
  );
}
