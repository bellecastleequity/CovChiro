"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";

/**
 * Lesson completion is kept in this browser only (no account data), keyed by
 * user and course. Storage can be unavailable (private mode, blocked site
 * data), so every access is guarded and the page works without it.
 */
const key = (userId: string, course: string) => `academy:${course}:${userId}`;
const EVENT = "academy-progress";

export function readDone(userId: string, course: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(userId, course)) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function markDone(userId: string, course: string, slug: string) {
  try {
    const done = new Set(readDone(userId, course));
    done.add(slug);
    localStorage.setItem(key(userId, course), JSON.stringify([...done]));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* storage unavailable: progress just isn't remembered */
  }
}

function useDone(userId: string, course: string) {
  const [done, setDone] = useState<string[]>([]);
  useEffect(() => {
    const sync = () => setDone(readDone(userId, course));
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => (window.removeEventListener(EVENT, sync), window.removeEventListener("storage", sync));
  }, [userId, course]);
  return done;
}

export function CourseProgress({ userId, course, slugs }: { userId: string; course: string; slugs: string[] }) {
  const done = useDone(userId, course).filter((s) => slugs.includes(s));
  const pct = Math.round((done.length / Math.max(1, slugs.length)) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-slate-900">{done.length === slugs.length ? "Course complete" : `${done.length} of ${slugs.length} lessons complete`}</span>
        <span className="tabular-nums text-slate-500">{pct}%</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-accent-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function DoneMark({ userId, course, slug, index }: { userId: string; course: string; slug: string; index: number }) {
  const done = useDone(userId, course).includes(slug);
  return done ? (
    <CheckCircle2 className="size-8 shrink-0 text-emerald-600" aria-label="Completed" />
  ) : (
    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white">{index}</span>
  );
}
