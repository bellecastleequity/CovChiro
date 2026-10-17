"use server";

import { revalidatePath } from "next/cache";
import { texts } from "@cm/services";
import { formAction, str } from "@/lib/action";
import { requireActor } from "@/lib/session";

export const sendTextAction = formAction(async (fd) => {
  const { actor } = await requireActor("admin");
  await texts.sendText(actor, str(fd, "phone"), str(fd, "body"));
  revalidatePath("/admin/texts", "layout");
  return "Text sent.";
});

export const markTextsReadAction = formAction(async (fd) => {
  const { actor } = await requireActor("admin");
  await texts.markRead(actor, str(fd, "phone"));
  revalidatePath("/admin/texts", "layout");
  return "Marked as read.";
});
