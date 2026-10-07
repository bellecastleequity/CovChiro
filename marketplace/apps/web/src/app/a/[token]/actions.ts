"use server";

import { revalidatePath } from "next/cache";
import { activity } from "@cm/services";
import { formAction, str } from "@/lib/action";

/** The signed one-tap link: no sign-in needed (it only confirms availability for this provider). */
export const activeLinkAction = formAction(async (fd) => {
  const token = str(fd, "token");
  const id = activity.providerIdFromActiveToken(token);
  if (!id) return "This link isn't valid.";
  const r = await activity.confirmActive(id, "link");
  revalidatePath(`/a/${token}`);
  return r;
});
