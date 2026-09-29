import { ThreadList } from "@/components/messages";
import { requireActor } from "@/lib/session";

export default async function Page() {
  const { actor } = await requireActor("provider");
  return <ThreadList actor={actor} base="/provider/messages" />;
}
