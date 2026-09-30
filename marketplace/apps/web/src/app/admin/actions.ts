"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addAdjustment, admin, adminAssign, dispatch, adminCharge, cancelAssignment, cancelPayout, cancelShiftByClinic, inviteProviders, issuePayment, leads, promo, resolveDispute,
  reviewLodgingReceipt, setHold,
} from "@cm/services";
import { bool, dollarsToCents, formAction, optStr, str } from "@/lib/action";
import { requireActor } from "@/lib/session";

const me = () => requireActor("admin");
const rv = (p: string) => revalidatePath(p, "layout");

// ---------- email ----------
export const testEmailAction = formAction(async (fd) => {
  const { actor } = await me();
  return admin.sendTestEmail(actor, str(fd, "to"));
});

// ---------- verification ----------
export const reviewLicenseAction = formAction(async (fd) => {
  const { actor } = await me();
  await admin.reviewLicense(actor, str(fd, "id"), { approve: str(fd, "decision") === "approve", expiresAt: str(fd, "expiresAt") ? new Date(str(fd, "expiresAt")) : undefined, reason: optStr(fd, "reason"), evidenceUrl: optStr(fd, "evidence") });
  rv("/admin");
  return "Saved.";
});
export const reviewMalpracticeAction = formAction(async (fd) => {
  const { actor } = await me();
  await admin.reviewMalpractice(actor, str(fd, "id"), { approve: str(fd, "decision") === "approve", reason: optStr(fd, "reason") });
  rv("/admin");
  return "Saved.";
});
export const reviewCertAction = formAction(async (fd) => {
  const { actor } = await me();
  await admin.reviewCertification(actor, str(fd, "providerId"), str(fd, "skillId"), { approve: str(fd, "decision") === "approve", expiresAt: str(fd, "expiresAt") ? new Date(str(fd, "expiresAt")) : null });
  rv("/admin");
  return "Saved.";
});
export const resolveNpiAction = formAction(async (fd) => {
  const { actor } = await me();
  await admin.resolveNpi(actor, str(fd, "providerId"), str(fd, "decision") === "approve");
  rv("/admin");
  return "Saved.";
});

// ---------- shifts ----------
export const adminAssignAction = formAction(async (fd) => {
  const { actor } = await me();
  await adminAssign(actor, str(fd, "shiftId"), str(fd, "providerId"));
  rv("/admin/shifts");
  return "Assigned.";
});
export const adminInviteAction = formAction(async (fd) => {
  const { actor } = await me();
  await inviteProviders(actor, str(fd, "shiftId"), [str(fd, "providerId")]);
  rv("/admin/shifts");
  return "Offer sent.";
});
export const repriceAction = formAction(async (fd) => {
  const { actor } = await me();
  await admin.repriceShift(actor, str(fd, "shiftId"), { clinicPriceCents: dollarsToCents(str(fd, "clinicPrice"))!, providerPayCents: dollarsToCents(str(fd, "providerPay"))!, reason: str(fd, "reason") });
  rv("/admin/shifts");
  return "Repriced (logged).";
});
export const adminCancelShiftAction = formAction(async (fd) => {
  const { actor } = await me();
  await cancelShiftByClinic(actor, str(fd, "shiftId"), str(fd, "reason") || "Cancelled by platform");
  rv("/admin/shifts");
  return "Shift cancelled (platform — full refund).";
});
export const adminDispatchAction = formAction(async (fd) => {
  const { actor } = await me();
  await dispatch.findSomeoneNow(actor, str(fd, "shiftId"));
  rv("/admin/shifts");
  return "Dispatch started.";
});
export const adminStopDispatchAction = formAction(async (fd) => {
  const { actor } = await me();
  await dispatch.cancelDispatch(actor, str(fd, "shiftId"));
  rv("/admin/shifts");
  return "Dispatch stopped.";
});
export const removeProviderAction = formAction(async (fd) => {
  const { actor } = await me();
  await cancelAssignment(actor, str(fd, "assignmentId"), str(fd, "reason") || "Removed by platform", { by: "PLATFORM", noShow: bool(fd, "noShow") });
  rv("/admin/shifts");
  return "Provider removed; backfill started.";
});

// ---------- people ----------
export const approveProviderAction = formAction(async (fd) => {
  const { actor } = await me();
  const r = await admin.approveProvider(actor, str(fd, "providerId"), str(fd, "approve") !== "no");
  rv("/admin");
  return r;
});
export const approveClinicAction = formAction(async (fd) => {
  const { actor } = await me();
  const r = await admin.approveClinic(actor, str(fd, "clinicOrgId"));
  rv("/admin");
  return r;
});
export const providerStatusAction = formAction(async (fd) => {
  const { actor } = await me();
  await admin.setProviderStatus(actor, str(fd, "providerId"), str(fd, "status") as "ACTIVE", optStr(fd, "note") ?? undefined);
  rv("/admin/providers");
  return "Status updated.";
});
export const clinicStatusAction = formAction(async (fd) => {
  const { actor } = await me();
  await admin.setClinicStatus(actor, str(fd, "clinicOrgId"), str(fd, "status") as "ACTIVE", optStr(fd, "note") ?? undefined);
  rv("/admin/clinics");
  return "Status updated.";
});

// ---------- provider pay ----------
export const issuePaymentAction = formAction(async (fd) => {
  const { actor } = await me();
  const ids = fd.getAll("payoutId").map(String);
  const r = await issuePayment(actor, str(fd, "providerId"), { payoutIds: ids.length ? ids : undefined, early: bool(fd, "early"), note: optStr(fd, "note") ?? undefined });
  rv("/admin/payouts");
  if (!r) return "Nothing payable right now (holds, disputes, or net amount ≤ $0).";
  return r.status === "PAID" ? `Paid $${(r.amountCents / 100).toFixed(2)} via Stripe.` : `Transfer failed: ${"reason" in r ? r.reason : ""}`;
});
export const holdAction = formAction(async (fd) => {
  const { actor } = await me();
  await setHold(actor, str(fd, "payoutId"), str(fd, "hold") === "1", optStr(fd, "reason"));
  rv("/admin/payouts");
  return "Updated.";
});
export const adjustmentAction = formAction(async (fd) => {
  const { actor } = await me();
  const sign = str(fd, "direction") === "deduct" ? -1 : 1;
  await addAdjustment(actor, { providerId: str(fd, "providerId"), amountCents: sign * (dollarsToCents(str(fd, "amount")) ?? 0), description: str(fd, "description") });
  rv("/admin/payouts");
  return "Adjustment added to the ledger.";
});
export const cancelPayoutAction = formAction(async (fd) => {
  const { actor } = await me();
  await cancelPayout(actor, str(fd, "payoutId"), str(fd, "reason") || "Cancelled by admin");
  rv("/admin/payouts");
  return "Cancelled.";
});

// ---------- payments & disputes ----------
export const resolveDisputeAction = formAction(async (fd) => {
  const { actor } = await me();
  const adj = dollarsToCents(str(fd, "payoutAdjustment"));
  await resolveDispute(actor, str(fd, "disputeId"), { resolution: str(fd, "resolution"), refundCents: dollarsToCents(str(fd, "refund")) ?? 0, payoutAdjustmentCents: adj ? (str(fd, "adjDirection") === "deduct" ? -adj : adj) : 0 });
  rv("/admin/payments");
  return "Dispute resolved.";
});
export const lodgingReviewAction = formAction(async (fd) => {
  const { actor } = await me();
  await reviewLodgingReceipt(actor, str(fd, "receiptId"), str(fd, "decision") === "approve");
  rv("/admin/payments");
  return "Saved.";
});
export const adminChargeAction = formAction(async (fd) => {
  const { actor } = await me();
  const p = await adminCharge(actor, str(fd, "clinicOrgId"), str(fd, "type") as "ADJUSTMENT", dollarsToCents(str(fd, "amount")) ?? 0, str(fd, "description"));
  rv("/admin/payments");
  return p?.status === "SUCCEEDED" ? "Charged." : `Charge ${p?.status?.toLowerCase() ?? "not created"}: ${p?.failureReason ?? ""}`;
});

// ---------- promo ----------
export const createPromoAction = formAction(async (fd) => {
  const { actor } = await me();
  await promo.createPromo(actor, {
    code: str(fd, "code"),
    kind: str(fd, "kind") as "PERCENT",
    value: Number(str(fd, "value")),
    description: optStr(fd, "description"),
    startsAt: optStr(fd, "startsAt") ? new Date(str(fd, "startsAt")) : null,
    expiresAt: optStr(fd, "expiresAt") ? new Date(str(fd, "expiresAt")) : null,
    maxUses: optStr(fd, "maxUses") ? Number(str(fd, "maxUses")) : null,
    maxUsesPerClinic: optStr(fd, "maxUsesPerClinic") ? Number(str(fd, "maxUsesPerClinic")) : 1,
    firstShiftOnly: bool(fd, "firstShiftOnly"),
  });
  rv("/admin/promo");
  return "Code created.";
});
export const togglePromoAction = formAction(async (fd) => {
  const { actor } = await me();
  await promo.updatePromo(actor, str(fd, "code"), { active: str(fd, "active") === "1" });
  rv("/admin/promo");
  return "Updated.";
});
export const landingAction = formAction(async (fd) => {
  const { actor } = await me();
  await promo.saveLanding(actor, str(fd, "code"), { enabled: bool(fd, "enabled"), audience: str(fd, "audience") as "CLINIC", headline: optStr(fd, "headline"), description: optStr(fd, "description") });
  rv("/admin/promo");
  return "Landing page saved.";
});
export const dripCopyAction = formAction(async (fd) => {
  const { actor } = await me();
  const emails = Array.from({ length: 5 }, (_, i) => ({ subject: str(fd, `subject-${i}`), intro: str(fd, `intro-${i}`) }));
  await promo.saveDripCopy(actor, str(fd, "code"), emails);
  rv("/admin/promo");
  return "Follow-up emails saved.";
});

// ---------- leads ----------
export const updateLeadAction = formAction(async (fd) => {
  const { actor } = await me();
  await leads.updateLead(actor, str(fd, "leadId"), { status: (optStr(fd, "status") as never) ?? undefined, note: optStr(fd, "note") ?? undefined, followUpAt: optStr(fd, "followUpAt") ? new Date(str(fd, "followUpAt")) : undefined });
  rv("/admin/leads");
  return "Saved.";
});
export const createLeadAction = formAction(async (fd) => {
  const { actor } = await me();
  const l = await leads.createLeadManually(actor, { name: str(fd, "name"), email: str(fd, "email"), audience: str(fd, "audience") as "CLINIC", phone: optStr(fd, "phone") ?? undefined, organization: optStr(fd, "organization") ?? undefined, state: optStr(fd, "state") ?? undefined, note: optStr(fd, "note") ?? undefined });
  redirect(`/admin/leads/${l.id}`);
});
export const resendLeadAction = formAction(async (fd) => {
  const { actor } = await me();
  await leads.resendLeadEmail(actor, str(fd, "leadId"));
  rv("/admin/leads");
  return "Email re-sent.";
});
export const deleteLeadAction = formAction(async (fd) => {
  const { actor } = await me();
  await leads.deleteLead(actor, str(fd, "leadId"));
  redirect("/admin/leads");
});

// ---------- states / rates / settings / tasks ----------
export const stateConfigAction = formAction(async (fd) => {
  const { actor } = await me();
  const r = await admin.updateStateConfig(actor, str(fd, "state"), {
    legalReviewComplete: bool(fd, "legalReviewComplete"),
    legalReviewNotes: str(fd, "legalReviewNotes"),
    boardLookupUrl: optStr(fd, "boardLookupUrl"),
    staffingRegistrationRequired: bool(fd, "staffingRegistrationRequired"),
    salesTaxOnStaffing: bool(fd, "salesTaxOnStaffing"),
    defaultRateRegionId: optStr(fd, "defaultRateRegionId"),
    enabled: bool(fd, "enabled"),
  });
  rv("/admin/states");
  return r.confirmedAssignmentsToReview.length ? `Saved. ${r.confirmedAssignmentsToReview.length} confirmed assignments in this state need review.` : "Saved.";
});
export const pscAction = formAction(async (fd) => {
  const { actor } = await me();
  const minOcc = dollarsToCents(str(fd, "minOcc"));
  const minAgg = dollarsToCents(str(fd, "minAgg"));
  await admin.updateProfessionState(actor, str(fd, "professionCode"), str(fd, "state"), {
    legalReviewComplete: bool(fd, "legalReviewComplete"),
    legalReviewNotes: optStr(fd, "legalReviewNotes"),
    licensedAtStateLevel: bool(fd, "licensedAtStateLevel"),
    alternativeCredentialAllowed: bool(fd, "alternativeCredentialAllowed"),
    alternativeCredentialPolicy: optStr(fd, "alternativeCredentialPolicy"),
    credentialTitle: optStr(fd, "credentialTitle"),
    boardLookupUrl: optStr(fd, "boardLookupUrl"),
    supervisionRequired: str(fd, "supervisionRequired") === "yes",
    supervisingProfessionCodes: str(fd, "supervisingProfessionCodes").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
    supervisionNotes: optStr(fd, "supervisionNotes"),
    malpracticeMinOccurrenceCents: minOcc,
    malpracticeMinAggregateCents: minAgg,
    scopeNotes: optStr(fd, "scopeNotes"),
    enabled: bool(fd, "enabled"),
  });
  rv("/admin/states");
  return "Saved.";
});
export const skillRuleAction = formAction(async (fd) => {
  const { actor } = await me();
  await admin.setSkillStateRule(actor, str(fd, "skillId"), str(fd, "professionCode"), str(fd, "state"), bool(fd, "allowed"), optStr(fd, "notes") ?? undefined);
  rv("/admin/states");
  return "Scope rule saved.";
});
export const regionAction = formAction(async (fd) => {
  const { actor } = await me();
  await admin.saveRateRegion(actor, { id: optStr(fd, "id") ?? undefined, state: str(fd, "state"), name: str(fd, "name"), tier: Number(str(fd, "tier") || 1), zip3List: str(fd, "zip3List").split(/[\s,]+/) });
  rv("/admin/rates");
  return "Region saved.";
});
export const rateCardAction = formAction(async (fd) => {
  const { actor } = await me();
  await admin.setRateCard(actor, {
    rateRegionId: str(fd, "rateRegionId"),
    professionCode: str(fd, "professionCode"),
    durationTier: str(fd, "durationTier") as "FULL_DAY",
    clinicPriceCents: dollarsToCents(str(fd, "clinicPrice"))!,
    providerPayCents: dollarsToCents(str(fd, "providerPay"))!,
    minHours: optStr(fd, "minHours") ? Number(str(fd, "minHours")) : null,
    effectiveFrom: optStr(fd, "effectiveFrom") ? new Date(str(fd, "effectiveFrom")) : undefined,
  });
  rv("/admin/rates");
  return "Rate card saved. Existing shifts keep their original prices.";
});
export const settingAction = formAction(async (fd) => {
  const { actor } = await me();
  const raw = str(fd, "value");
  let value: unknown = raw;
  try {
    value = JSON.parse(raw);
  } catch {
    value = raw;
  }
  await admin.updateSetting(actor, str(fd, "key"), value);
  rv("/admin/settings");
  return "Saved.";
});
export const resolveTaskAction = formAction(async (fd) => {
  const { actor } = await me();
  await admin.resolveTask(actor, str(fd, "taskId"));
  rv("/admin");
  return "Resolved.";
});
