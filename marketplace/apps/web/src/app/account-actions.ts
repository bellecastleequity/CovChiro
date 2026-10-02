"use server";

import { revalidatePath } from "next/cache";
import { calendar } from "@cm/services";
import { formAction } from "@/lib/action";
import { requireActor } from "@/lib/session";

export const resetCalendarAction = formAction(async () => {
  const { user } = await requireActor("any");
  await calendar.resetCalendarToken(user.id);
  revalidatePath("/", "layout");
  return "New calendar link made. Calendars using the old link stop updating; subscribe again with the new one.";
});
