import { prisma, type Prisma } from "@cm/db";
import { DateTime } from "luxon";
import { clock, getSettings } from "../context";
import { logAgent } from "./engine";

/**
 * Web-research health: when the AI provider refuses (out of credits, rate limit, bad key)
 * research pauses itself instead of burning every prospect's attempts. Records go back
 * in the queue untouched; a person can resume early from Prospecting.
 */
export type AiFailure = "quota" | "rate_limited" | "auth" | "transient" | "other";
const KEY = "growth.researchPause";
const PAUSE_MIN: Record<string, number> = { quota: 360, rate_limited: 10, daily_limit: 180, auth: 360 };

export function classifyAiError(error: string): AiFailure {
  const e = error.toLowerCase();
  if (/insufficient_quota|quota|billing|credit|balance/.test(e)) return "quota";
  if (/http 429|rate.?limit|too many requests/.test(e)) return "rate_limited";
  if (/http 40[13]|invalid.?api.?key|unauthori[sz]ed|permission/.test(e)) return "auth";
  if (/http 5\d\d|timeout|timed out|aborted|fetch failed|econnreset|socket|overloaded/.test(e)) return "transient";
  return "other";
}

export async function researchPause(): Promise<{ until: Date; reason: string; error: string } | null> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  const v = row?.value as { until?: string; reason?: string; error?: string } | null;
  if (!v?.until || new Date(v.until) <= clock.now()) return null;
  return { until: new Date(v.until), reason: v.reason ?? "paused", error: v.error ?? "" };
}

export async function pauseResearch(kind: AiFailure, error: string) {
  const daily = /per day|rpd|daily/i.test(error);
  const minutes = daily ? PAUSE_MIN.daily_limit : (PAUSE_MIN[kind] ?? 10);
  const until = new Date(+clock.now() + minutes * 60_000);
  const value = { until: until.toISOString(), reason: daily ? "daily_limit" : kind, error: error.slice(0, 300) } as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  await logAgent("clinicProspecting", "research_paused", { output: `Web research paused until ${until.toISOString()} (${daily ? "daily request limit" : kind.replace("_", " ")})`, error: error.slice(0, 300) });
}

export async function resumeResearch() {
  await prisma.setting.deleteMany({ where: { key: KEY } });
}

/** Research requests (clinic + provider contact) since midnight Eastern. */
export async function researchRequestsToday() {
  const since = DateTime.fromJSDate(clock.now(), { zone: "America/New_York" }).startOf("day").toJSDate();
  return prisma.aiUsage.count({ where: { task: "research", createdAt: { gte: since } } });
}

/** Can a research call start now? null = yes, else why not. */
export async function researchBlocked(): Promise<string | null> {
  if (await researchPause()) return "paused";
  const cap = (await getSettings())["growth.researchDailyRequestCap"];
  if (cap > 0 && (await researchRequestsToday()) >= cap) return "request_cap";
  return null;
}

/** After a failed call: transient/provider problems put the record back in the queue (no attempt counted). */
export async function handleResearchFailure(error: string): Promise<{ requeue: boolean; kind: AiFailure }> {
  const kind = classifyAiError(error);
  if (kind === "quota" || kind === "rate_limited" || kind === "auth") await pauseResearch(kind, error);
  return { requeue: kind !== "other", kind };
}
