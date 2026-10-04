import { brand } from "@cm/config";
import { US_STATES } from "@cm/core";
import { prisma, type Lead } from "@cm/db";
import { absoluteUrl, sendEmail } from "./notify";

/**
 * Waitlist openings: when a profession opens in a state (ProfessionStateConfig and
 * StateConfig enabled, profession active), everyone on the waitlist for that state
 * and profession (or "any profession" in that state) gets one "we're open" email.
 * Hourly sweep; also runs at sign-up so joining for an already-open market gets the
 * good news straight away instead of a "you're on the list" email.
 */

type Pair = { professionCode: string; noun: string; slug: string; state: string };

export async function livePairs(): Promise<Pair[]> {
  const [rows, states] = await Promise.all([
    prisma.professionStateConfig.findMany({ where: { enabled: true, profession: { active: true } }, include: { profession: true } }),
    prisma.stateConfig.findMany({ where: { enabled: true }, select: { state: true } }),
  ]);
  const open = new Set(states.map((s) => s.state));
  return rows.filter((r) => open.has(r.state)).map((r) => ({ professionCode: r.professionCode, noun: r.profession.displayName, slug: r.profession.slug, state: r.state }));
}

const key = (leadId: string, state: string, code: string | null) => `waitlist-open:${leadId}:${state}:${code ?? "ANY"}`;

async function sendOpening(lead: Lead, pairs: Pair[]): Promise<boolean> {
  const b = brand();
  const stateName = US_STATES[lead.state as keyof typeof US_STATES] ?? lead.state ?? "your state";
  const k = key(lead.id, lead.state!, lead.professionCode);
  // Claim first: one email per lead per opening, even with overlapping runs.
  try {
    await prisma.digestSend.create({ data: { key: k, userId: lead.convertedUserId ?? lead.id } });
  } catch {
    return false;
  }
  const nouns = [...new Set(pairs.map((p) => `${p.noun.toLowerCase()}s`))];
  const what = nouns.length === 1 ? nouns[0] : `${nouns.slice(0, -1).join(", ")} and ${nouns.at(-1)}`;
  const first = lead.name.split(" ")[0] || "there";
  const provider = lead.audience === "PROVIDER";
  const code = lead.professionCode ?? (pairs.length === 1 ? pairs[0].professionCode : null);
  const subject = `${b.name} is now open in ${stateName}`;
  const ok = await sendEmail(lead.email, {
    subject,
    heading: `We're open in ${stateName}`,
    paragraphs: [
      `Hi ${first},`,
      provider
        ? `Good news: ${b.name} is now live for ${what} in ${stateName}. Create your profile, get your license and malpractice verified, and start picking up coverage shifts on your schedule.`
        : `Good news: ${b.name} is now live in ${stateName}. You can book licensed, verified ${what} to cover your practice for a half day, a day or longer.`,
      "Thanks for waiting for us.",
    ],
    cta: provider
      ? { label: "Create your provider profile", url: absoluteUrl(`/signup?role=provider${code ? `&profession=${code}` : ""}`) }
      : { label: "Create your clinic account", url: absoluteUrl("/signup?role=clinic") },
    unsubscribeUrl: absoluteUrl(`/unsubscribe?token=${lead.unsubscribeToken}`),
  });
  // The waitlist sequence is done; this was the email they were waiting for.
  await prisma.lead.update({ where: { id: lead.id }, data: { nextDripAt: null, status: lead.status === "NURTURING" || lead.status === "NEW" ? "CONTACTED" : lead.status } });
  await prisma.leadActivity.create({ data: { leadId: lead.id, kind: "EMAIL_SENT", body: `${ok ? "Sent" : "FAILED"}: ${subject}` } });
  return ok;
}

/** If this waitlist lead's state + profession is already open, send the opening email now. */
export async function notifyIfOpen(leadId: string, pairs?: Pair[]): Promise<boolean> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead || lead.source !== "waitlist" || !lead.state || lead.unsubscribedAt || ["UNSUBSCRIBED", "LOST"].includes(lead.status)) return false;
  const live = (pairs ?? (await livePairs())).filter((p) => p.state === lead.state && (!lead.professionCode || p.professionCode === lead.professionCode));
  if (!live.length) return false;
  return sendOpening(lead, live);
}

export async function waitlistOpeningSweep() {
  // Providers already enrolled there hear first (enrollment.announceOpenings).
  const enrolled = await (await import("./enrollment")).announceOpenings().catch(() => ({ sent: 0 }));
  const pairs = await livePairs();
  if (!pairs.length) return { sent: enrolled.sent };
  const states = [...new Set(pairs.map((p) => p.state))];
  const leads = await prisma.lead.findMany({
    where: { source: "waitlist", state: { in: states }, unsubscribedAt: null, status: { notIn: ["UNSUBSCRIBED", "LOST"] } },
    select: { id: true, state: true, professionCode: true },
    take: 2000,
  });
  const done = new Set((await prisma.digestSend.findMany({ where: { key: { startsWith: "waitlist-open:" } }, select: { key: true } })).map((d) => d.key));
  let sent = 0;
  for (const l of leads) {
    if (done.has(key(l.id, l.state!, l.professionCode))) continue;
    if (await notifyIfOpen(l.id, pairs)) sent++;
  }
  return { sent, enrolledProviders: enrolled.sent };
}
