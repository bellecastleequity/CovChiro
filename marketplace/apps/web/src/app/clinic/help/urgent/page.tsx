import { UrgentHelp } from "@/components/help/urgent";
import { clinicHelp } from "@/lib/help/clinic";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Need help now?" };

export default async function ClinicUrgentHelp({ searchParams }: { searchParams: Promise<{ shift?: string; sent?: string }> }) {
  const { actor, user } = await requireActor("clinic");
  const q = await searchParams;
  return <UrgentHelp center={clinicHelp} actor={actor} user={{ name: user.name, email: user.email, phone: user.phone ?? null }} shiftId={q.shift} sentId={q.sent} />;
}
