"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { DateTime } from "luxon";
import { DomainError, type PunchKind } from "@cm/core";
import { timeclock, volume } from "@cm/services";
import { formAction, str } from "@/lib/action";
import { requireActor } from "@/lib/session";

/** Time clock + timesheet sign-off actions (provider, clinic, emailed link, admin). */

const num = (fd: FormData, k: string) => (str(fd, k) === "" ? null : Number(str(fd, k)));
async function who() {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, device: h.get("user-agent") ?? null };
}
const signOff = async (fd: FormData) => ({ approverName: str(fd, "approverName"), approverTitle: str(fd, "approverTitle") || null, signature: str(fd, "signature") || null, note: str(fd, "note") || null, ...(await who()) });
const rv = () => {
  revalidatePath("/provider", "layout");
  revalidatePath("/clinic", "layout");
  revalidatePath("/admin/timesheets");
};

export const punchAction = formAction(async (fd) => {
  const { actor } = await requireActor("provider");
  const kind = str(fd, "kind") as PunchKind;
  const r = await timeclock.punch(actor, str(fd, "assignmentId"), kind, { lat: num(fd, "lat"), lng: num(fd, "lng"), accuracyM: num(fd, "accuracy") });
  rv();
  const time = r.at.toLocaleTimeString("en-US", { timeZone: str(fd, "tz") || "America/New_York", hour: "numeric", minute: "2-digit" });
  return kind === "IN" ? `Punched in at ${time}.` : kind === "BREAK_START" ? `Lunch started at ${time}. Enjoy!` : kind === "BREAK_END" ? `Back from lunch at ${time}.` : `Punched out at ${time}. Your timesheet has gone to the clinic to sign off.`;
});

export const missedPunchAction = formAction(async (fd) => {
  const { actor } = await requireActor("provider");
  const at = DateTime.fromISO(str(fd, "at"), { zone: str(fd, "tz") || "America/New_York" });
  if (!at.isValid) throw new DomainError("VALIDATION", "Enter the date and time.");
  await timeclock.addMissedPunch(actor, str(fd, "assignmentId"), str(fd, "kind") as PunchKind, at.toJSDate(), str(fd, "note"));
  rv();
  return "Added. It's marked as entered by hand for the clinic.";
});

export const providerNoteAction = formAction(async (fd) => {
  const { actor } = await requireActor("provider");
  await timeclock.setProviderNote(actor, str(fd, "assignmentId"), str(fd, "note"));
  rv();
  return "Note saved.";
});

export const onsiteSignAction = formAction(async (fd) => {
  const { actor } = await requireActor("provider");
  await timeclock.approveOnsite(actor, str(fd, "assignmentId"), await signOff(fd));
  rv();
  return "Signed off. Thank you!";
});

export const clinicApproveAction = formAction(async (fd) => {
  const { actor } = await requireActor("clinic");
  await timeclock.approveAsClinic(actor, str(fd, "assignmentId"), await signOff(fd));
  rv();
  return "Timesheet signed off.";
});

export const clinicReportAction = formAction(async (fd) => {
  const { actor } = await requireActor("clinic");
  await timeclock.reportAsClinic(actor, str(fd, "assignmentId"), str(fd, "reason"));
  rv();
  return "Thanks. We've opened a review and will be in touch; pay for this shift is on hold until it's resolved.";
});

export const tokenApproveAction = formAction(async (fd) => {
  await timeclock.approveByToken(str(fd, "token"), await signOff(fd));
  rv();
  return "Timesheet signed off. Thank you!";
});

export const tokenReportAction = formAction(async (fd) => {
  await timeclock.reportByToken(str(fd, "token"), str(fd, "reason"));
  rv();
  return "Thanks. We've opened a review and will be in touch; pay for this shift is on hold until it's resolved.";
});

export const adminApproveAction = formAction(async (fd) => {
  const { actor } = await requireActor("admin");
  await timeclock.approveAsAdmin(actor, str(fd, "assignmentId"), str(fd, "note"));
  rv();
  return "Approved.";
});

// ---------------- visit counts (volume pricing) ----------------

const visits = (fd: FormData) => {
  const n = Number(str(fd, "visits"));
  if (str(fd, "visits") === "" || !Number.isInteger(n)) throw new DomainError("VALIDATION", "Enter the number of visits.");
  return n;
};

export const visitsAction = formAction(async (fd) => {
  const { actor } = await requireActor("provider");
  const r = await volume.submitVisits(actor, str(fd, "assignmentId"), visits(fd));
  rv();
  return r.overageVisits ? `Saved: ${r.visits} visits, ${r.overageVisits} past your tier. The clinic can check it, then the extra pay is added to your next payout.` : `Saved: ${r.visits} visits. Thanks!`;
});

export const clinicConfirmVisitsAction = formAction(async (fd) => {
  const { actor } = await requireActor("clinic");
  await volume.confirmVisitsAsClinic(actor, str(fd, "assignmentId"));
  rv();
  return "Count confirmed. Thank you!";
});

export const clinicReportVisitsAction = formAction(async (fd) => {
  const { actor } = await requireActor("clinic");
  await volume.reportVisitsAsClinic(actor, str(fd, "assignmentId"), visits(fd), str(fd, "reason"));
  rv();
  return "Thanks. We've recorded your count; if the two are far apart we'll review them before anything extra is charged.";
});

export const tokenConfirmVisitsAction = formAction(async (fd) => {
  await volume.confirmVisitsByToken(str(fd, "token"));
  rv();
  return "Count confirmed. Thank you!";
});

export const tokenReportVisitsAction = formAction(async (fd) => {
  await volume.reportVisitsByToken(str(fd, "token"), visits(fd), str(fd, "reason"));
  rv();
  return "Thanks. We've recorded your count; if the two are far apart we'll review them before anything extra is charged.";
});

export const adminSetVisitsAction = formAction(async (fd) => {
  const { actor } = await requireActor("admin");
  await volume.adminSetVisits(actor, str(fd, "assignmentId"), visits(fd), str(fd, "note"));
  rv();
  return "Final count saved and settled.";
});
