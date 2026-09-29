import { ThreadList } from "@/components/messages";
import { requireActor } from "@/lib/session";

export default async function Page() {
  const { actor } = await requireActor("clinic");
  return <ThreadList actor={actor} base="/clinic/messages" />;
}
