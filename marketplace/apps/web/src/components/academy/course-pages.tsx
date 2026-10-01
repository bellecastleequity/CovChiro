import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Clock, ExternalLink } from "lucide-react";
import { brand } from "@cm/config";
import { getSettings } from "@cm/services";
import { lessonBySlug, type Course } from "@/lib/academy/types";
import { PrintButton } from "@/components/agreements/print-button";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { CourseProgress, DoneMark } from "./progress";
import { Quiz } from "./quiz";
import { LessonVideo } from "./video";

/** Course home: progress and the list of lessons. */
export async function CourseIndex({ course, userId }: { course: Course; userId: string }) {
  const total = course.lessons.reduce((m, l) => m + l.minutes, 0);
  const slugs = course.lessons.map((l) => l.slug);
  return (
    <>
      <PageHeader
        eyebrow="Training"
        title={course.title}
        description={course.intro}
        actions={
          <LinkButton href={`${course.base}/${course.lessons[0]!.slug}`}>
            Start <ArrowRight className="size-4" />
          </LinkButton>
        }
      />
      <Card className="mb-6">
        <CardBody>
          <CourseProgress userId={userId} course={course.audience} slugs={slugs} />
          <p className="mt-2 text-xs text-slate-500">
            {course.lessons.length} lessons · about {total} minutes. Each lesson ends with a short check; get every answer right to mark it complete. Progress is saved in this browser.
          </p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Lessons" />
        <ol className="divide-y divide-slate-100">
          {course.lessons.map((l, i) => (
            <li key={l.slug}>
              <Link href={`${course.base}/${l.slug}`} className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50">
                <DoneMark userId={userId} course={course.audience} slug={l.slug} index={i + 1} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900">{l.title}</div>
                  <div className="text-sm text-slate-500">{l.summary}</div>
                </div>
                <span className="hidden shrink-0 items-center gap-1 text-xs text-slate-500 sm:flex">
                  <Clock className="size-3.5" />
                  {l.minutes} min
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}

/** One lesson: optional video, the lesson itself, a link to the real screen, the check, and prev/next. */
export async function LessonPage({ course, slug, userId }: { course: Course; slug: string; userId: string }) {
  const found = lessonBySlug(course, slug);
  if (!found) notFound();
  const { lesson, index, prev, next } = found;
  const s = await getSettings();
  const b = brand().name;
  return (
    <div className="mx-auto max-w-3xl">
      <Link href={course.base} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900 print:hidden">
        <ArrowLeft className="size-4" />
        {course.title}
      </Link>
      <PageHeader eyebrow={`Lesson ${index + 1} of ${course.lessons.length} · ${lesson.minutes} min`} title={lesson.title} description={lesson.summary} />
      <LessonVideo value={s["academy.videos"][`${course.audience}/${lesson.slug}`]} title={lesson.title} />
      <Card>
        <CardBody className="py-6 sm:px-8">{lesson.body(s, b)}</CardBody>
      </Card>
      <div className="mt-4 flex flex-wrap gap-2 print:hidden">
        {lesson.tryIt ? (
          <LinkButton href={lesson.tryIt.href} variant="outline">
            <ExternalLink className="size-4" />
            {lesson.tryIt.label}
          </LinkButton>
        ) : null}
        <PrintButton />
      </div>
      <Card className="mt-6 print:hidden">
        <CardHeader title="Quick check" description="Get every answer right to mark this lesson complete." />
        <CardBody>
          <Quiz questions={lesson.quiz(s, b)} userId={userId} course={course.audience} slug={lesson.slug} />
        </CardBody>
      </Card>
      <nav className="mt-6 flex flex-wrap justify-between gap-3 print:hidden" aria-label="Lessons">
        {prev ? (
          <LinkButton href={`${course.base}/${prev.slug}`} variant="ghost">
            <ArrowLeft className="size-4" />
            {prev.title}
          </LinkButton>
        ) : (
          <span />
        )}
        {next ? (
          <LinkButton href={`${course.base}/${next.slug}`}>
            Next: {next.title}
            <ArrowRight className="size-4" />
          </LinkButton>
        ) : (
          <LinkButton href={course.base}>Back to all lessons</LinkButton>
        )}
      </nav>
    </div>
  );
}

