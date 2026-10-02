import { CourseIndex } from "@/components/academy/course-pages";
import { providerCourse } from "@/lib/academy/provider";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Provider training" };

export default async function ProviderAcademy() {
  const { user } = await requireActor("provider");
  return <CourseIndex course={providerCourse} userId={user.id} />;
}
