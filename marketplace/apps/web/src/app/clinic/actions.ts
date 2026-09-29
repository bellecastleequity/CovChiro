"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { prisma } from "@cm/db";
import {
  dispatch,
  archiveLocation, auth, cancelShiftByClinic, clinicPaymentSetupUrl, createShift, inviteProviders, inviteStaff, messaging, openDispute, postShift, quoteForClinic,
  requestAgreement, saveLocation, selectApplicant, setBlock, setFavorite, submitRating, updateOrg,
} from "@cm/services";
import { formAction, optStr, str } from "@/lib/action";
import { requireActor } from "@/lib/session";

const me = () => requireActor("clinic");

/** Wizard payload arrives as JSON; times are local to the location and converted to UTC here. */
async function shiftPayload(fd: FormData) {
  const raw = JSON.parse(str(fd, "payload") || "{}");
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
  const q = await quoteForClinic(actor, await shiftPayload(fd));
  return { ok: "quote", data: q };
});

export const createShiftAction = formAction(async (fd) => {
  const { actor } = await me();
  const post = str(fd, "mode") !== "draft";
  const { shiftId } = await createShift(actor, await shiftPayload(fd), { post });
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
  return "Blocked. This provider won't be matched to your shifts.";
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

export const archiveLocationAction = formAction(async (fd) => {
  const { actor } = await me();
  await archiveLocation(actor, str(fd, "locationId"));
  revalidatePath("/clinic/locations");
  return "Location archived.";
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
