import { ThreadView } from "@/components/messages";
import { requireActor } from "@/lib/session";
import { sendMessageAction } from "../../actions";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor("clinic");
  return <ThreadView actor={actor} threadId={(await params).id} send={sendMessageAction} />;
}
