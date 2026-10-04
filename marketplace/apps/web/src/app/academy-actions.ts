"use server";

import { rewards } from "@cm/services";
import { clinicCourse } from "@/lib/academy/clinic";
import { providerCourse } from "@/lib/academy/provider";
import { requireActor } from "@/lib/session";

/** A lesson quiz was passed: Training points (once per lesson, plus the course bonus). Never throws. */
export async function lessonPassedAction(slug: string) {
  try {
    const { actor } = await requireActor("any");
    if (actor.role === "PROVIDER") await rewards.recordLesson(actor, slug, providerCourse.lessons.map((l) => l.slug));
    else if (actor.role === "CLINIC_OWNER" || actor.role === "CLINIC_STAFF") await rewards.recordLesson(actor, slug, clinicCourse.lessons.map((l) => l.slug));
  } catch {
    /* points are a bonus; the lesson still counts as done in the browser */
  }
}
