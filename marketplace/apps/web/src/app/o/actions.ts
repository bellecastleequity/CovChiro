"use server";

import { DomainError } from "@cm/core";
import { revalidatePath } from "next/cache";
import { attendance, dispatch } from "@cm/services";
import { formAction, str } from "@/lib/action";

/** Signed single-offer link: the token alone authorizes accept/decline of this one offer (Addendum 02 §8.2). */
export const tokenRespondAction = formAction(async (fd) => {
  const token = str(fd, "token");
  const accept = str(fd, "decision") === "accept";
  if (accept && fd.get("coverage") !== "on") throw new DomainError("VALIDATION", "Please confirm your malpractice insurance is active and unchanged.");
  const r = await dispatch.respondByToken(token, accept, accept);
  revalidatePath(`/o/${token}`);
  return { ok: r.message, data: r };
});

/** Signed attendance link: the token alone lets the provider reconfirm or check in for this one shift. */
export const attendanceLinkAction = formAction(async (fd) => {
  const token = str(fd, "token");
  const id = attendance.assignmentIdFromToken(token);
  if (!id) return "This link isn't valid.";
  const msg = str(fd, "do") === "onway" ? await attendance.markOnMyWay(null, id) : await attendance.reconfirmAttendance(null, id);
  revalidatePath(`/c/${token}`);
  return msg;
});
