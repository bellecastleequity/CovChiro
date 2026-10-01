import { LessonPage } from "@/components/academy/course-pages";
import { clinicCourse } from "@/lib/academy/clinic";
import { lessonBySlug } from "@/lib/academy/types";
import { requireActor } from "@/lib/session";

export async function generateMetadata({ params }: { params: Promise<{ lesson: string }> }) {
  const found = lessonBySlug(clinicCourse, (await params).lesson);
  return { title: found ? `${found.lesson.title} · Clinic training` : "Clinic training" };
}

export default async function ClinicLesson({ params }: { params: Promise<{ lesson: string }> }) {
  const { user } = await requireActor("clinic");
  return <LessonPage course={clinicCourse} slug={(await params).lesson} userId={user.id} />;
}
