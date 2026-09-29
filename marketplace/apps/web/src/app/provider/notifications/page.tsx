import { NotificationsPage } from "@/components/shell/notifications";
import { requireActor } from "@/lib/session";

export default async function Page() {
  const { user } = await requireActor("provider");
  return <NotificationsPage userId={user.id} />;
}
