"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { prisma } from "@cm/db";
import {
  addBlackout, addMalpractice, addOpenDate, addProfession, applyToShift, auth, cancelAssignment, deleteLicense, messaging, openDispute, providerStripeLink,
  removeAvailabilityException, requestAgreement, respondToOffer, setAvailability, setProviderPhoto, setSkills, submitLodgingReceipt, submitRating,
  updateProviderProfile, upsertLicense, withdrawApplication,
} from "@cm/services";
import { bool, dollarsToCents, formAction, optStr, str } from "@/lib/action";
import { requireActor } from "@/lib/session";
import { saveUpload } from "@/lib/upload";

const me = () => requireActor("provider");

export const applyAction = formAction(async (fd) => {
  const { actor } = await me();
  const r = await applyToShift(actor, str(fd, "shiftId"), { note: optStr(fd, "note"), commit: bool(fd, "commit") });
  revalidatePath("/provider", "layout");
  return r.confirmed ? "Instant book: you're confirmed! Check My shifts for details." : "Applied. We'll notify you if you're selected.";
});

export const withdrawAction = formAction(async (fd) => {
  const { actor } = await me();
  await withdrawApplication(actor, str(fd, "applicationId"));
  revalidatePath("/provider", "layout");
  return "Application withdrawn.";
});

export const respondOfferAction = formAction(async (fd) => {
  const { actor } = await me();
  const accept = str(fd, "decision") === "accept";
  const r = await respondToOffer(actor, str(fd, "offerId"), accept);
  revalidatePath("/provider", "layout");
  if (r.confirmed) redirect(`/provider/assignments/${r.assignmentId}`);
  return "Declined.";
});

export const cancelAssignmentAction = formAction(async (fd) => {
  const { actor } = await me();
  await cancelAssignment(actor, str(fd, "assignmentId"), str(fd, "reason") || "Provider cancelled", { by: "PROVIDER" });
  revalidatePath("/provider", "layout");
  return "Shift cancelled. The clinic has been notified.";
});

export const profileAction = formAction(async (fd) => {
  const { actor } = await me();
  await updateProviderProfile(actor, {
    legalName: str(fd, "legalName"),
    displayName: str(fd, "displayName"),
    phone: str(fd, "phone"),
    bio: optStr(fd, "bio"),
    homeAddress: str(fd, "homeAddress"),
    maxDriveMinutes: Number(str(fd, "maxDriveMinutes") || 90),
    willingOvernight: bool(fd, "willingOvernight"),
    school: optStr(fd, "school"),
    graduationYear: str(fd, "graduationYear") ? Number(str(fd, "graduationYear")) : null,
    languages: str(fd, "languages").split(",").map((s) => s.trim()).filter(Boolean),
    ehrSystems: str(fd, "ehrSystems").split(",").map((s) => s.trim()).filter(Boolean),
    xrayComfort: bool(fd, "xrayComfort"),
    maxPatientsPerDay: str(fd, "maxPatientsPerDay") ? Number(str(fd, "maxPatientsPerDay")) : null,
    npi: optStr(fd, "npi"),
  });
  const photo = await saveUpload(fd.get("photo"), `photos/${actor.providerId}`, { images: true });
  if (photo) await setProviderPhoto(actor, photo);
  revalidatePath("/provider", "layout");
  return "Profile saved.";
});

export const addProfessionAction = formAction(async (fd) => {
  const { actor } = await me();
  await addProfession(actor, str(fd, "professionCode"));
  revalidatePath("/provider/credentials");
  return "Profession added. Add your license for it below.";
});

export const licenseAction = formAction(async (fd) => {
  const { actor } = await me();
  const doc = await saveUpload(fd.get("document"), `providers/${actor.providerId}/licenses`);
  await upsertLicense(actor, {
    professionCode: str(fd, "professionCode"),
    state: str(fd, "state"),
    licenseNumber: str(fd, "licenseNumber"),
    credentialTitle: optStr(fd, "credentialTitle"),
    expiresAt: str(fd, "expiresAt"),
    documentUrl: doc,
  });
  revalidatePath("/provider/credentials");
  return "License submitted for verification — usually within one business day.";
});

export const deleteLicenseAction = formAction(async (fd) => {
  const { actor } = await me();
  await deleteLicense(actor, str(fd, "licenseId"));
  revalidatePath("/provider/credentials");
  return "License removed.";
});

export const malpracticeAction = formAction(async (fd) => {
  const { actor } = await me();
  const doc = await saveUpload(fd.get("document"), `providers/${actor.providerId}/malpractice`, { required: true });
  await addMalpractice(actor, {
    carrier: str(fd, "carrier"),
    policyNumber: str(fd, "policyNumber"),
    perOccurrenceDollars: Number(str(fd, "perOccurrence").replace(/[$,]/g, "")),
    aggregateDollars: Number(str(fd, "aggregate").replace(/[$,]/g, "")),
    expiresAt: str(fd, "expiresAt"),
    coveredProfessionCodes: fd.getAll("covered").map(String),
    documentUrl: doc!,
  });
  revalidatePath("/provider/credentials");
  return "Policy submitted for verification.";
});

export const skillsAction = formAction(async (fd) => {
  const { actor } = await me();
  const ids = fd.getAll("skill").map(String);
  const rows = [];
  for (const id of ids) {
    const cert = await saveUpload(fd.get(`cert-${id}`), `providers/${actor.providerId}/certs`);
    rows.push({ skillId: id, proficiency: Number(str(fd, `prof-${id}`) || 2), certificationUrl: cert ?? (optStr(fd, `certExisting-${id}`) || null), certificationExpiresAt: optStr(fd, `certExp-${id}`) });
  }
  await setSkills(actor, rows);
  revalidatePath("/provider/credentials");
  return "Skills saved.";
});

export const availabilityAction = formAction(async (fd) => {
  const { actor } = await me();
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  };
  const rules = [];
  for (let d = 0; d < 7; d++) {
    if (!bool(fd, `on-${d}`)) continue;
    const start = toMin(str(fd, `start-${d}`) || "08:00");
    let end = toMin(str(fd, `end-${d}`) || "18:00");
    if (end === 0) end = 1440;
    rules.push({ weekday: d, startMin: start, endMin: end });
  }
  await setAvailability(actor, rules);
  revalidatePath("/provider/availability");
  return "Weekly availability saved.";
});

export const exceptionAction = formAction(async (fd) => {
  const { actor } = await me();
  const kind = str(fd, "kind");
  if (kind === "remove-blackout" || kind === "remove-open") {
    await removeAvailabilityException(actor, kind === "remove-blackout" ? "blackout" : "open", str(fd, "id"));
  } else {
    // Interpret dates/times in the provider's home time zone, not the server's.
    const { homeTimeZone: zone } = await prisma.provider.findUniqueOrThrow({ where: { id: actor.providerId! }, select: { homeTimeZone: true } });
    const start = DateTime.fromISO(`${str(fd, "startDate")}T${str(fd, "startTime") || "00:00"}`, { zone }).toJSDate();
    const end = DateTime.fromISO(`${str(fd, "endDate") || str(fd, "startDate")}T${str(fd, "endTime") || "23:59"}`, { zone }).toJSDate();
    if (kind === "blackout") await addBlackout(actor, start, end, optStr(fd, "reason") ?? undefined);
    else await addOpenDate(actor, start, end);
  }
  revalidatePath("/provider/availability");
  return "Updated.";
});

export const stripeAction = formAction(async () => {
  const { actor } = await me();
  redirect(await providerStripeLink(actor));
});

export const agreementAction = formAction(async () => {
  const { actor } = await me();
  redirect(await requestAgreement(actor));
});

export const lodgingAction = formAction(async (fd) => {
  const { actor } = await me();
  const file = await saveUpload(fd.get("receipt"), `providers/${actor.providerId}/receipts`, { required: true });
  await submitLodgingReceipt(actor, str(fd, "assignmentId"), { amountCents: dollarsToCents(str(fd, "amount")) ?? 0, nights: Number(str(fd, "nights") || 1), fileUrl: file! });
  return "Receipt submitted. You'll be reimbursed once it's approved.";
});

export const disputeAction = formAction(async (fd) => {
  const { actor } = await me();
  await openDispute(actor, str(fd, "assignmentId"), str(fd, "reason"));
  return "Dispute opened. Our team will reach out.";
});

export const ratingAction = formAction(async (fd) => {
  const { actor } = await me();
  const cats = ["accuracy", "staff", "organization", "wouldReturn"];
  await submitRating(actor, str(fd, "assignmentId"), {
    stars: Number(str(fd, "stars")),
    categories: Object.fromEntries(cats.map((c) => [c, Number(str(fd, c) || 0)])),
    comment: optStr(fd, "comment"),
  });
  revalidatePath("/provider", "layout");
  return "Thanks for rating! Ratings are revealed when both sides submit.";
});

export const sendMessageAction = formAction(async (fd) => {
  const { actor } = await me();
  const r = await messaging.sendMessage(actor, str(fd, "threadId"), str(fd, "body"), { acknowledgePhiWarning: bool(fd, "ackPhi") });
  revalidatePath(`/provider/messages/${str(fd, "threadId")}`);
  return r.notice ?? "Sent";
});

export const openThreadAction = formAction(async (fd) => {
  const { actor } = await me();
  const t = await messaging.openThread(actor, { shiftId: str(fd, "shiftId") });
  redirect(`/provider/messages/${t.id}`);
});

export const passwordAction = formAction(async (fd) => {
  const { actor } = await me();
  await auth.changePassword(actor, str(fd, "current"), str(fd, "next"));
  return "Password changed.";
});
