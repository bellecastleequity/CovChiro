import { addressDecision, countryOf, outreachStepDue } from "@cm/core";
import { prisma } from "@cm/db";
import { DateTime } from "luxon";
import { clock, getSettings, requireAdmin, type Actor } from "../context";
import { CLINIC_OUTREACH_ORDER, approvedPiKeys, clinicOutreachWhere, outreachKey } from "./agents";
import { agentOn, isSuppressed, livePrompts, marketingOn, normEmail } from "./engine";
import { addressHistories } from "./addresses";
import { outreachProfessionFor } from "./expansion";
import { activePairs, marketRank, providerOutreachKey, providerOutreachWhere } from "./providers";
import { inOutreachWindow, outreachSideAllowance, priorityContext } from "./priority";

/**
 * Growth → "Ready to go out": researched prospects whose next email is due at the next send window,
 * in the order the outreach sweeps will take them (agents.outreachSweep, providers.providerOutreachSweep).
 * In auto mode the sweep writes and sends in one step inside the window, so these never sit in the
 * queue; this is the view of what the next window will send. Read only: nothing here sends.
 */

/** When the next send window opens (now, when it's already open). */
export async function nextSendAt(now = clock.now()) {
  const s = await getSettings();
  if (await inOutreachWindow()) return { at: now, open: true };
  const zone = s["growth.outreachTimeZone"];
  const [h, m] = s["growth.outreachSendFrom"].split(":").map(Number);
  const from = h * 60 + m;
  const local = DateTime.fromJSDate(now, { zone });
  for (let i = 0; i < 8; i++) {
    const d = local.plus({ days: i }).startOf("day").plus({ minutes: from });
    if (s["growth.outreachSendDays"].includes(d.weekday % 7) && +d > +now) return { at: d.toJSDate(), open: false };
  }
  return { at: null, open: false };
}

export interface UpNextRow {
  id: string;
  kind: "CLINIC" | "PROVIDER";
  name: string;
  email: string;
  where: string;
  step: number;
  emailKey: string;
  /** Inside the next window's allowance (else a later window). */
  nextWindow: boolean;
}

export async function upNext(actor: Actor, opts: { limit?: number } = {}) {
  requireAdmin(actor);
  const s = await getSettings();
  const now = clock.now();
  const send = await nextSendAt(now);
  const sendAt = send.at ?? now;
  const sameDay = send.open || DateTime.fromJSDate(sendAt, { zone: "America/New_York" }).hasSame(DateTime.fromJSDate(now, { zone: "America/New_York" }), "day");
  const limit = opts.limit ?? 100;
  const pending = async (type: string, ids: string[]) =>
    new Set((await prisma.communication.findMany({ where: { entityType: type, entityId: { in: ids }, status: { in: ["PENDING_APPROVAL", "QUEUED"] } }, select: { entityId: true } })).map((c) => c.entityId));

  // ---- clinics ----
  const clinic: UpNextRow[] = [];
  const clinicOn = (await agentOn("clinicOutreach")) && (await marketingOn("clinic"));
  const clinicAllow = await outreachSideAllowance("DEMAND");
  const clinicSlots = sameDay ? clinicAllow.remaining : clinicAllow.cap;
  if (clinicOn) {
    const gaps = s["growth.outreachGapDays"];
    const rows = await prisma.clinicProspect.findMany({ where: clinicOutreachWhere(gaps.length), orderBy: CLINIC_OUTREACH_ORDER, take: Math.max(limit, s["growth.dailyOutreachCap"]) * 4 });
    const ctx = await priorityContext();
    rows.sort((a, b) => ctx.rank("DEMAND", a.state, a.marketKey) - ctx.rank("DEMAND", b.state, b.marketKey));
    const held = await pending("PROSPECT", rows.map((r) => r.id));
    const allowed = new Map<string, boolean>();
    const piReady = await approvedPiKeys();
    const history = await addressHistories("PROSPECT", rows.map((r) => r.email));
    const used = new Set<string>();
    for (const c of rows) {
      if (clinic.length >= limit) break;
      if (held.has(c.id) || !c.email) continue;
      // Same rule as the sweep: a shared inbox gets each email once, one per window.
      const addr = normEmail(c.email);
      const d = addressDecision(c.outreachStep, c.lastContactedAt, history.get(addr)!, used.has(addr));
      if (d.action !== "SEND") continue;
      if (!outreachStepDue(c.outreachStep, d.lastContactedAt, gaps, sendAt)) continue;
      if (!(await outreachProfessionFor(c, allowed))) continue;
      if (await isSuppressed("EMAIL", c.email)) continue;
      used.add(addr);
      clinic.push({ id: c.id, kind: "CLINIC", name: c.clinicName, email: c.email, where: [c.city, c.state].filter(Boolean).join(", "), step: c.outreachStep, emailKey: outreachKey(c.outreachStep, c.practiceType, piReady), nextWindow: clinic.length < clinicSlots });
    }
  }

  // ---- providers ----
  const provider: UpNextRow[] = [];
  const providerOn = (await agentOn("providerOutreach")) && (await marketingOn("provider"));
  const providerAllow = await outreachSideAllowance("SUPPLY");
  const providerSlots = sameDay ? providerAllow.remaining : providerAllow.cap;
  const pairs = providerOn ? await activePairs() : [];
  if (pairs.length) {
    const gaps = s["growth.providerOutreachGapDays"];
    const rows = await prisma.providerProspect.findMany({ where: providerOutreachWhere(gaps.length, pairs), orderBy: [{ outreachStep: "desc" }, { createdAt: "asc" }], take: Math.max(limit, s["growth.dailyOutreachCap"]) * 4 });
    const rank = await marketRank();
    const ctx = await priorityContext();
    rows.sort((a, b) => ctx.rank("SUPPLY", a.state, a.marketKey) - ctx.rank("SUPPLY", b.state, b.marketKey) || rank(a.marketKey) - rank(b.marketKey));
    const held = await pending("PROVIDER_PROSPECT", rows.map((r) => r.id));
    const ready = new Map<string, boolean>();
    const history = await addressHistories("PROVIDER_PROSPECT", rows.map((r) => r.email));
    const used = new Set<string>();
    for (const p of rows) {
      if (provider.length >= limit) break;
      if (held.has(p.id) || !p.email) continue;
      const addr = normEmail(p.email);
      const d = addressDecision(p.outreachStep, p.lastContactedAt, history.get(addr)!, used.has(addr));
      if (d.action !== "SEND") continue;
      if (!outreachStepDue(p.outreachStep, d.lastContactedAt, gaps, sendAt)) continue;
      if (countryOf(p.state) === "CA" && p.outreachStep > 0) continue;
      const key = providerOutreachKey(p);
      const rk = `${p.professionCode}:${key}`;
      if (!ready.has(rk)) ready.set(rk, (await livePrompts(key, p.professionCode)).length > 0);
      if (!ready.get(rk)) continue;
      if (await isSuppressed("EMAIL", p.email)) continue;
      used.add(addr);
      provider.push({ id: p.id, kind: "PROVIDER", name: p.displayName, email: p.email, where: [p.city, p.state].filter(Boolean).join(", "), step: p.outreachStep, emailKey: key, nextWindow: provider.length < providerSlots });
    }
  }

  return {
    sendAt: send.at, windowOpen: send.open,
    mode: { clinic: s["growth.outreachMode"] === "auto" ? "auto" : "review", provider: s["growth.providerOutreachMode"] === "auto" ? "auto" : "review" },
    clinic: { on: clinicOn, slots: clinicSlots, rows: clinic },
    provider: { on: providerOn, slots: providerSlots, rows: provider },
  };
}
