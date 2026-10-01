"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { prisma } from "@cm/db";
import {
  hiring,
  standing,
  dispatch,
  bookings,
  emergency,
  feedback,
  archiveLocation, auth, cancelShiftByClinic, clinicPaymentSetupUrl, createShift, inviteProviders, inviteStaff, messaging, openDispute, postShift, quoteForClinic, updateDraftShift,
  addLocationPhotos, removeLocationPhoto, setExperiencePreference, requestAgreement, saveLocation, upcomingWith, selectApplicant, setBlock, setFavorite, submitRating, updateOrg,
} from "@cm/services";
import { bool, formAction, optStr, str } from "@/lib/action";
import { requireActor } from "@/lib/session";
import { saveUpload } from "@/lib/upload";

const me = () => requireActor("clinic");

/** Wizard payload arrives as JSON; times are local to the location and converted to UTC here. */
/** Every day in the wizard's payload (one for a single shift). */
async function shiftPayloads(fd: FormData) {
  const raw = JSON.parse(str(fd, "payload") || "{}");
  const days: { date: string; start: string; end: string }[] = Array.isArray(raw.days) && raw.days.length ? raw.days : [{ date: raw.date, start: raw.start, end: raw.end }];
  return Promise.all(days.map((d) => shiftPayloadFrom({ ...raw, ...d })));
}

async function shiftPayload(fd: FormData) {
  return shiftPayloadFrom(JSON.parse(str(fd, "payload") || "{}"));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function shiftPayloadFrom(raw: any) {
  const loc = await prisma.clinicLocation.findUnique({ where: { id: String(raw.locationId ?? "") }, select: { timeZone: true } });
  const zone = loc?.timeZone ?? "America/New_York";
  const start = DateTime.fromISO(`${raw.date}T${raw.start}`, { zone });
  let end = DateTime.fromISO(`${raw.date}T${raw.end}`, { zone });
  if (end <= start) end = end.plus({ days: 1 });
  return {
    locationId: raw.locationId,
    professionCode: raw.professionCode,
    startsAt: start.isValid ? start.toJSDate() : new Date(NaN),
    endsAt: end.isValid ? end.toJSDate() : new Date(NaN),
    requiredSkillIds: raw.requiredSkillIds ?? [],
    preferredSkillIds: raw.preferredSkillIds ?? [],
    expectedPatients: raw.expectedPatients || null,
    minYearsExperience: raw.minYearsExperience === undefined ? undefined : Number(raw.minYearsExperience) || 0,
    notes: raw.notes || null,
    instantBook: !!raw.instantBook,
    maxTravelBudgetCents: raw.maxTravelBudget ? Math.round(Number(raw.maxTravelBudget) * 100) : null,
    lodgingAllowed: !!raw.lodgingAllowed,
    lodgingCapCentsPerNight: raw.lodgingCap ? Math.round(Number(raw.lodgingCap) * 100) : null,
    promoCode: raw.promoCode || null,
    supervisionAttestation: raw.supervisionAttestation ?? null,
  };
}

export const quoteAction = formAction(async (fd) => {
  const { actor } = await me();
  const inputs = await shiftPayloads(fd);
  const quotes = [];
  // Promo code: first day only (same rule as posting).
  for (const [i, input] of inputs.entries()) quotes.push(await quoteForClinic(actor, { ...input, promoCode: i === 0 ? input.promoCode : null }));
  const raw = JSON.parse(str(fd, "payload") || "{}");
  const dates: string[] = Array.isArray(raw.days) && raw.days.length ? raw.days.map((d: { date: string }) => d.date) : [raw.date];
  return {
    ok: "quote",
    data: {
      ...quotes[0],
      days: quotes.map((q, i) => ({ date: dates[i], subtotalCents: q.subtotalCents, premiums: q.premiums })),
      totalCents: quotes.reduce((t, q) => t + q.subtotalCents, 0),
    },
  };
});

export const createShiftAction = formAction(async (fd) => {
  const { actor } = await me();
  const post = str(fd, "mode") !== "draft";
  const inputs = await shiftPayloads(fd);
  const { shiftIds } = await bookings.createMultiDay(actor, inputs, { post });
  revalidatePath("/clinic", "layout");
  redirect(`/clinic/shifts/${shiftIds[0]}?${post ? "posted" : "saved"}=1`);
});

export const updateDraftAction = formAction(async (fd) => {
  const { actor } = await me();
  const post = str(fd, "mode") !== "draft";
  const shiftId = str(fd, "shiftId");
  const [input] = await shiftPayloads(fd);
  await updateDraftShift(actor, shiftId, input, { post });
  revalidatePath("/clinic", "layout");
  redirect(`/clinic/shifts/${shiftId}?${post ? "posted" : "saved"}=1`);
});

export const postDraftAction = formAction(async (fd) => {
  const { actor } = await me();
  await postShift(actor, str(fd, "shiftId"));
  revalidatePath("/clinic", "layout");
  return "Shift posted. We're notifying matching providers now.";
});

export const selectAction = formAction(async (fd) => {
  const { actor } = await me();
  await selectApplicant(actor, str(fd, "shiftId"), str(fd, "providerId"));
  revalidatePath(`/clinic/shifts/${str(fd, "shiftId")}`);
  return "Confirmed! Your provider has been notified and the deposit charged.";
});

export const confirmAllDaysAction = formAction(async (fd) => {
  const { actor } = await me();
  const r = await bookings.confirmForAllDays(actor, str(fd, "shiftId"), str(fd, "providerId"));
  revalidatePath("/clinic", "layout");
  return `Confirmed for ${r.confirmed} day${r.confirmed === 1 ? "" : "s"}${r.failed ? ` (${r.failed} couldn't be confirmed — see each day)` : ""}. Your provider has been notified.`;
});

export const proposeStandingAction = formAction(async (fd) => {
  const { actor } = await me();
  const [providerId, professionCode] = str(fd, "providerProfession").split("|");
  await standing.proposeStanding(actor, {
    providerId,
    professionCode,
    locationId: str(fd, "locationId"),
    weekdays: fd.getAll("weekdays").map(Number),
    startTime: str(fd, "startTime"),
    endTime: str(fd, "endTime"),
    startsOn: str(fd, "startsOn"),
    endsOn: optStr(fd, "endsOn"),
    notes: optStr(fd, "notes"),
  });
  revalidatePath("/clinic/standing");
  return "Sent. We'll let you know when they accept — then each shift is booked automatically.";
});

export const endStandingAction = formAction(async (fd) => {
  const { actor } = await me();
  const r = await standing.endStanding(actor, str(fd, "standingId"), str(fd, "reason") || "Ended by clinic");
  revalidatePath("/clinic", "layout");
  return r.cancelled ? `Ended. ${r.cancelled} later shift${r.cancelled === 1 ? " was" : "s were"} cancelled at no charge.` : "Done.";
});

export const requestHireAction = formAction(async (fd) => {
  const { actor } = await me();
  await hiring.requestHire(actor, { providerId: str(fd, "providerId"), positionType: str(fd, "positionType"), message: optStr(fd, "message"), callbackPhone: optStr(fd, "callbackPhone"), callbackTimes: optStr(fd, "callbackTimes") });
  revalidatePath(`/clinic/providers/${str(fd, "providerId")}`);
  return "Request sent. Our team will call you shortly.";
});

export const acceptHireAction = formAction(async (fd) => {
  const { actor } = await me();
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  await hiring.acceptHire(actor, str(fd, "hireId"), { name: str(fd, "name"), title: str(fd, "title"), agree: bool(fd, "agree") }, { ip });
  revalidatePath("/clinic", "layout");
  return "Paid — you're all set to hire them directly.";
});

export const inviteAction = formAction(async (fd) => {
  const { actor } = await me();
  const ids = fd.getAll("providerId").map(String);
  await inviteProviders(actor, str(fd, "shiftId"), ids);
  revalidatePath(`/clinic/shifts/${str(fd, "shiftId")}`);
  return `Invitation sent to ${ids.length} provider${ids.length === 1 ? "" : "s"}. First to accept gets the shift.`;
});

export const cancelShiftAction = formAction(async (fd) => {
  const { actor } = await me();
  const out = await cancelShiftByClinic(actor, str(fd, "shiftId"), str(fd, "reason") || "Cancelled by clinic");
  revalidatePath("/clinic", "layout");
  return out && out.refundDepositCents === 0 && out.forfeitedDepositCents > 0 ? "Cancelled. Because it was within the late-cancellation window, the deposit is non-refundable." : "Cancelled.";
});

export const favoriteAction = formAction(async (fd) => {
  const { actor } = await me();
  await setFavorite(actor, str(fd, "providerId"), str(fd, "on") === "1");
  revalidatePath("/clinic", "layout");
  return str(fd, "on") === "1" ? "Added to favorites — they'll get first look at your future shifts." : "Removed from favorites.";
});

export const blockAction = formAction(async (fd) => {
  const { actor } = await me();
  await setBlock(actor, str(fd, "providerId"), true, optStr(fd, "reason") ?? undefined);
  revalidatePath("/clinic", "layout");
  const upcoming = await upcomingWith(actor, str(fd, "providerId"));
  return upcoming.length
    ? `Blocked from future bookings. They're still booked for ${upcoming.length} upcoming shift${upcoming.length === 1 ? "" : "s"} — cancel from that shift's page if you'd like someone else.`
    : "Blocked. This provider won't be offered your shifts again.";
});

export const unblockAction = formAction(async (fd) => {
  const { actor } = await me();
  await setBlock(actor, str(fd, "providerId"), false);
  revalidatePath("/clinic", "layout");
  return "Unblocked.";
});

export const ratingAction = formAction(async (fd) => {
  const { actor } = await me();
  const cats = ["punctuality", "professionalism", "clinicalSkill", "communication", "patientFeedback"];
  await submitRating(actor, str(fd, "assignmentId"), { stars: Number(str(fd, "stars")), categories: Object.fromEntries(cats.map((c) => [c, Number(str(fd, c) || 0)])), comment: optStr(fd, "comment") });
  revalidatePath("/clinic", "layout");
  return "Thanks for your rating.";
});

export const disputeAction = formAction(async (fd) => {
  const { actor } = await me();
  await openDispute(actor, str(fd, "assignmentId"), str(fd, "reason"));
  return "Dispute opened. The provider's payment is on hold until our team resolves it.";
});

export const openThreadAction = formAction(async (fd) => {
  const { actor } = await me();
  const t = await messaging.openThread(actor, { shiftId: str(fd, "shiftId"), providerId: str(fd, "providerId") });
  redirect(`/clinic/messages/${t.id}`);
});

export const sendMessageAction = formAction(async (fd) => {
  const { actor } = await me();
  const r = await messaging.sendMessage(actor, str(fd, "threadId"), str(fd, "body"), { acknowledgePhiWarning: str(fd, "ackPhi") === "true" });
  revalidatePath(`/clinic/messages/${str(fd, "threadId")}`);
  return r.notice ?? "Sent";
});

export const locationAction = formAction(async (fd) => {
  const { actor } = await me();
  await saveLocation(
    actor,
    {
      name: str(fd, "name"),
      address: str(fd, "address"),
      addressPlaceId: optStr(fd, "addressPlaceId"),
      addressLine2: optStr(fd, "addressLine2"),
      phone: optStr(fd, "phone"),
      onSiteContactName: optStr(fd, "onSiteContactName"),
      professionCodes: fd.getAll("professions").map(String),
      patientsPerDay: str(fd, "patientsPerDay") ? Number(str(fd, "patientsPerDay")) : null,
      ehr: optStr(fd, "ehr"),
      equipment: str(fd, "equipment").split(",").map((s) => s.trim()).filter(Boolean),
      dressCode: optStr(fd, "dressCode"),
      arrivalNotes: optStr(fd, "arrivalNotes"),
      skillIds: fd.getAll("skills").map(String),
    },
    optStr(fd, "locationId") ?? undefined,
  );
  revalidatePath("/clinic", "layout");
  return "Location saved. The state and time zone come from the verified address.";
});

export const locationPhotosAction = formAction(async (fd) => {
  const { actor } = await me();
  const locationId = str(fd, "locationId");
  // Check ownership before storing anything under this location's prefix.
  if (!(await prisma.clinicLocation.count({ where: { id: locationId, clinicOrgId: actor.clinicOrgId! } }))) return "Location not found.";
  const keys: string[] = [];
  for (const f of fd.getAll("photos")) {
    const key = await saveUpload(f, `locations/${locationId}`, { images: true });
    if (key) keys.push(key);
  }
  if (!keys.length) return "Choose at least one photo.";
  await addLocationPhotos(actor, locationId, keys);
  revalidatePath("/clinic/locations");
  return keys.length === 1 ? "Photo added." : `${keys.length} photos added.`;
});

export const removeLocationPhotoAction = formAction(async (fd) => {
  const { actor } = await me();
  await removeLocationPhoto(actor, str(fd, "locationId"), str(fd, "key"));
  revalidatePath("/clinic/locations");
  return "Photo removed.";
});

export const archiveLocationAction = formAction(async (fd) => {
  const { actor } = await me();
  await archiveLocation(actor, str(fd, "locationId"));
  revalidatePath("/clinic/locations");
  return "Location archived.";
});

export const experienceAction = formAction(async (fd) => {
  const { actor } = await me();
  await setExperiencePreference(actor, Number(str(fd, "minYears")), bool(fd, "relax"));
  revalidatePath("/clinic/settings");
  return "Saved. New shifts use this; you can change it on any shift when posting.";
});

export const orgAction = formAction(async (fd) => {
  const { actor } = await me();
  await updateOrg(actor, { legalName: str(fd, "legalName"), displayName: str(fd, "displayName"), phone: optStr(fd, "phone"), billingEmail: optStr(fd, "billingEmail") });
  revalidatePath("/clinic", "layout");
  return "Saved.";
});

export const paymentSetupAction = formAction(async () => {
  const { actor } = await me();
  redirect(await clinicPaymentSetupUrl(actor));
});

export const agreementAction = formAction(async () => {
  const { actor } = await me();
  redirect(await requestAgreement(actor));
});

export const inviteStaffAction = formAction(async (fd) => {
  const { actor } = await me();
  await inviteStaff(actor, { name: str(fd, "name"), email: str(fd, "email") });
  revalidatePath("/clinic/team");
  return "Invitation sent.";
});

export const passwordAction = formAction(async (fd) => {
  const { actor } = await me();
  await auth.changePassword(actor, str(fd, "current"), str(fd, "next"));
  return "Password changed.";
});

// ---------- Smart Dispatch (Addendum 02 §5.8, §9) ----------
export const findSomeoneNowAction = formAction(async (fd) => {
  const { actor } = await me();
  const r = await dispatch.findSomeoneNow(actor, str(fd, "shiftId"));
  revalidatePath(`/clinic/shifts/${str(fd, "shiftId")}`);
  return r.state === "FILLED" ? "Confirmed!" : "We're reaching out to the best-matched providers now.";
});

export const cancelDispatchAction = formAction(async (fd) => {
  const { actor } = await me();
  await dispatch.cancelDispatch(actor, str(fd, "shiftId"));
  revalidatePath(`/clinic/shifts/${str(fd, "shiftId")}`);
  return "Search stopped. Your shift stays posted for applications.";
});

export const boostAction = formAction(async (fd) => {
  const { actor } = await me();
  await dispatch.boostAndRedispatch(actor, str(fd, "shiftId"));
  revalidatePath(`/clinic/shifts/${str(fd, "shiftId")}`);
  return "Rate boosted — searching again with a wider radius.";
});

export const instantConfirmAction = formAction(async (fd) => {
  const { actor } = await me();
  await dispatch.clinicInstantConfirm(actor, str(fd, "shiftId"), str(fd, "providerId"));
  revalidatePath(`/clinic/shifts/${str(fd, "shiftId")}`);
  return "Confirmed instantly — this provider is On Call for shifts like yours.";
});

export const markArrivedAction = formAction(async (fd) => {
  const { actor } = await me();
  const r = await emergency.markArrived(actor, str(fd, "assignmentId"));
  revalidatePath("/clinic/shifts");
  return r;
});

export const reportNoShowAction = formAction(async (fd) => {
  const { actor } = await me();
  const r = await emergency.reportNoShow(actor, str(fd, "assignmentId"));
  revalidatePath("/clinic", "layout");
  if (r.replacementShiftId) redirect(`/clinic/shifts/${r.replacementShiftId}`);
  return "Recorded. You won't be charged for this shift.";
});

export const clinicPhoneStartAction = formAction(async (fd) => {
  const { actor } = await me();
  const phone = await auth.startPhoneVerification(actor, str(fd, "phone"));
  revalidatePath("/clinic/settings");
  return `We texted a code to ${phone}.`;
});

export const clinicPhoneConfirmAction = formAction(async (fd) => {
  const { actor } = await me();
  await auth.confirmPhone(actor, str(fd, "code"), true);
  revalidatePath("/clinic/settings");
  return "Verified — you'll get texts about your shifts.";
});

export const privateFeedbackAction = formAction(async (fd) => {
  const { actor } = await me();
  const r = await feedback.submitFeedback(actor, str(fd, "assignmentId"), str(fd, "body"));
  revalidatePath("/clinic/shifts");
  return r;
});
