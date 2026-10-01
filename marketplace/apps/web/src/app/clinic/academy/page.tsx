import { CourseIndex } from "@/components/academy/course-pages";
import { clinicCourse } from "@/lib/academy/clinic";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Clinic training" };

export default async function ClinicAcademy() {
  const { user } = await requireActor("clinic");
  return <CourseIndex course={clinicCourse} userId={user.id} />;
}
