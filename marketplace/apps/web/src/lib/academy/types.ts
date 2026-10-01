import type { SettingsMap } from "@cm/config";

/** Who a course is for. Each audience gets its own course under its own app area. */
export type Audience = "clinic" | "provider";

export interface QuizQuestion {
  q: string;
  options: string[];
  /** Index into options. */
  answer: number;
  /** Shown after answering, right or wrong. */
  why: string;
}

/**
 * One lesson. Content is a function of live Settings so every number a lesson
 * quotes (deposit %, cancel cutoffs, reconfirm timing…) is the one the platform
 * actually uses today — never a copy that drifts.
 */
export interface Lesson {
  slug: string;
  title: string;
  minutes: number;
  summary: string;
  /** brand = the configured brand name (BRAND_NAME); never hard-code it in lesson text. */
  body: (s: SettingsMap, brand: string) => React.ReactNode;
  quiz: (s: SettingsMap, brand: string) => QuizQuestion[];
  /** The real screen this lesson teaches, opened from the lesson. */
  tryIt?: { href: string; label: string };
}

export interface Course {
  audience: Audience;
  title: string;
  intro: string;
  /** App area the course lives under, e.g. /clinic/academy. */
  base: string;
  lessons: Lesson[];
}

/** Accepts a bare YouTube video ID or any common YouTube URL; returns the ID or null. */
export function youtubeId(v: string | undefined | null): string | null {
  if (!v) return null;
  const s = v.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{11})/);
  return m ? m[1]! : null;
}

export function lessonBySlug(course: Course, slug: string) {
  const i = course.lessons.findIndex((l) => l.slug === slug);
  return i < 0 ? null : { lesson: course.lessons[i]!, index: i, prev: course.lessons[i - 1] ?? null, next: course.lessons[i + 1] ?? null };
}
