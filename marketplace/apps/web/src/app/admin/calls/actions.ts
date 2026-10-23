"use server";

import { revalidatePath } from "next/cache";
import { callline } from "@cm/services";
import { formAction, str } from "@/lib/action";
import { requireActor } from "@/lib/session";

export const markCallHandledAction = formAction(async (fd) => {
  const { actor } = await requireActor("admin");
  await callline.markHandled(actor, str(fd, "id"), str(fd, "handled") !== "0");
  revalidatePath("/admin/calls", "layout");
  return str(fd, "handled") !== "0" ? "Marked as called back." : "Moved back to waiting.";
});
