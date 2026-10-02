import { LessonPage } from "@/components/academy/course-pages";
import { providerCourse } from "@/lib/academy/provider";
import { lessonBySlug } from "@/lib/academy/types";
import { requireActor } from "@/lib/session";

export async function generateMetadata({ params }: { params: Promise<{ lesson: string }> }) {
  const found = lessonBySlug(providerCourse, (await params).lesson);
  return { title: found ? `${found.lesson.title} · Provider training` : "Provider training" };
}

export default async function ProviderLesson({ params }: { params: Promise<{ lesson: string }> }) {
  const { user } = await requireActor("provider");
  return <LessonPage course={providerCourse} slug={(await params).lesson} userId={user.id} />;
}
