import { brand } from "@cm/config";
import { formatUsPhone, normalizeUsPhone } from "@cm/core";
import { prisma } from "@cm/db";
import { smsProvider } from "@cm/integrations";
import { DomainError } from "@cm/core";
import { clock, getSettings, requireAdmin, type Actor } from "./context";
import { notifyAdmins } from "./notify";

/**
 * Admin → Texts (owner, Oct 2026: business line (855) 55-COVER for call and text). Texts to the
 * business number that aren't shift-offer replies or STOP/START/HELP land here (dispatch.handleInboundSms),
 * admins are alerted (in-app + push; one email per conversation burst to the support inbox), the sender
 * gets one automatic reply (sms.inboxAutoReply, not again within 12 h), and the team replies from the
 * business number. Never to a number that texted STOP.
 */

const AUTO_REPLY_GAP_MS = 12 * 3_600_000;
const ALERT_GAP_MS = 30 * 60_000;

/** Who a number belongs to: a login with that phone, else a clinic's main or backup line. */
async function whoIs(phone: string) {
  const user = await prisma.user.findFirst({ where: { phone }, select: { id: true, name: true, role: true }, orderBy: { phoneVerifiedAt: { sort: "desc", nulls: "last" } } });
  if (user) return { userId: user.id, name: user.name, kind: user.role === "PROVIDER" ? "Provider" : user.role === "PLATFORM_ADMIN" ? "Admin" : "Clinic" };
  const org = await prisma.clinicOrg.findFirst({ where: { OR: [{ phone }, { backupPhone: phone }] }, select: { displayName: true, members: { where: { role: "CLINIC_OWNER" }, select: { userId: true }, take: 1 } } });
  if (org) return { userId: org.members[0]?.userId ?? null, name: org.displayName, kind: "Clinic" };
  return { userId: null, name: null, kind: null };
}

/** A text from someone to the business number. Returns the automatic reply to send back ("" = none). */
export async function receiveText(rawPhone: string, body: string): Promise<string> {
  const phone = normalizeUsPhone(rawPhone) ?? rawPhone.trim();
  const text = body.trim().slice(0, 1600);
  if (!text) return "";
  const now = clock.now();
  const [who, lastIn, lastAuto] = await Promise.all([
    whoIs(phone),
    prisma.textMessage.findFirst({ where: { phone, direction: "IN" }, orderBy: { createdAt: "desc" } }),
    prisma.textMessage.findFirst({ where: { phone, direction: "OUT", authorUserId: null }, orderBy: { createdAt: "desc" } }),
  ]);
  await prisma.textMessage.create({ data: { phone, direction: "IN", body: text, userId: who.userId } });

  if (!lastIn || +now - +lastIn.createdAt > ALERT_GAP_MS) {
    const from = who.name ? `${who.name} (${who.kind}, ${formatUsPhone(phone)})` : formatUsPhone(phone);
    await notifyAdmins(prisma, {
      template: "support_text_in", title: `New text from ${from}`, body: text.length > 280 ? `${text.slice(0, 277)}…` : text,
      link: `/admin/texts?p=${encodeURIComponent(phone)}`, ctaLabel: "Reply", sms: false,
    }).catch(() => undefined);
  }

  const s = await getSettings();
  const template = s["sms.inboxAutoReply"].trim();
  if (!template || (lastAuto && +now - +lastAuto.createdAt < AUTO_REPLY_GAP_MS)) return "";
  const reply = template.replaceAll("{brand}", brand().name);
  await prisma.textMessage.create({ data: { phone, direction: "OUT", body: reply, userId: who.userId, status: "SENT" } });
  return reply;
}

export async function unreadTexts() {
  return prisma.textMessage.count({ where: { direction: "IN", readAt: null } });
}

/** Conversations, newest first: last message, unread count, who it is. */
export async function conversations(actor: Actor, limit = 100) {
  requireAdmin(actor);
  const latest = await prisma.textMessage.groupBy({ by: ["phone"], _max: { createdAt: true }, orderBy: { _max: { createdAt: "desc" } }, take: limit });
  const phones = latest.map((l) => l.phone);
  const [lastRows, unread] = await Promise.all([
    prisma.textMessage.findMany({ where: { phone: { in: phones } }, orderBy: { createdAt: "desc" }, distinct: ["phone"], include: { user: { select: { name: true, role: true } } } }),
    prisma.textMessage.groupBy({ by: ["phone"], where: { phone: { in: phones }, direction: "IN", readAt: null }, _count: { _all: true } }),
  ]);
  const last = new Map(lastRows.map((r) => [r.phone, r]));
  const unreadBy = new Map(unread.map((u) => [u.phone, u._count._all]));
  const names = await Promise.all(phones.map(async (p) => [p, last.get(p)?.user?.name ?? (await whoIs(p)).name] as const));
  const nameBy = new Map(names);
  return phones.map((p) => ({ phone: p, label: formatUsPhone(p), name: nameBy.get(p) ?? null, last: last.get(p)!, unread: unreadBy.get(p) ?? 0 }));
}

export async function thread(actor: Actor, rawPhone: string) {
  requireAdmin(actor);
  const phone = normalizeUsPhone(rawPhone) ?? rawPhone;
  const [messages, who, stopped] = await Promise.all([
    prisma.textMessage.findMany({ where: { phone }, orderBy: { createdAt: "asc" }, take: 500 }),
    whoIs(phone),
    (async () => (await import("./growth/engine")).isSuppressed("SMS", phone))(),
  ]);
  const authors = await prisma.user.findMany({ where: { id: { in: [...new Set(messages.map((m) => m.authorUserId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  const authorName = new Map(authors.map((a) => [a.id, a.name]));
  return { phone, label: formatUsPhone(phone), who, stopped, messages: messages.map((m) => ({ ...m, authorName: m.authorUserId ? authorName.get(m.authorUserId) ?? "Admin" : null })) };
}

export async function markRead(actor: Actor, rawPhone: string) {
  requireAdmin(actor);
  const phone = normalizeUsPhone(rawPhone) ?? rawPhone;
  await prisma.textMessage.updateMany({ where: { phone, direction: "IN", readAt: null }, data: { readAt: clock.now() } });
}

/** Reply from the business number. Refused for a number that texted STOP. */
export async function sendText(actor: Actor, rawPhone: string, body: string) {
  requireAdmin(actor);
  const phone = normalizeUsPhone(rawPhone);
  if (!phone) throw new DomainError("VALIDATION", "That isn't a U.S. mobile number.");
  const text = body.trim();
  if (!text) throw new DomainError("VALIDATION", "Write a message first.");
  if (text.length > 600) throw new DomainError("VALIDATION", "Keep a text under 600 characters (it's split into several texts above 160).");
  const { isSuppressed } = await import("./growth/engine");
  if (await isSuppressed("SMS", phone)) throw new DomainError("VALIDATION", "This number texted STOP, so we can't text it. They can text START to opt back in.");
  const { ok, error } = await sendFromTextingNumber(phone, text, actor.userId);
  await prisma.textMessage.updateMany({ where: { phone, direction: "IN", readAt: null }, data: { readAt: clock.now() } });
  if (!ok) throw new DomainError("VALIDATION", `Not sent: ${error}`);
  return { sent: true };
}

/** Sends from the AWS texting number and keeps it in the Texts thread (author null = sent by the system). */
export async function sendFromTextingNumber(phone: string, text: string, authorUserId: string | null) {
  const texter = smsProvider();
  const ok = await texter.send(phone, text).catch(() => false);
  const error = ok ? null : ((texter as { lastError?: string | null }).lastError ?? "The texting service refused the message.");
  const who = await whoIs(phone);
  await prisma.textMessage.create({ data: { phone, direction: "OUT", body: text, userId: who.userId, authorUserId, status: ok ? "SENT" : "FAILED", error } });
  return { ok, error };
}
