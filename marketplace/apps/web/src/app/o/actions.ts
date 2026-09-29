"use server";

import { revalidatePath } from "next/cache";
import { dispatch } from "@cm/services";
import { formAction, str } from "@/lib/action";

/** Signed single-offer link: the token alone authorizes accept/decline of this one offer (Addendum 02 §8.2). */
export const tokenRespondAction = formAction(async (fd) => {
  const token = str(fd, "token");
  const r = await dispatch.respondByToken(token, str(fd, "decision") === "accept");
  revalidatePath(`/o/${token}`);
  return { ok: r.message, data: r };
});
