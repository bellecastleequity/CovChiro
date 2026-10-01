"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { growth } from "@cm/services";
import { bool, dollarsToCents, formAction as baseFormAction, optStr, str } from "@/lib/action";
import { requireActor } from "@/lib/session";

const me = () => requireActor("admin");
const formAction: typeof baseFormAction = (fn) => baseFormAction(fn, { technical: true });
const rv = () => revalidatePath("/admin/growth", "layout");
const num = (fd: FormData, k: string) => (str(fd, k) === "" ? null : Number(str(fd, k)));

// ---------- control ----------
export const pauseAction = formAction(async (fd) => {
  const { actor } = await me();
  const paused = str(fd, "paused") === "true";
  await growth.setPaused(actor, paused);
  rv();
  return paused ? "Outbound automation paused. Nothing automated will be sent until you resume." : "Outbound automation resumed.";
});

export const marketingAction = formAction(async (fd) => {
  const { actor } = await me();
  const audience = str(fd, "audience") === "clinic" ? "clinic" : "provider";
  const on = str(fd, "on") === "true";
  await growth.setMarketing(actor, audience, on);
  rv();
  return `${audience === "clinic" ? "Clinic" : "Provider"} marketing ${on ? "on" : "off"}.`;
});

export const agentAction = formAction(async (fd) => {
  const { actor } = await me();
  const on = str(fd, "on") === "true";
  await growth.setAgent(actor, str(fd, "key") as growth.AgentKey, on);
  rv();
  return on ? "Agent switched on." : "Agent switched off.";
});

export const runNowAction = formAction(async () => {
  const { actor } = await me();
  const out = await growth.runNow(actor);
  rv();
  return { ok: "Sweeps ran.", data: out };
});

// ---------- approvals & escalations ----------
export const approvalAction = formAction(async (fd) => {
  const { actor } = await me();
  const decision = str(fd, "decision") === "approve" ? "approve" : "reject";
  await growth.decideApproval(actor, str(fd, "id"), decision, { subject: str(fd, "subject"), body: str(fd, "body") });
  rv();
  return decision === "approve" ? "Approved and sent." : "Rejected. Outreach to this clinic is paused.";
});

export const escalationAction = formAction(async (fd) => {
  const { actor } = await me();
  await growth.updateEscalation(actor, str(fd, "id"), str(fd, "status") as "OPEN" | "IN_PROGRESS" | "RESOLVED", optStr(fd, "resolution"));
  rv();
  return "Updated.";
});

// ---------- prospects ----------
function prospectFields(fd: FormData) {
  const o: Record<string, unknown> = {};
  for (const k of ["clinicName", "ownerName", "email", "phone", "website", "address", "city", "county", "state", "zip", "practiceType", "source", "notes", "campaignCode"]) o[k] = str(fd, k);
  o.locationsCount = num(fd, "locationsCount");
  o.providerCount = num(fd, "providerCount");
  o.ownership = optStr(fd, "ownership");
  o.multidisciplinary = fd.has("multidisciplinary") ? bool(fd, "multidisciplinary") : null;
  if (!o.state) o.state = "FL";
  return o;
}

export const saveProspectAction = formAction(async (fd) => {
  const { actor } = await me();
  const id = optStr(fd, "id");
  const row = await growth.saveProspect(actor, prospectFields(fd), id ?? undefined);
  rv();
  if (!id) redirect(`/admin/growth/prospects/${row.id}`);
  return "Saved.";
});

export const importProspectsAction = formAction(async (fd) => {
  const { actor } = await me();
  const file = fd.get("file");
  const csv = file instanceof File && file.size ? await file.text() : str(fd, "csv");
  const r = await growth.importProspects(actor, csv, str(fd, "source") || `CSV import ${new Date().toISOString().slice(0, 10)}`);
  rv();
  return `Imported: ${r.inserted} new, ${r.updated} updated, ${r.skipped} skipped.`;
});

export const overrideProspectAction = formAction(async (fd) => {
  const { actor } = await me();
  const o: Parameters<typeof growth.overrideProspect>[2] = {};
  if (str(fd, "segment")) o.segment = str(fd, "segment");
  if (str(fd, "stage")) o.stage = str(fd, "stage") as never;
  if (str(fd, "outreachPaused")) o.outreachPaused = str(fd, "outreachPaused") === "true";
  if (str(fd, "doNotContact")) o.doNotContact = str(fd, "doNotContact") === "true";
  if (str(fd, "smsOptIn")) o.smsOptIn = true;
  await growth.overrideProspect(actor, str(fd, "id"), o);
  rv();
  return "Updated.";
});

export const replyAction = formAction(async (fd) => {
  const { actor } = await me();
  const r = await growth.logReply(actor, str(fd, "id"), str(fd, "text"), optStr(fd, "subject") ?? undefined);
  rv();
  return `Reply logged and routed: ${r}.`;
});

export const noteAction = formAction(async (fd) => {
  const { actor } = await me();
  await growth.logNote(actor, str(fd, "id"), str(fd, "channel") === "PHONE" ? "PHONE" : "NOTE", str(fd, "direction") === "IN" ? "IN" : "OUT", str(fd, "text"));
  rv();
  return "Logged.";
});

export const manualEmailAction = formAction(async (fd) => {
  const { actor } = await me();
  await growth.sendManual(actor, str(fd, "entityType") as "PROSPECT" | "PROVIDER" | "CLINIC", str(fd, "entityId"), str(fd, "subject"), str(fd, "body"), str(fd, "purpose") === "COMMERCIAL" ? "COMMERCIAL" : "RELATIONSHIP");
  rv();
  return "Sent.";
});

// ---------- prompts ----------
export const savePromptAction = formAction(async (fd) => {
  const { actor } = await me();
  const row = await growth.savePromptDraft(actor, {
    key: str(fd, "key"), agent: str(fd, "agent"), channel: "EMAIL", purpose: str(fd, "purpose"), subjectTemplate: optStr(fd, "subjectTemplate"), body: str(fd, "body"),
    instructions: optStr(fd, "instructions"), allowedVars: str(fd, "allowedVars").split(",").map((v) => v.trim()).filter(Boolean), abWeight: Number(str(fd, "abWeight") || 100), notes: optStr(fd, "notes"),
  });
  rv();
  redirect(`/admin/growth/prompts/${row.id}`);
});

export const promptStatusAction = formAction(async (fd) => {
  const { actor } = await me();
  await growth.promptStatus(actor, str(fd, "id"), str(fd, "op") as never, num(fd, "weight") ?? undefined);
  rv();
  return "Updated.";
});

export const previewPromptAction = formAction(async (fd) => {
  const { actor } = await me();
  const r = await growth.previewPrompt(actor, str(fd, "id"), str(fd, "ai") === "true");
  return { ok: r.ai ? "AI preview ready." : r.aiError ? `AI unavailable (${r.aiError}); showing the approved template.` : "Preview ready.", data: r };
});

// ---------- KB, suppression, campaigns, markets ----------
export const saveKbAction = formAction(async (fd) => {
  const { actor } = await me();
  await growth.saveKb(actor, { id: optStr(fd, "id") ?? undefined, topic: str(fd, "topic"), audience: str(fd, "audience"), question: str(fd, "question"), answer: str(fd, "answer"), keywords: str(fd, "keywords"), approved: bool(fd, "approved"), active: bool(fd, "active") });
  rv();
  return "Saved.";
});

export const deleteKbAction = formAction(async (fd) => {
  const { actor } = await me();
  await growth.deleteKb(actor, str(fd, "id"));
  rv();
  return "Deleted.";
});

export const addSuppressionAction = formAction(async (fd) => {
  const { actor } = await me();
  await growth.addSuppression(actor, str(fd, "channel") as "EMAIL" | "SMS" | "ALL", str(fd, "address"), str(fd, "reason") || "MANUAL");
  rv();
  return "Suppressed.";
});

export const removeSuppressionAction = formAction(async (fd) => {
  const { actor } = await me();
  await growth.removeSuppression(actor, str(fd, "id"));
  rv();
  return "Removed.";
});

export const saveCampaignAction = formAction(async (fd) => {
  const { actor } = await me();
  const code = await growth.saveCampaign(actor, {
    code: str(fd, "code"), name: str(fd, "name"), audience: str(fd, "audience") === "CLINIC" ? "CLINIC" : "PROVIDER", kind: str(fd, "kind") || "other",
    schoolName: optStr(fd, "schoolName") ?? undefined, headline: optStr(fd, "headline") ?? undefined, body: optStr(fd, "body") ?? undefined, spendCents: dollarsToCents(str(fd, "spend")) ?? 0, active: fd.has("active") ? bool(fd, "active") : true,
  });
  rv();
  return `Saved /join/${code}.`;
});

export const saveMarketAction = formAction(async (fd) => {
  const { actor } = await me();
  await growth.saveMarket(actor, {
    key: str(fd, "key"), name: str(fd, "name"), state: str(fd, "state") || "FL", centerLat: Number(str(fd, "centerLat")), centerLng: Number(str(fd, "centerLng")),
    radiusMiles: Number(str(fd, "radiusMiles") || 60), targetProviders: Number(str(fd, "targetProviders") || 5), priority: Number(str(fd, "priority") || 100), active: bool(fd, "active"),
  });
  rv();
  return "Saved.";
});
