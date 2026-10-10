"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { admin, growth, spam } from "@cm/services";
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

export const bulkApprovalAction = formAction(async (fd) => {
  const { actor } = await me();
  const ids = fd.getAll("ids").map(String).filter(Boolean);
  if (!ids.length) return "Nothing selected.";
  const decision = str(fd, "decision") === "reject" ? "reject" : "approve";
  const r = await growth.bulkDecide(actor, ids, decision);
  rv();
  return decision === "approve"
    ? `Approved ${r.count}. They're sending now, a batch every minute (still checked against do-not-contact and your daily limits).`
    : `Rejected ${r.count}. Outreach to those prospects is paused.`;
});

export const instagramAction = formAction(async (fd) => {
  const { actor } = await me();
  const ids = fd.getAll("ids").map(String).filter(Boolean);
  if (!ids.length) return "Nothing selected.";
  const d = str(fd, "decision");
  const decision = d === "skip" || d === "followed" || d === "review" ? d : "approve";
  const r = await growth.instagramDecide(actor, ids, decision);
  rv();
  return { approve: `Added ${r.count} to the follow queue.`, skip: `Skipped ${r.count}.`, followed: `Marked ${r.count} as followed.`, review: `Moved ${r.count} back to review.` }[decision];
});

export const instagramHandleAction = formAction(async (fd) => {
  const { actor } = await me();
  const h = await growth.setInstagramHandle(actor, str(fd, "prospectId"), str(fd, "handle"));
  rv();
  revalidatePath(`/admin/growth/prospects/${str(fd, "prospectId")}`);
  return h ? `Instagram set to @${h}.` : "Instagram handle cleared.";
});

export const escalationAction = formAction(async (fd) => {
  const { actor } = await me();
  await growth.updateEscalation(actor, str(fd, "id"), str(fd, "status") as "OPEN" | "IN_PROGRESS" | "RESOLVED", optStr(fd, "resolution"));
  rv();
  return "Updated.";
});

// ---------- spam folder ----------
const blockOf = (fd: FormData) => (str(fd, "block") === "EMAIL" ? "EMAIL" : str(fd, "block") === "DOMAIN" ? "DOMAIN" : null);

export const escalationSpamAction = formAction(async (fd) => {
  const { actor } = await me();
  const isSpam = str(fd, "spam") === "true";
  const block = blockOf(fd);
  await spam.setEscalationSpam(actor, str(fd, "id"), isSpam, block);
  rv();
  return isSpam ? `Moved to Spam${block ? ` and ${block === "DOMAIN" ? "the domain" : "the sender"} blocked` : ""}.` : "Moved back to the open queue.";
});

export const blockSenderAction = formAction(async (fd) => {
  const { actor } = await me();
  const row = await spam.blockSender(actor, str(fd, "value"), str(fd, "kind") === "DOMAIN" ? "DOMAIN" : "EMAIL", optStr(fd, "reason"));
  rv();
  return `Blocked ${row.value}. Their form messages now go straight to Spam.`;
});

export const unblockSenderAction = formAction(async (fd) => {
  const { actor } = await me();
  await spam.unblockSender(actor, str(fd, "id"));
  rv();
  return "Unblocked.";
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

export const addClinicByHandAction = formAction(async (fd) => {
  const { actor } = await me();
  const r = await growth.addClinicByHand(actor, {
    clinicName: str(fd, "clinicName"), email: str(fd, "email"), ownerName: optStr(fd, "ownerName"), city: optStr(fd, "city"), state: str(fd, "state") || "FL",
    zip: optStr(fd, "zip"), phone: optStr(fd, "phone"), website: optStr(fd, "website"), notes: optStr(fd, "notes"),
    start: (["now", "auto", "save"].includes(str(fd, "start")) ? str(fd, "start") : "auto") as "now" | "auto" | "save",
  });
  rv();
  const notice = r.existed ? "exists" : r.sent && "subject" in r.sent ? "sent" : r.sent ? "notsent" : str(fd, "start") === "save" ? "saved" : "added";
  redirect(`/admin/growth/prospects/${r.prospect.id}?added=${notice}#outreach`);
});

export const sendFirstOutreachAction = formAction(async (fd) => {
  const { actor } = await me();
  const r = await growth.sendFirstOutreachNow(actor, str(fd, "id"));
  rv();
  return `Sent: "${r.subject}". The follow-ups go out automatically when clinic outreach is on.`;
});

export const importProviderProspectsAction = formAction(async (fd) => {
  const { actor } = await me();
  const file = fd.get("file");
  const csv = file instanceof File && file.size ? await file.text() : str(fd, "csv");
  const r = await growth.importProviderProspects(actor, csv, str(fd, "source") || `CSV import ${new Date().toISOString().slice(0, 10)}`, str(fd, "professionCode") || "DC");
  rv();
  const why = Object.entries(r.reasons).map(([k, n]) => `${n} × ${growth.PROVIDER_IMPORT_REASONS[k] ?? k}`).join("; ");
  return `Imported: ${r.inserted} new, ${r.updated} updated, ${r.withEmail} with a usable email, ${r.skipped} skipped.${why ? ` Details: ${why}.` : ""}`;
});

export const importProspectsAction = formAction(async (fd) => {
  const { actor } = await me();
  const file = fd.get("file");
  const csv = file instanceof File && file.size ? await file.text() : str(fd, "csv");
  const r = await growth.importProspects(actor, csv, str(fd, "source") || `CSV import ${new Date().toISOString().slice(0, 10)}`);
  rv();
  return `Imported: ${r.inserted} new, ${r.updated} updated, ${r.skipped} skipped.`;
});

export const runProspectingAction = formAction(async (fd) => {
  const { actor } = await me();
  const cities = str(fd, "cities").split(",").map((c) => c.trim()).filter(Boolean);
  const r = await growth.runProspectingNow(actor, cities);
  rv();
  const d = r.discovery as { cities?: string[]; practices?: number; inserted?: number; errors?: string[]; skipped?: string };
  if (d.skipped) return "Clinic Prospecting is switched off (Growth → Overview → Agents).";
  const parts: string[] = [];
  if (d.cities?.length) parts.push(`Searched ${d.cities.join(", ")}: ${d.practices ?? 0} practice locations, ${d.inserted ?? 0} new.`);
  else if (!d.errors?.length) parts.push("Every city was searched recently; nothing new to search.");
  if (d.errors?.length) parts.push(`The NPI registry couldn't be reached (${d.errors.join("; ")}).`);
  const stop: Record<string, string> = { ai_unavailable: "Web research needs an AI key.", budget: "Web research stopped: today's research budget is used up.", paused: "Web research is paused (see the notice).", request_cap: "Web research stopped: today's request cap is reached.", quota: "Web research paused: the AI account is out of credits.", rate_limited: "Web research paused briefly: the AI provider is rate-limiting.", auth: "Web research paused: the API key was refused." };
  parts.push(`Researched ${r.research.researched} on the web (${r.research.notFound} not found, ${r.research.failed} failed).${r.research.stopped && stop[r.research.stopped] ? ` ${stop[r.research.stopped]}` : ""}`);
  return parts.join(" ");
});

export const researchProspectAction = formAction(async (fd) => {
  const { actor } = await me();
  const res = await growth.researchNow(actor, str(fd, "id"));
  rv();
  const msg: Record<string, string> = {
    done: "Researched: new details filled in.", not_found: "Research couldn't confidently find this practice online.", failed: "Research failed; see agent activity.",
    ai_unavailable: "Web research needs an AI key (OPENAI_API_KEY for the default research model).", budget: "Today's research budget is used up.", skipped: "Research is already running for this clinic.",
    paused: "Web research is paused (see the notice on Prospecting).", request_cap: "Today's research request cap is reached (Settings → Growth).",
    quota: "The AI account is out of credits; research is paused. Add a balance with the provider, then resume.", rate_limited: "The AI provider is rate-limiting; research paused for a few minutes and this clinic is back in the queue.",
    auth: "The AI provider refused the API key; research is paused.", transient: "The AI provider had a temporary problem; this clinic is back in the queue.",
  };
  return msg[res] ?? `Research: ${res}`;
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
    key: str(fd, "key"), professionCode: optStr(fd, "professionCode"), agent: str(fd, "agent"), channel: "EMAIL", purpose: str(fd, "purpose"), subjectTemplate: optStr(fd, "subjectTemplate"), body: str(fd, "body"),
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
  await growth.saveKb(actor, { id: optStr(fd, "id") ?? undefined, professionCode: optStr(fd, "professionCode"), topic: str(fd, "topic"), audience: str(fd, "audience"), question: str(fd, "question"), answer: str(fd, "answer"), keywords: str(fd, "keywords"), approved: bool(fd, "approved"), active: bool(fd, "active") });
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
    geography: optStr(fd, "geography"), professionCode: optStr(fd, "professionCode"),
  });
  rv();
  return `Saved /join/${code}.`;
});

export const saveMarketAction = formAction(async (fd) => {
  const { actor } = await me();
  await growth.saveMarket(actor, {
    key: str(fd, "key"), name: str(fd, "name"), state: str(fd, "state") || "FL", professionCode: str(fd, "professionCode") || undefined, centerLat: Number(str(fd, "centerLat")), centerLng: Number(str(fd, "centerLng")),
    radiusMiles: Number(str(fd, "radiusMiles") || 60), targetProviders: Number(str(fd, "targetProviders") || 5), priority: Number(str(fd, "priority") || 100), active: bool(fd, "active"),
  });
  rv();
  return "Saved.";
});

// ---------- expansion ----------
export const targetStatusAction = formAction(async (fd) => {
  const { actor } = await me();
  const t = await growth.setTargetStatus(actor, str(fd, "professionCode"), str(fd, "state"), str(fd, "status") as growth.TargetStatus);
  rv();
  return t.status === "OFF" ? "Off." : t.status === "PRELAUNCH" ? `Prelaunch: bots are researching ${t.cities.length} cities.` : "Live: clinic outreach can run here.";
});
export const targetCitiesAction = formAction(async (fd) => {
  const { actor } = await me();
  const t = await growth.saveTargetCities(actor, str(fd, "professionCode"), str(fd, "state"), str(fd, "cities").split(/[\n,;]+/), optStr(fd, "notes"));
  rv();
  return `Saved ${t.cities.length} cities.`;
});
export const starterCitiesAction = formAction(async (fd) => {
  const { actor } = await me();
  const state = str(fd, "state").toUpperCase();
  const t = await growth.saveTargetCities(actor, str(fd, "professionCode"), state, growth.STATE_CITIES[state] ?? []);
  rv();
  return `Loaded ${t.cities.length} starter cities.`;
});
export const growthProfessionAction = formAction(async (fd) => {
  const { actor } = await me();
  await growth.saveGrowthProfession(actor, {
    professionCode: str(fd, "professionCode"), registrySearch: str(fd, "registrySearch"), taxonomyCodes: str(fd, "taxonomyCodes").split(/[\s,]+/),
    practiceNoun: str(fd, "practiceNoun"), nameSuffix: str(fd, "nameSuffix"),
  });
  rv();
  return "Saved.";
});
export const starterDraftsAction = formAction(async (fd) => {
  const { actor } = await me();
  const n = await growth.createStarterDrafts(actor, str(fd, "professionCode"));
  rv();
  return n ? `Created ${n} draft emails. Review and approve them under Prompts.` : "Nothing to create: drafts or approved versions already exist.";
});

// ---------- provider acquisition ----------
export const providerProspectAction = formAction(async (fd) => {
  const { actor } = await me();
  const id = str(fd, "id");
  const op = str(fd, "op");
  if (op === "research") {
    const r = await growth.discoverContact(id, { force: true });
    rv();
    return `Contact discovery: ${String(r).replace(/_/g, " ")}.`;
  }
  if (op === "verify") {
    const r = await growth.verifyContact(id);
    rv();
    return `Email check: ${String(r).replace(/_/g, " ")}.`;
  }
  if (op === "reply") {
    const r = await growth.logProviderReply(actor, id, str(fd, "text"), optStr(fd, "subject") ?? undefined);
    rv();
    return `Logged. Outcome: ${String(r).replace(/[_:]/g, " ")}.`;
  }
  if (op === "merge") {
    await growth.mergeProviderProspects(actor, id, str(fd, "dropId"));
    rv();
    return "Merged.";
  }
  await growth.updateProviderProspect(actor, id, {
    ...(op === "email" ? { email: optStr(fd, "email") } : {}),
    ...(op === "suppress" ? { doNotContact: true } : {}),
    ...(op === "unsuppress" ? { doNotContact: false } : {}),
    ...(op === "approve" ? { clearReview: true } : {}),
    ...(op === "pause" ? { outreachPaused: true } : {}),
    ...(op === "resume" ? { outreachPaused: false } : {}),
    ...(op === "details" ? { notes: optStr(fd, "notes"), campaignCode: optStr(fd, "campaignCode"), practiceRole: str(fd, "practiceRole") || undefined } : {}),
  });
  rv();
  return "Saved.";
});

export const costAction = formAction(async (fd) => {
  const { actor } = await me();
  if (str(fd, "op") === "delete") await growth.deleteCost(actor, str(fd, "id"));
  else await growth.addCost(actor, { month: str(fd, "month"), category: str(fd, "category"), audience: str(fd, "audience"), amountCents: dollarsToCents(str(fd, "amount")) ?? 0, campaignCode: optStr(fd, "campaignCode"), notes: optStr(fd, "notes") });
  rv();
  return "Saved.";
});

export const repurposeAction = formAction(async (fd) => {
  const { actor } = await me();
  const r = await growth.repurposePost(actor, str(fd, "postId"), str(fd, "target") as "kb" | "email" | "social");
  rv();
  return r.text;
});

export const outreachModeAction = formAction(async (fd) => {
  const { actor } = await me();
  const key = str(fd, "which") === "provider" ? "growth.providerOutreachMode" : "growth.outreachMode";
  await admin.updateSetting(actor, key, str(fd, "mode") === "auto" ? "auto" : "review");
  rv();
  return "Saved.";
});

export const runContactDiscoveryAction = formAction(async () => {
  await me();
  const out = await growth.contactDiscoverySweep({ wallMs: 90_000 });
  rv();
  return `Checked ${out.checked}: ${out.found} contacts found (${out.verified} verified), ${out.notFound} without a usable email, ${out.ambiguous} to review.${out.stopped ? ` Stopped: ${out.stopped.replace(/_/g, " ")}.` : ""}`;
});

export const tagMarketAction = formAction(async (fd) => {
  const { actor } = await me();
  const n = await growth.tagMarketProspects(actor, str(fd, "market"), str(fd, "campaign"));
  rv();
  return `Tagged ${n} prospect${n === 1 ? "" : "s"}.`;
});

export const retryFailedAction = formAction(async (fd) => {
  const { actor } = await me();
  const n = await growth.retryFailedResearch(actor, str(fd, "side") === "providers" ? "providers" : "clinics");
  rv();
  return `${n} back in the research queue. They'll be researched over the next runs.`;
});

export const resumeResearchAction = formAction(async () => {
  const { actor } = await me();
  await growth.resumeResearchNow(actor);
  rv();
  return "Research resumed. It continues on the next run (every 10 minutes).";
});
