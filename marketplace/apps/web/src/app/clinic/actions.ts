"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { prisma } from "@cm/db";
import { DomainError } from "@cm/core";
import {
  hiring,
  standing,
  dispatch,
  bookings,
  emergency,
  feedback,
  shiftChanges,
  clinicRate,
  clinicVerify,
  archiveLocation, auth, overdue, sameProvider, cancelShiftByClinic, clinicPaymentSetupUrl, createShift, inviteProviders, inviteStaff, messaging, openDispute, postShift, quoteForClinic, updateDraftShift,
  addLocationPhotos, removeLocationPhoto, setExperiencePreference, requestAgreement, saveLocation, upcomingWith, selectApplicant, setBlock, setFavorite, submitRating, updateOrg,
} from "@cm/services";
import { bool, formAction, optStr, str } from "@/lib/action";
import { requireActor } from "@/lib/session";
import { saveUpload } from "@/lib/upload";
import { verificationInputFrom } from "@/lib/verification-input";

const me = () => requireActor("clinic");

/** Wizard payload arrives as JSON; times are local to the location and converted to UTC here. */
/** Every day in the wizard's payload (one for a single shift). */
async function shiftPayloads(fd: FormData) {
  const raw = JSON.parse(str(fd, "payload") || "{}");
  const days: { date: string; start: string; end: string; lunch?: string; lunchStart?: string }[] = Array.isArray(raw.days) && raw.days.length ? raw.days : [{ date: raw.date, start: raw.start, end: raw.end }];
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
  const lunchMinutes = Math.max(0, Math.round(Number(raw.lunch) || 0));
  let lunchAt = lunchMinutes && raw.lunchStart ? DateTime.fromISO(`${raw.date}T${raw.lunchStart}`, { zone }) : null;
  if (lunchAt && lunchAt < start) lunchAt = lunchAt.plus({ days: 1 });
  return {
    locationId: raw.locationId,
    lunchMinutes,
    lunchStartsAt: lunchAt?.isValid ? lunchAt.toJSDate() : null,
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
    flyIn: !!raw.flyIn,
    sameProvider: typeof raw.sameProvider === "boolean" ? raw.sameProvider : undefined,
    autoPostWhenAvailable: raw.autoPost !== false,
    lodgingCapCentsPerNight: raw.lodgingCap ? Math.round(Number(raw.lodgingCap) * 100) : null,
    promoCode: raw.promoCode || null,
    supervisionAttestation: raw.supervisionAttestation ?? null,
    clinicRate: raw.clinicRate ?? null,
  };
}

export const quoteAction = formAction(async (fd) => {
  const { actor } = await me();
  const inputs = await shiftPayloads(fd);
  const quotes = [];
  // Promo code: first day only (same rule as posting).
  const raw = JSON.parse(str(fd, "payload") || "{}");
  const needed = Number(raw.providersNeeded) || 1;
  for (const [i, input] of inputs.entries()) quotes.push(await quoteForClinic(actor, { ...input, promoCode: i === 0 ? input.promoCode : null }, { needed, days: inputs.length }));
  const dates: string[] = Array.isArray(raw.days) && raw.days.length ? raw.days.map((d: { date: string }) => d.date) : [raw.date];
  return {
    ok: "quote",
    data: {
      ...quotes[0],
      days: quotes.map((q, i) => ({ date: dates[i], subtotalCents: q.subtotalCents, premiums: q.premiums })),
      totalCents: quotes.reduce((t, q) => t + q.subtotalCents, 0),
      // Open states: the fewest providers available on any day, and the first short day's reason.
      supply: quotes.every((q) => q.supply)
        ? { ...(quotes.find((q) => !q.supply!.ok)?.supply ?? quotes[0].supply!), available: Math.min(...quotes.map((q) => q.supply!.available)), shortDate: (() => { const i = quotes.findIndex((q) => !q.supply!.ok); return i >= 0 && quotes.length > 1 ? dates[i] : null; })() }
        : null,
    },
  };
});

/** Posting refused because no provider can take it yet: the drafts are saved and the clinic will be told. */
function waitingDraft(e: unknown): string | null {
  if (e instanceof DomainError && e.code === "NO_PROVIDER_AVAILABLE") {
    const ids = (e.details as { shiftIds?: string[] } | undefined)?.shiftIds;
    if (ids?.length) return ids[0];
  }
  return null;
}

export const createShiftAction = formAction(async (fd) => {
  const { actor } = await me();
  const post = str(fd, "mode") !== "draft";
  const inputs = await shiftPayloads(fd);
  const raw = JSON.parse(str(fd, "payload") || "{}");
  let made: { shiftIds: string[]; bookings: number };
  try {
    made = await bookings.createForProviders(actor, inputs, Number(raw.providersNeeded) || 1, { post });
  } catch (e) {
    const draft = waitingDraft(e);
    if (!draft) throw e;
    revalidatePath("/clinic", "layout");
    redirect(`/clinic/shifts/${draft}?waiting=1`);
  }
  const { shiftIds, bookings: n } = made;
  revalidatePath("/clinic", "layout");
  redirect(n > 1 ? `/clinic/shifts?${post ? "posted" : "saved"}=${n}` : `/clinic/shifts/${shiftIds[0]}?${post ? "posted" : "saved"}=1`);
});

export const updateDraftAction = formAction(async (fd) => {
  const { actor } = await me();
  const post = str(fd, "mode") !== "draft";
  const shiftId = str(fd, "shiftId");
  const [input] = await shiftPayloads(fd);
  let waiting = false;
  try {
    await updateDraftShift(actor, shiftId, input, { post });
  } catch (e) {
    if (!waitingDraft(e)) throw e;
    waiting = true;
  }
  revalidatePath("/clinic", "layout");
  redirect(`/clinic/shifts/${shiftId}?${waiting ? "waiting" : post ? "posted" : "saved"}=1`);
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
  const r = await inviteProviders(actor, str(fd, "shiftId"), ids);
  revalidatePath(`/clinic/shifts/${str(fd, "shiftId")}`);
  if ("allDays" in r && r.allDays) return `Asked ${r.invited} provider${r.invited === 1 ? "" : "s"} to apply for every day${r.skipped ? ` (${r.skipped} can't take every day, so weren't asked)` : ""}. You'll be notified when they apply.`;
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

export const bookAgainAction = formAction(async (fd) => {
  const { actor } = await me();
  const r = await bookings.bookAgain(actor, str(fd, "assignmentId"), str(fd, "date"));
  revalidatePath("/clinic", "layout");
  if (!r.invited) return { ok: `Posted, but ${r.providerName} couldn't be invited: ${r.reason} The shift is open to other providers.`, data: { shiftId: r.shiftId } };
  redirect(`/clinic/shifts/${r.shiftId}?rebooked=1`);
});

/** Change-shift form: date and times are local to the location. */
async function changePayload(fd: FormData) {
  const shiftId = str(fd, "shiftId");
  const shift = await prisma.shift.findUnique({ where: { id: shiftId }, select: { location: { select: { timeZone: true } } } });
  const zone = shift?.location.timeZone ?? "America/New_York";
  const start = DateTime.fromISO(`${str(fd, "date")}T${str(fd, "start")}`, { zone });
  let end = DateTime.fromISO(`${str(fd, "date")}T${str(fd, "end")}`, { zone });
  if (end <= start) end = end.plus({ days: 1 });
  const patients = str(fd, "expectedPatients");
  const lunchMinutes = fd.has("lunch") ? Math.max(0, Number(str(fd, "lunch")) || 0) : undefined;
  let lunchAt = lunchMinutes && str(fd, "lunchStart") ? DateTime.fromISO(`${str(fd, "date")}T${str(fd, "lunchStart")}`, { zone }) : null;
  if (lunchAt && lunchAt < start) lunchAt = lunchAt.plus({ days: 1 });
  return {
    shiftId,
    input: {
      lunchMinutes,
      lunchStartsAt: lunchMinutes === undefined ? undefined : lunchAt?.isValid ? lunchAt.toJSDate() : null,
      startsAt: start.isValid ? start.toJSDate() : new Date(NaN),
      endsAt: end.isValid ? end.toJSDate() : new Date(NaN),
      expectedPatients: fd.has("expectedPatients") ? (patients === "" ? null : Number(patients)) : undefined,
      minYearsExperience: fd.has("minYearsExperience") ? Number(str(fd, "minYearsExperience")) || 0 : undefined,
      notes: fd.has("notes") ? str(fd, "notes") || null : undefined,
      message: str(fd, "message") || null,
    },
  };
}

export const previewShiftChangeAction = formAction(async (fd) => {
  const { actor } = await me();
  const { shiftId, input } = await changePayload(fd);
  return { ok: "", data: await shiftChanges.previewShiftChange(actor, shiftId, input) };
});

export const changeShiftAction = formAction(async (fd) => {
  const { actor } = await me();
  const { shiftId, input } = await changePayload(fd);
  const r = await shiftChanges.changeShift(actor, shiftId, input);
  revalidatePath("/clinic", "layout");
  redirect(`/clinic/shifts/${shiftId}?changed=${r.status}`);
});

export const withdrawShiftChangeAction = formAction(async (fd) => {
  const { actor } = await me();
  await shiftChanges.withdrawShiftChange(actor, str(fd, "changeId"));
  revalidatePath("/clinic", "layout");
  return "Withdrawn. The shift stays as it was booked.";
});

export const releaseClinicRateAction = formAction(async (fd) => {
  const { actor } = await me();
  const r = await clinicRate.releaseNow(actor, str(fd, "shiftId"));
  revalidatePath("/clinic", "layout");
  return `Released at the market price of $${(r.clinicPriceCents / 100).toFixed(2)}. We're filling it now.`;
});

export const splitBookingAction = formAction(async (fd) => {
  const { actor } = await me();
  await sameProvider.splitGroup(actor, str(fd, "groupId"), "clinic");
  revalidatePath(`/clinic/shifts/${str(fd, "shiftId")}`);
  return "Split. Each day is now filled on its own.";
});

export const keepWaitingAction = formAction(async (fd) => {
  const { actor } = await me();
  const until = await sameProvider.keepWaiting(actor, str(fd, "groupId"));
  revalidatePath(`/clinic/shifts/${str(fd, "shiftId")}`);
  return `OK, we'll keep looking for one provider until ${until.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" })} ET, then ask again.`;
});

export const clinicVerificationAction = formAction(async (fd) => {
  const { actor } = await me();
  if (!bool(fd, "attest")) throw new DomainError("VALIDATION", "Tick the ownership statement and type your name to sign it.");
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const r = await clinicVerify.submitVerification(actor, await verificationInputFrom(fd, actor.clinicOrgId!),
    { ip },
  );
  revalidatePath("/clinic", "layout");
  if (bool(fd, "documentsLater") && !r.autoApproved) {
    const { getSettings } = await import("@cm/services");
    return `Thanks. Please email the documents to ${(await getSettings())["support.email"]} with your clinic's name; we'll attach them and finish the review.`;
  }
  return r.autoApproved
    ? "Verified. Thank you! Your shifts are going out to providers."
    : r.status === "VERIFIED"
      ? "Thanks. Your renewal is with our team; you stay verified meanwhile."
      : "Thanks. Our team is reviewing your details, usually within one business day. We'll email you.";
});

/** Billing: pay an overdue charge now with the card on file. */
export const payNowAction = formAction(async (fd) => {
  const { actor } = await me();
  const r = await overdue.retryPayment(actor, str(fd, "paymentId"));
  revalidatePath("/clinic/billing");
  if (r.status === "SUCCEEDED") return "Paid. Thank you.";
  if (r.status === "PROCESSING") return "Payment is processing. We'll let you know when it clears.";
  throw new DomainError("PAYMENT_FAILED", `It didn't go through${r.failureReason ? `: ${r.failureReason}` : ""}. Update your card above and try again.`);
});
