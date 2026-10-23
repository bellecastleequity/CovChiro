import { brand } from "@cm/config";
import { DomainError, formatUsPhone, handoffFirstText, handoffNumber, handoffProblemSay, lastFourForVoice, normalizeUsPhone, type HandoffChoice } from "@cm/core";
import { prisma } from "@cm/db";
import { audit, clock, getSettings, requireAdmin, type Actor } from "./context";
import { notifyAdmins } from "./notify";
import { sendFromTextingNumber } from "./textinbox";

/**
 * The phone line's call menu (owner, Oct 23 2026). (855) 55-COVER is ported into Amazon Connect for calls
 * only; texts always come from the AWS texting number. The Connect flow asks "press 1 to continue by
 * text" (or "press 2 for a callback"), confirms the number ("the number you're calling from, ending in
 * 1234?") or takes 10 keyed-in digits, then calls /api/connect/menu (signed by the Lambda), which lands here.
 * Every answer includes `say`, the sentence the call plays next. Nothing here ever transfers a call.
 */

export type MenuAction = "lookup" | "text" | "callback";
export interface MenuInput { action: MenuAction; contactId: string; callerPhone?: string | null; choice?: HandoffChoice; digits?: string | null }
export interface MenuResult {
  /** done = the request went through (end or carry on); retry = ask for the number again; stay = continue the call. */
  result: "done" | "retry" | "stay";
  say: string;
  lastFour?: string | null;
  canText?: boolean;
}

const DAY = 86_400_000;

function callLine(s: Awaited<ReturnType<typeof getSettings>>) {
  return s["site.phoneLabel"].trim() || (s["site.phone"] ? formatUsPhone(s["site.phone"]) : "our phone line");
}

export async function callMenu(input: MenuInput): Promise<MenuResult> {
  const contactId = (input.contactId ?? "").trim().slice(0, 100);
  if (!contactId) throw new DomainError("VALIDATION", "contactId is required");
  const s = await getSettings();
  const callerPhone = normalizeUsPhone(input.callerPhone ?? "") ?? null;
  const canText = s["phone.textHandoff"];

  if (input.action === "lookup") {
    return { result: "done", say: "", lastFour: lastFourForVoice(callerPhone), canText };
  }

  const kind = input.action === "text" ? "TEXT" : "CALLBACK";
  const contactKey = `${contactId}:${kind}`;
  const done = await prisma.callLog.findUnique({ where: { contactKey } });
  if (done) return { result: done.outcome === "TEXT_SENT" || done.outcome === "CALLBACK_REQUESTED" ? "done" : "stay", say: sayFor(done.outcome, done.phone) };

  if (kind === "TEXT" && !canText) return { result: "stay", say: "Texting isn't available right now. Let's continue on the call." };
  const choice: HandoffChoice = input.choice === "other" ? "other" : "same";
  const target = handoffNumber({ choice, callerPhone: input.callerPhone, digits: input.digits }, (raw) => normalizeUsPhone(raw));
  if ("problem" in target) return { result: "retry", say: handoffProblemSay(target.problem) };
  const phone = target.phone;
  const log = (outcome: string, error: string | null = null) =>
    prisma.callLog.create({ data: { contactKey, kind, callerPhone, phone, choice, outcome, error } }).catch(() => null);

  if (kind === "CALLBACK") {
    await log("CALLBACK_REQUESTED");
    await notifyAdmins(prisma, {
      template: "phone_callback", title: `Call back ${formatUsPhone(phone)}`,
      body: `A caller to ${callLine(s)} asked for a callback at ${formatUsPhone(phone)}${callerPhone && callerPhone !== phone ? ` (called from ${formatUsPhone(callerPhone)})` : ""}.`,
      link: "/admin/calls", ctaLabel: "Open calls", sms: false,
    }).catch(() => undefined);
    return { result: "done", say: sayFor("CALLBACK_REQUESTED", phone) };
  }

  const { isSuppressed } = await import("./growth/engine");
  if (await isSuppressed("SMS", phone)) { await log("OPTED_OUT"); return { result: "stay", say: handoffProblemSay("opted_out") }; }
  const today = await prisma.callLog.count({ where: { kind: "TEXT", phone, outcome: "TEXT_SENT", createdAt: { gte: new Date(+clock.now() - DAY) } } });
  if (today >= s["phone.handoffPerDay"]) { await log("TOO_MANY"); return { result: "stay", say: handoffProblemSay("too_many") }; }

  const body = handoffFirstText(s["phone.handoffText"], brand().name, callLine(s));
  const sent = await sendFromTextingNumber(phone, body, null);
  if (!sent.ok) {
    await log("FAILED", sent.error);
    return { result: "stay", say: "Sorry, we couldn't send the text just now. Let's continue on the call." };
  }
  await log("TEXT_SENT");
  return { result: "done", say: sayFor("TEXT_SENT", phone) };
}

function sayFor(outcome: string, phone: string | null) {
  const four = lastFourForVoice(phone);
  if (outcome === "TEXT_SENT") return `We've just sent a text to the number ending in ${four}. Reply there and our team will take it from here. You can hang up now. Thanks for calling.`;
  if (outcome === "CALLBACK_REQUESTED") return `Thanks. Someone from our team will call you back at the number ending in ${four}. You can hang up now.`;
  if (outcome === "OPTED_OUT") return handoffProblemSay("opted_out");
  if (outcome === "TOO_MANY") return handoffProblemSay("too_many");
  return "Let's continue on the call.";
}

// ---------------- Admin → Calls ----------------

export async function unhandledCallbacks() {
  return prisma.callLog.count({ where: { kind: "CALLBACK", outcome: "CALLBACK_REQUESTED", handledAt: null } });
}

export async function adminCalls(actor: Actor, limit = 200) {
  requireAdmin(actor);
  return prisma.callLog.findMany({ orderBy: [{ createdAt: "desc" }], take: limit });
}

export async function markHandled(actor: Actor, id: string, handled = true) {
  requireAdmin(actor);
  const row = await prisma.callLog.update({ where: { id }, data: handled ? { handledAt: clock.now(), handledById: actor.userId } : { handledAt: null, handledById: null } });
  await audit(prisma, actor, handled ? "call.handled" : "call.reopened", "CallLog", id, null, { phone: row.phone });
}
